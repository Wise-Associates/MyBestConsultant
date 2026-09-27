'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { oneMonthFromNow } from '@/lib/appwrite/jobs'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import {
  getLinkedInAuthUrl,
  getLinkedInPublishConfig,
  disconnectLinkedIn,
  saveLinkedInPublishConfig,
  postJobToLinkedIn,
  getLinkedInOrganizations,
  type LinkedInPublishConfig,
} from '@/lib/linkedin-publish'

// ── LinkedIn OAuth / Publish config ──────────────────────────────

export { getLinkedInPublishConfig, type LinkedInPublishConfig }

export async function getLinkedInConnectUrl(): Promise<string> {
  const state = Math.random().toString(36).slice(2)
  return getLinkedInAuthUrl(state)
}

export async function disconnectLinkedInAction(): Promise<void> {
  await disconnectLinkedIn()
  revalidatePath('/admin/linkedin')
}

export async function updateLinkedInPublishSettings(formData: FormData): Promise<{ error?: string }> {
  try {
    const cfg = await getLinkedInPublishConfig()
    if (!cfg) return { error: 'LinkedIn non connecté' }
    await saveLinkedInPublishConfig({
      accessToken: cfg.accessToken,
      personUrn: cfg.personUrn,
      authorUrn: (formData.get('authorUrn') as string) || cfg.personUrn,
      authorLabel: (formData.get('authorLabel') as string) || 'Mon profil LinkedIn',
      autoPostOnPublish: formData.get('autoPost') === 'true',
    })
    revalidatePath('/admin/linkedin')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function fetchLinkedInOrgsAction(): Promise<Array<{ id: string; name: string; urn: string }>> {
  try {
    const cfg = await getLinkedInPublishConfig()
    if (!cfg) return []
    return getLinkedInOrganizations(cfg.accessToken)
  } catch {
    return []
  }
}

export async function testLinkedInPostAction(): Promise<{ ok?: boolean; error?: string }> {
  try {
    const cfg = await getLinkedInPublishConfig()
    if (!cfg) return { error: 'LinkedIn non connecté' }
    const fakeJob = {
      $id: 'test',
      tenantId: '',
      title: '🧪 Test de publication MyBestConsultant',
      description: 'Ceci est un test de connexion LinkedIn depuis MyBestConsultant. Vous pouvez supprimer ce post.',
      skills: ['Recrutement', 'IA'],
      location: 'France',
      isActive: true,
      createdAt: new Date().toISOString(),
      companyName: 'MyBestConsultant',
    }
    const result = await postJobToLinkedIn(fakeJob as never, cfg.accessToken, cfg.authorUrn)
    if (result.error) return { error: result.error }
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur test' }
  }
}

// ── Types ─────────────────────────────────────────────────────────

export interface LinkedInScrapeConfig {
  $id?: string
  keywords: string[]
  locations: string[]
  jobTypes: string[]
  experienceLevels: string[]
  remoteFilter: 'any' | 'remote' | 'hybrid' | 'onsite'
  industries: string[]
  frequency: 'manual' | 'daily' | 'weekly'
  maxResults: number
  autoPublish: boolean
  lastRunAt?: string
  isActive: boolean
}

export interface LinkedInJob {
  $id?: string
  sourceId: string
  title: string
  company: string
  location: string
  jobType: string
  remote: string
  description: string
  skills: string[]
  postedAt: string
  linkedinUrl: string
  status: 'new' | 'published' | 'ignored'
  scrapedAt: string
}

export interface ScrapeRun {
  runId: string
  apifyRunId?: string   // ID Apify pour polling
  startedAt: string
  completedAt?: string
  jobsFound: number
  jobsPublished: number
  errors: string[]
  status: 'running' | 'completed' | 'failed'
}

// ── Apify helpers ─────────────────────────────────────────────────

const APIFY_ACTOR = 'curious_coder~linkedin-jobs-scraper'
const APIFY_BASE = 'https://api.apify.com/v2'

// Map our config → Apify actor input (curious_coder~linkedin-jobs-scraper expects `urls`)
function buildApifyInput(cfg: LinkedInScrapeConfig) {
  const locs = cfg.locations.length > 0 ? cfg.locations : ['France']
  const kws  = cfg.keywords.length  > 0 ? cfg.keywords  : ['Consultant']

  // Build LinkedIn job search URLs — one per keyword × location combination
  const jtMap: Record<string, string> = { full_time: 'F', contract: 'C', part_time: 'P' }
  const expMap: Record<string, string> = { entry: '2', mid: '3', senior: '4', director: '5' }
  const wtMap: Record<string, string>  = { onsite: '1', remote: '2', hybrid: '3' }

  const jt  = cfg.jobTypes.map(t => jtMap[t]).filter(Boolean)
  const exp = cfg.experienceLevels.map(e => expMap[e]).filter(Boolean)

  const urls: string[] = []
  for (const kw of kws) {
    for (const loc of locs) {
      const p = new URLSearchParams({ keywords: kw, location: loc, f_TPR: 'r604800' })
      if (jt.length)  p.set('f_JT', jt.join(','))
      if (exp.length) p.set('f_E',  exp.join(','))
      if (cfg.remoteFilter !== 'any') p.set('f_WT', wtMap[cfg.remoteFilter] ?? '')
      urls.push(`https://www.linkedin.com/jobs/search/?${p.toString()}`)
    }
  }

  return {
    urls,
    scrapeCompany: false,
    rows: Math.min(cfg.maxResults, 100),
  }
}

// Convert HTML description → structured plain text (preserve emojis, headings, bullets)
function htmlToStructuredText(html: string): string {
  if (!html) return ''
  return html
    // Block-level: section headers
    .replace(/<h[1-4][^>]*>/gi, '\n### ')
    .replace(/<\/h[1-4]>/gi, '\n')
    // Paragraphs
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    // Line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    // List items → bullet
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/ul>|<\/ol>|<ul[^>]*>|<ol[^>]*>/gi, '\n')
    // Bold/strong → keep text (no markdown, just text)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '$1')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '$1')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à').replace(/&acirc;/g, 'â').replace(/&ocirc;/g, 'ô')
    .replace(/&ugrave;/g, 'ù').replace(/&ucirc;/g, 'û').replace(/&iuml;/g, 'ï')
    .replace(/&ccedil;/g, 'ç').replace(/&#\d+;/g, '')
    // Collapse 3+ blank lines → 2
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Parse Apify output item → LinkedInJob
function parseApifyItem(item: Record<string, unknown>): Omit<LinkedInJob, '$id' | 'status' | 'scrapedAt'> {
  // company can be a string or an object with .name
  const companyRaw = item.company
  const companyName = typeof companyRaw === 'object' && companyRaw !== null
    ? String((companyRaw as Record<string, unknown>).name ?? '')
    : String(companyRaw ?? item.companyName ?? '')

  // description — try all known field names; convert HTML to structured text
  const rawHtml = String(
    item.jobDescription ??
    item.descriptionHtml ??
    item.description ??
    item.jobDetails ??
    item.content ??
    ''
  )
  const rawDesc = htmlToStructuredText(rawHtml).slice(0, 4000)

  // LinkedIn URL — try all known field names
  const linkedinUrl = String(
    item.jobUrl ??
    item.link ??
    item.url ??
    item.applyUrl ??
    item.jobLink ??
    item.linkedinUrl ??
    ''
  )

  return {
    sourceId: String(item.id ?? item.sourceId ?? item.$id ?? ID.unique()),
    title: String(item.title ?? item.jobTitle ?? 'Sans titre'),
    company: companyName,
    location: String(item.location ?? item.jobLocation ?? ''),
    jobType: 'full_time',
    remote: 'onsite',
    description: rawDesc,
    skills: extractSkills(rawDesc),
    postedAt: postedAgoToISO(String(item.postedAgo ?? item.publishedAt ?? '')),
    linkedinUrl,
  }
}

// Extract tech skills from description (heuristic)
const SKILL_KEYWORDS = [
  'JavaScript','TypeScript','React','Vue','Angular','Node.js','Python','Java','PHP','Ruby',
  'Go','Rust','Swift','Kotlin','Flutter','React Native','Next.js','Nuxt','Laravel','Django',
  'FastAPI','Spring','Docker','Kubernetes','AWS','Azure','GCP','PostgreSQL','MySQL','MongoDB',
  'Redis','GraphQL','REST','Figma','Agile','Scrum','DevOps','CI/CD','Git','SQL','NoSQL',
  'Salesforce','SAP','Excel','Power BI','Tableau','Machine Learning','AI','ChatGPT','LLM',
  'C#','.NET','C++','Terraform','Ansible','Linux','bash','PowerShell',
]
function extractSkills(description: string): string[] {
  const lower = description.toLowerCase()
  return SKILL_KEYWORDS.filter(s => lower.includes(s.toLowerCase())).slice(0, 10)
}

function postedAgoToISO(postedAgo: string): string {
  const now = Date.now()
  const m = postedAgo.match(/(\d+)\s*(hour|day|week|month)/i)
  if (!m) return new Date(now).toISOString()
  const n = parseInt(m[1])
  const unit = m[2].toLowerCase()
  const ms = { hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 }[unit] ?? 0
  return new Date(now - n * ms).toISOString()
}

// ── Config CRUD ───────────────────────────────────────────────────

export async function getLinkedInConfig(): Promise<LinkedInScrapeConfig | null> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return null
    const doc = result.documents[0]
    return {
      $id: doc.$id,
      keywords:         (doc.keywords as string[])         ?? [],
      locations:        (doc.locations as string[])        ?? [],
      jobTypes:         (doc.jobTypes as string[])         ?? ['full_time', 'contract'],
      experienceLevels: (doc.experienceLevels as string[]) ?? ['mid', 'senior'],
      remoteFilter:     (doc.remoteFilter as LinkedInScrapeConfig['remoteFilter']) ?? 'any',
      industries:       (doc.industries as string[])       ?? [],
      frequency:        (doc.frequency as LinkedInScrapeConfig['frequency']) ?? 'manual',
      maxResults:       (doc.maxResults as number)         ?? 25,
      autoPublish:      (doc.autoPublish as boolean)       ?? false,
      lastRunAt:        doc.lastRunAt as string | undefined,
      isActive:         (doc.isActive as boolean)          ?? true,
    }
  } catch {
    return null
  }
}

export async function saveLinkedInConfig(cfg: Omit<LinkedInScrapeConfig, '$id'>): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
    const data = {
      keywords: cfg.keywords, locations: cfg.locations, jobTypes: cfg.jobTypes,
      experienceLevels: cfg.experienceLevels, remoteFilter: cfg.remoteFilter,
      industries: cfg.industries, frequency: cfg.frequency,
      maxResults: cfg.maxResults, autoPublish: cfg.autoPublish, isActive: cfg.isActive,
    }
    if (existing.documents.length > 0) {
      await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, existing.documents[0].$id, data)
    } else {
      await databases.createDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, ID.unique(), data)
    }
    revalidatePath('/admin/linkedin')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── Get scraped jobs ──────────────────────────────────────────────

