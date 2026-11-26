'use server'

import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { oneMonthFromNow } from '@/lib/appwrite/jobs'
import { jobOwnership } from '@/lib/job-ownership'
import { ID } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { extractTextFromFile } from '@/lib/import-file-extract'
import { parseSpreadsheetJobs } from '@/lib/job-import'
import {
  improveImportedJobPrompt, jobImportPrompt, parseImprovedJobAnswer, parseJobImportAnswer, type ExtractedJob, type ImprovableJobFields,
} from '@/lib/job-import-prompts'
import { activeJobsLimitDenial } from '@/lib/tenant-access'

export type { ExtractedJob } from '@/lib/job-import-prompts'

export interface ParseResult {
  jobs: ExtractedJob[]
  rawPreview: string    // first 500 chars of extracted text, for debug
  error?: string
  /** 'spreadsheet' = lecture directe des colonnes (sans IA, pour des centaines de lignes) ; 'ai' = extraction par le modèle. */
  source?: 'spreadsheet' | 'ai'
  /** Lignes du tableur lues (avant rejet des lignes inutilisables). */
  totalRows?: number
  skipped?: { row: number; reason: string }[]
}

// ── Parse file with LLM ───────────────────────────────────────────
export async function parseFileWithLLM(formData: FormData): Promise<ParseResult> {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter') return { jobs: [], rawPreview: '', error: 'Non autorisé' }

    const llmProvider = (formData.get('llmProvider') as string | null) as import('@/types').LLMProvider | undefined || undefined

    const file = formData.get('file') as File | null
    const pastedText = formData.get('text') as string | null

    let text = ''
    let filename = 'paste'
    const defaultCompany = user.companyName ?? `${user.firstName} ${user.lastName}`

    if (file && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return { jobs: [], rawPreview: '', error: 'Fichier trop volumineux (max 5 Mo)' }
      filename = file.name
      const buffer = Buffer.from(await file.arrayBuffer())

      // Tableur (Excel / CSV) avec des colonnes reconnues : lecture directe, sans IA — fiable pour 1000 lignes et plus.
      if (/\.(xlsx|xls|csv|tsv)$/i.test(filename)) {
        const sheet = parseSpreadsheetJobs(buffer, filename, defaultCompany)
        if (sheet.recognized) {
          if (sheet.error) return { jobs: [], rawPreview: '', error: sheet.error }
          if (sheet.jobs.length === 0) return { jobs: [], rawPreview: '', error: 'Aucune ligne exploitable : chaque offre doit avoir un titre de poste.', totalRows: sheet.totalRows, skipped: sheet.skipped.slice(0, 200) }
          return {
            jobs: sheet.jobs.map(j => ({ ...j, id: Math.random().toString(36).slice(2, 10) })),
            rawPreview: '', source: 'spreadsheet', totalRows: sheet.totalRows, skipped: sheet.skipped.slice(0, 200),
          }
        }
      }
      text = await extractTextFromFile(buffer, filename)
    } else if (pastedText?.trim()) {
      text = pastedText.trim().slice(0, 15_000)
    } else {
      return { jobs: [], rawPreview: '', error: 'Aucun contenu fourni' }
    }

    if (text.length < 20) return { jobs: [], rawPreview: text, error: 'Contenu illisible ou trop court' }

    const rawPreview = text.slice(0, 500)

    const prompt = jobImportPrompt({ text, filename, defaultCompany })
    const { content: raw } = await callLLM(
      [{ role: 'user', content: prompt.user }],
      prompt.system,
      { provider: llmProvider, usage: { feature: 'job-import-extract', tenantId: user.tenantId } },
    )

    const answer = parseJobImportAnswer(raw)
    if ('error' in answer) return { jobs: [], rawPreview, error: answer.error }

    const jobs: ExtractedJob[] = answer.jobs.map(j => ({ ...j, id: Math.random().toString(36).slice(2, 9) }))

    return { jobs, rawPreview, source: 'ai' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue'
    return { jobs: [], rawPreview: '', error: msg }
  }
}

// "Améliorer avec l'IA" sur une offre extraite pendant la revue, avant import — permet de
// corriger le ton, compléter des infos manquantes, changer la localisation/contrat/salaire
// etc., sans ressaisir le fichier source. Couvre tous les champs éditables de la carte.
export async function improveExtractedJob(
  job: ImprovableJobFields,
  prompt: string,
): Promise<ImprovableJobFields | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { error: 'Non autorisé' }

  const trimmed = prompt.trim()
  if (!trimmed) return { error: 'Décrivez ce que l\'IA doit améliorer' }

  try {
    const { system, user: userMsg } = improveImportedJobPrompt({ job, request: trimmed })
    const { content } = await callLLM([{ role: 'user', content: userMsg }], system, { usage: { feature: 'job-import-improve', tenantId: user.tenantId } })
    return parseImprovedJobAnswer(content, job)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur d\'amélioration' }
  }
}

