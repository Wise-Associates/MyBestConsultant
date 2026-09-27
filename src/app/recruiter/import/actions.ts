'use server'

import { callLLM } from '@/lib/ai/llm-router'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { oneMonthFromNow } from '@/lib/appwrite/jobs'
import { ID } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { extractTextFromFile } from '@/lib/import-file-extract'
import { parseSpreadsheetJobs } from '@/lib/job-import'

export interface ExtractedJob {
  id: string            // temp client-side id
  title: string
  location: string
  contractType: 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote: 'onsite' | 'hybrid' | 'remote'
  salary: number | null
  skills: string[]
  description: string
  companyName: string
  confidence: 'high' | 'medium' | 'low'
}

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

    const SYSTEM = `Tu es un extracteur d'offres d'emploi expert. À partir du texte fourni, extrais TOUTES les offres d'emploi et retourne un JSON valide.

Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown, sans explication. Format exact :
[
  {
    "title": "string — intitulé du poste",
    "location": "string — ville ou région, '' si non précisé",
    "contractType": "cdi|cdd|freelance|mission",
    "remote": "onsite|hybrid|remote",
    "salary": number|null — montant en € (mensuel pour CDI/CDD, TJM pour freelance/mission), null si non précisé,
    "skills": ["string"] — liste de compétences techniques,
    "description": "string — description complète et détaillée du poste, reprends l'intégralité du contenu pertinent du document source (contexte, missions, profil recherché, compétences) — ne jamais résumer ni tronquer",
    "companyName": "string — nom de l'entreprise, '${defaultCompany}' si non précisé",
    "confidence": "high|medium|low"
  }
]

Règles :
- Si le texte contient plusieurs offres, extrais-les toutes
- contractType par défaut : "mission" pour IT consulting
- remote par défaut : "hybrid"
- confidence = "high" si toutes les infos clés sont présentes, "medium" si certaines manquent, "low" si beaucoup d'infos manquent
- Ne jamais inventer des informations qui ne sont pas dans le texte (sauf defaults ci-dessus)
- Si aucune offre n'est détectable, retourne []`

    const { content: raw } = await callLLM(
      [{ role: 'user', content: `Contenu à analyser (source: ${filename}):\n\n${text}` }],
      SYSTEM,
      llmProvider,
    )

    // Extract JSON array from response
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { jobs: [], rawPreview, error: 'Le modèle n\'a pas retourné de JSON valide' }

    let parsed: Omit<ExtractedJob, 'id'>[]
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      // Réponse tronquée ou malformée (ex. document trop long) — message clair plutôt
      // que l'erreur brute de JSON.parse (illisible pour un recruteur).
      return { jobs: [], rawPreview, error: 'Le document est trop long ou trop complexe pour être analysé en une fois. Essayez avec un fichier plus court, ou changez de modèle IA.' }
    }

    const jobs: ExtractedJob[] = parsed.map(j => ({
      ...j,
      id: Math.random().toString(36).slice(2, 9),
      salary: typeof j.salary === 'number' ? j.salary : null,
      skills: Array.isArray(j.skills) ? j.skills.slice(0, 10) : [],
      description: String(j.description ?? ''),
    }))

    return { jobs, rawPreview, source: 'ai' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur inconnue'
    return { jobs: [], rawPreview: '', error: msg }
  }
}

const IMPROVE_CONTRACT_TYPES = new Set(['cdi', 'cdd', 'freelance', 'mission'])
const IMPROVE_REMOTE_TYPES = new Set(['onsite', 'hybrid', 'remote'])

type ImprovableJobFields = Pick<ExtractedJob, 'title' | 'description' | 'skills' | 'location' | 'contractType' | 'remote' | 'salary'>

const IMPROVE_SYSTEM = `Tu es un expert en rédaction d'annonces d'emploi pour un cabinet de conseil en recrutement.
On te donne une offre extraite automatiquement (titre, description, compétences, localisation, type de contrat, télétravail, salaire/TJM) et une demande d'amélioration du recruteur.
Applique la demande aux champs concernés (un ou plusieurs) et renvoie TOUS les champs, en recopiant à l'identique ceux qui ne sont pas concernés.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après :
{"title":"...","description":"...","skills":["compétence1","compétence2"],"location":"...","contractType":"cdi|cdd|freelance|mission","remote":"onsite|hybrid|remote","salary":number|null}

Règles :
- Les sauts de ligne dans "description" doivent être de vrais \\n
- 5 à 10 compétences clés maximum dans "skills"
- Ne modifie QUE ce que la demande implique, recopie le reste sans y toucher`

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
    const userMsg = `Offre actuelle :\n${JSON.stringify(job)}\n\nDemande d'amélioration du recruteur : "${trimmed}"`
    const { content } = await callLLM([{ role: 'user', content: userMsg }], IMPROVE_SYSTEM)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { error: 'Réponse IA invalide, réessayez' }

    const parsed = JSON.parse(jsonMatch[0])
    const result: ImprovableJobFields = {
      title: String(parsed.title ?? job.title).slice(0, 200),
      description: String(parsed.description ?? job.description),
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 10).map(String) : job.skills,
      location: String(parsed.location ?? job.location),
      contractType: IMPROVE_CONTRACT_TYPES.has(String(parsed.contractType)) ? parsed.contractType : job.contractType,
      remote: IMPROVE_REMOTE_TYPES.has(String(parsed.remote)) ? parsed.remote : job.remote,
      salary: typeof parsed.salary === 'number' ? parsed.salary : job.salary,
    }
    if (!result.title || !result.description) return { error: 'Réponse IA incomplète, réessayez' }
    return result
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur d\'amélioration' }
  }
}

// ── Confirm import: save selected jobs to Appwrite ────────────────
export async function confirmImport(jobs: ExtractedJob[]): Promise<{ imported: number; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'recruiter') return { imported: 0, error: 'Non autorisé' }

    const { databases } = createAdminClient()
    const { tryAutoPublishJob } = await import('@/lib/social')
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')

    const tenantId = user.tenantId ?? ''

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
        postedBy: user.$id,
        isActive: true,
        aiScore: null,
        applicationCount: 0,
        expiresAt: oneMonthFromNow(),
      })
      const created = { ...doc, $id: doc.$id } as never
      after(() => tryAutoPublishJob(created))
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
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return { created: 0, failed: [], error: 'Non autorisé' }
  if (!Array.isArray(jobs) || jobs.length === 0) return { created: 0, failed: [] }
  if (jobs.length > 50) return { created: 0, failed: [], error: 'Lot trop grand.' }

  const { databases } = createAdminClient()
  const tenantId = user.tenantId ?? ''
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
      postedBy: user!.$id,
      isActive: true,
      aiScore: null,
      applicationCount: 0,
      expiresAt: oneMonthFromNow(),
    })
    if (!opts.bulk) {
      const { tryAutoPublishJob } = await import('@/lib/social')
      const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
      after(() => tryAutoPublishJob({ ...doc, $id: doc.$id } as never))
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