export async function getLinkedInJobs(): Promise<LinkedInJob[]> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_JOBS, [
      Query.orderDesc('scrapedAt'), Query.limit(200),
    ])
    return result.documents.map(doc => ({
      $id: doc.$id,
      sourceId:    doc.sourceId    as string,
      title:       doc.title       as string,
      company:     doc.company     as string,
      location:    doc.location    as string,
      jobType:     doc.jobType     as string,
      remote:      doc.remote      as string,
      description: doc.description as string,
      skills:      (doc.skills     as string[]) ?? [],
      postedAt:    doc.postedAt    as string,
      linkedinUrl: doc.linkedinUrl as string,
      status:      doc.status      as LinkedInJob['status'],
      scrapedAt:   doc.scrapedAt   as string,
    }))
  } catch {
    return []
  }
}

// ── Lancer le scraping (Apify) ────────────────────────────────────

export async function runScrape(cfg: LinkedInScrapeConfig): Promise<ScrapeRun> {
  const runId = ID.unique()
  const startedAt = new Date().toISOString()
  const token = process.env.APIFY_TOKEN

  if (!token) {
    return {
      runId, startedAt, completedAt: new Date().toISOString(),
      jobsFound: 0, jobsPublished: 0,
      errors: ['APIFY_TOKEN manquant dans les variables d\'environnement. Ajoutez votre token Apify.'],
      status: 'failed',
    }
  }

  try {
    const input = buildApifyInput(cfg)

    // Démarrer le run Apify (async — retourne immédiatement)
    const startRes = await fetch(
      `${APIFY_BASE}/acts/${APIFY_ACTOR}/runs?token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    if (!startRes.ok) {
      const err = await startRes.text()
      return { runId, startedAt, jobsFound: 0, jobsPublished: 0, errors: [`Apify error: ${err}`], status: 'failed' }
    }

    const startData = await startRes.json() as { data: { id: string } }
    const apifyRunId = startData.data.id

    return {
      runId,
      apifyRunId,
      startedAt,
      jobsFound: 0,
      jobsPublished: 0,
      errors: [],
      status: 'running',
    }
  } catch (e) {
    return {
      runId, startedAt, completedAt: new Date().toISOString(),
      jobsFound: 0, jobsPublished: 0,
      errors: [e instanceof Error ? e.message : 'Erreur inconnue'],
      status: 'failed',
    }
  }
}

// ── Vérifier + importer les résultats d'un run Apify ─────────────

export async function checkScrapeRun(
  apifyRunId: string,
  cfg: LinkedInScrapeConfig,
): Promise<ScrapeRun> {
  const token = process.env.APIFY_TOKEN!
  const startedAt = new Date().toISOString()

  try {
    // Vérifier le statut du run
    const statusRes = await fetch(
      `${APIFY_BASE}/actor-runs/${apifyRunId}?token=${token}`,
    )
    if (!statusRes.ok) throw new Error(`Apify status error: ${statusRes.status}`)

    const statusData = await statusRes.json() as { data: { status: string; startedAt: string; finishedAt?: string } }
    const run = statusData.data

    if (run.status === 'RUNNING' || run.status === 'READY') {
      return {
        runId: apifyRunId, apifyRunId,
        startedAt: run.startedAt, jobsFound: 0, jobsPublished: 0,
        errors: [], status: 'running',
      }
    }

    if (run.status !== 'SUCCEEDED') {
      return {
        runId: apifyRunId, apifyRunId,
        startedAt: run.startedAt, completedAt: run.finishedAt,
        jobsFound: 0, jobsPublished: 0,
        errors: [`Apify run status: ${run.status}`], status: 'failed',
      }
    }

    // Récupérer les items du dataset (URL correcte Apify REST API v2)
    const itemsRes = await fetch(
      `${APIFY_BASE}/actor-runs/${apifyRunId}/dataset/items?token=${token}&limit=200`,
    )
    if (!itemsRes.ok) {
      const errText = await itemsRes.text().catch(() => '')
      throw new Error(`Impossible de récupérer les résultats (${itemsRes.status}): ${errText.slice(0, 200)}`)
    }

    const items = await itemsRes.json() as Record<string, unknown>[]

    // Importer dans LINKEDIN_JOBS (déduplique par sourceId)
    const { databases } = createAdminClient()

    // Charger les sourceIds existants pour dédupliquer
    const existing = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_JOBS, [
      Query.limit(500), Query.orderDesc('scrapedAt'),
    ])
    const existingIds = new Set(existing.documents.map(d => d.sourceId as string))

    let saved = 0
    let published = 0
    const scrapedAt = new Date().toISOString()

    for (const item of items) {
      const job = parseApifyItem(item)
      if (existingIds.has(job.sourceId)) continue  // déjà en base

      const status: LinkedInJob['status'] = cfg.autoPublish ? 'published' : 'new'
      await databases.createDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, ID.unique(), {
        ...job, status, scrapedAt,
      })
      saved++

      if (cfg.autoPublish) {
        await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
          title: job.title, location: job.location,
          contractType: job.jobType === 'contract' ? 'mission' : 'cdi',
          remote: job.remote, skills: job.skills,
          description: job.description, companyName: job.company,
          tenantId: '', isActive: true,
          expiresAt: oneMonthFromNow(),
        })
        published++
      }
    }

    // Mettre à jour lastRunAt
    try {
      const cfgDocs = await databases.listDocuments(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, [Query.limit(1)])
      if (cfgDocs.documents.length > 0) {
        await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_CONFIG, cfgDocs.documents[0].$id, {
          lastRunAt: scrapedAt,
        })
      }
    } catch { /* ignore */ }

    revalidatePath('/admin/linkedin')

    return {
      runId: apifyRunId, apifyRunId,
      startedAt: run.startedAt, completedAt: run.finishedAt ?? scrapedAt,
      jobsFound: saved, jobsPublished: published,
      errors: [], status: 'completed',
    }
  } catch (e) {
    return {
      runId: apifyRunId, apifyRunId, startedAt,
      jobsFound: 0, jobsPublished: 0,
      errors: [e instanceof Error ? e.message : 'Erreur vérification'],
      status: 'failed',
    }
  }
}

// ── Publier / ignorer ─────────────────────────────────────────────

export async function publishLinkedInJob(jobId: string): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, jobId)
    const newDoc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
      title:        doc.title,
      location:     doc.location,
      contractType: doc.jobType === 'contract' ? 'mission' : 'cdi',
      remote:       doc.remote,
      skills:       doc.skills,
      description:  doc.description,
      companyName:  doc.company,
      tenantId: '', isActive: true,
      expiresAt: oneMonthFromNow(),
    })
    await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, jobId, { status: 'published' })

    // Auto-post sur LinkedIn si connecté
    const liCfg = await getLinkedInPublishConfig()
    if (liCfg?.autoPostOnPublish) {
      const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
      await tryAutoPostJobToLinkedIn({ ...newDoc, $id: newDoc.$id } as never)
    }
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
    await tryAutoSourceCandidates({ ...newDoc, $id: newDoc.$id } as never)

    revalidatePath('/admin/linkedin')
    revalidatePath('/jobs')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function publishMultipleLinkedInJobs(jobIds: string[]): Promise<{ published: number; error?: string }> {
  try {
    const { databases } = createAdminClient()
    const liCfg = await getLinkedInPublishConfig()
    const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
    let published = 0
    for (const jobId of jobIds) {
      try {
        const doc = await databases.getDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, jobId)
        if (doc.status === 'published') continue
        const newDoc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
          title:        doc.title,
          location:     doc.location,
          contractType: doc.jobType === 'contract' ? 'mission' : 'cdi',
          remote:       doc.remote,
          skills:       doc.skills,
          description:  doc.description,
          companyName:  doc.company,
          tenantId: '', isActive: true,
          expiresAt: oneMonthFromNow(),
        })
        await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, jobId, { status: 'published' })
        if (liCfg?.autoPostOnPublish) {
          await tryAutoPostJobToLinkedIn({ ...newDoc, $id: newDoc.$id } as never)
        }
        await tryAutoSourceCandidates({ ...newDoc, $id: newDoc.$id } as never)
        published++
      } catch { /* skip individual failures */ }
    }
    revalidatePath('/admin/linkedin')
    revalidatePath('/jobs')
    return { published }
  } catch (e) {
    return { published: 0, error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function ignoreLinkedInJob(jobId: string): Promise<void> {
  try {
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.LINKEDIN_JOBS, jobId, { status: 'ignored' })
    revalidatePath('/admin/linkedin')
  } catch { /* ignore */ }
}