// ── Confirm import: save selected jobs to Appwrite ────────────────
export async function confirmImport(jobs: ExtractedJob[]): Promise<{ imported: number; error?: string }> {
  const requestStart = Date.now()
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter') return { imported: 0, error: 'Non autorisé' }

    const { databases } = createAdminClient()
    const { tryAutoPublishJob, deliveryDeadline } = await import('@/lib/social')
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')

    const tenantId = user.tenantId ?? ''
    // Limite d'offres actives de la formule (plans.ts), pour toutes les offres de l'import.
    if (tenantId) {
      const limited = await activeJobsLimitDenial(tenantId, Array.isArray(jobs) ? jobs.length : 0)
      if (limited) return { imported: 0, error: limited }
    }

    let imported = 0
    for (const job of jobs) {
      const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
        title: job.title,
        location: job.location || 'Non spécifié',
        contractType: job.contractType,
        remote: job.remote,
        salary: job.salary ?? 0,
        skills: job.skills,
        description: job.description,
        companyName: job.companyName,
        tenantId,
        ...jobOwnership(user),
        isActive: true,
        aiScore: null,
        applicationCount: 0,
        expiresAt: oneMonthFromNow(),
      })
      const created = { ...doc, $id: doc.$id } as never
      after(() => tryAutoPublishJob(created, deliveryDeadline(requestStart)))
      await tryAutoSourceCandidates({ ...doc, $id: doc.$id } as never)
      imported++
    }

    revalidatePath('/recruiter/dashboard')
    revalidatePath('/jobs')
    return { imported }
  } catch (e) {
    return { imported: 0, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// ── Import par lots : l'écran envoie les offres 20 par 20 et affiche la progression ─────────────
const CONTRACTS = new Set(['cdi', 'cdd', 'freelance', 'mission'])
const REMOTES = new Set(['onsite', 'hybrid', 'remote'])

/**
 * Crée un lot d'offres. `bulk` = import massif : pas de publication automatique sur les réseaux ni de recherche
 * de candidats offre par offre (des centaines de lancements simultanés saturerait les services) — le recruteur les
 * déclenche ensuite depuis l'offre.
 */
export async function importJobsChunk(
  jobs: ExtractedJob[],
  opts: { bulk: boolean },
): Promise<{ created: number; failed: { title: string; error: string }[]; error?: string }> {
  const requestStart = Date.now()
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { created: 0, failed: [], error: 'Non autorisé' }
  if (!Array.isArray(jobs) || jobs.length === 0) return { created: 0, failed: [] }
  if (jobs.length > 50) return { created: 0, failed: [], error: 'Lot trop grand.' }

  const { databases } = createAdminClient()
  const tenantId = user.tenantId ?? ''
  // Limite d'offres actives de la formule (plans.ts) : chaque lot est compté avec les offres déjà actives, lots
  // précédents compris (l'écran les envoie l'un après l'autre).
  if (tenantId) {
    try {
      const limited = await activeJobsLimitDenial(tenantId, jobs.length)
      if (limited) return { created: 0, failed: [], error: limited }
    } catch (err) {
      console.error('[import] limite d\'offres actives illisible', tenantId, err instanceof Error ? err.message : String(err))
      return { created: 0, failed: [], error: 'Import impossible pour le moment : réessayez dans quelques instants.' }
    }
  }
  const ownership = jobOwnership(user)
  let created = 0
  const failed: { title: string; error: string }[] = []

  async function createOne(job: ExtractedJob) {
    const title = String(job.title ?? '').trim().slice(0, 200)
    if (!title) throw new Error('Titre manquant')
    const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
      title,
      location: String(job.location ?? '').trim().slice(0, 200) || 'Non spécifié',
      contractType: CONTRACTS.has(job.contractType) ? job.contractType : 'mission',
      remote: REMOTES.has(job.remote) ? job.remote : 'hybrid',
      salary: typeof job.salary === 'number' && job.salary > 0 ? Math.round(job.salary) : 0,
      skills: (Array.isArray(job.skills) ? job.skills : []).map(k => String(k).trim().slice(0, 100)).filter(Boolean).slice(0, 10),
      description: String(job.description ?? '').trim().slice(0, 60_000) || title,
      companyName: String(job.companyName ?? '').slice(0, 1000),
      tenantId,
      ...ownership,
      isActive: true,
      aiScore: null,
      applicationCount: 0,
      expiresAt: oneMonthFromNow(),
    })
    if (!opts.bulk) {
      const { tryAutoPublishJob, deliveryDeadline } = await import('@/lib/social')
      const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
      after(() => tryAutoPublishJob({ ...doc, $id: doc.$id } as never, deliveryDeadline(requestStart)))
      await tryAutoSourceCandidates({ ...doc, $id: doc.$id } as never).catch(() => undefined)
    }
  }

  for (let i = 0; i < jobs.length; i += 5) {
    const group = jobs.slice(i, i + 5)
    const results = await Promise.allSettled(group.map(createOne))
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') created++
      else failed.push({ title: String(group[k]?.title ?? '').slice(0, 80) || 'Offre', error: r.reason instanceof Error ? r.reason.message.slice(0, 160) : 'Erreur' })
    })
  }

  revalidatePath('/recruiter/dashboard')
  if (created > 0) revalidatePath('/jobs')
  return { created, failed }
}
