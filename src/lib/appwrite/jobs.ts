import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { listAllDocuments } from './list-all'
import { ID, Query } from 'node-appwrite'
import type { Job, Application } from '@/types'
import { expandLocationSearch, normalizeLocation } from '@/lib/regions'
import { matchesKeywordRows, isExcludedByKeywordRows, type KeywordRow } from '@/lib/keyword-match'
import { estimateJobSeniorityYears, SENIORITY_MAX } from '@/lib/job-seniority'
import type { RecruiterSelection } from '@/lib/recruiter-job-filters'

/**
 * Offres par requête quand on lit les candidatures d'une liste d'offres : Appwrite refuse plus de 100 valeurs dans un
 * Query.equal. Sans rapport avec les 50 lignes affichées à la fois dans « Mes offres » (jobs-list-client.tsx).
 */
const JOB_BATCH = 100

// ── Helpers ──────────────────────────────────────────────────────

function docToJob(doc: Record<string, unknown>): Job {
  return {
    $id: doc.$id as string,
    tenantId: doc.tenantId as string,
    title: doc.title as string,
    description: doc.description as string,
    skills: (doc.skills as string[]) ?? [],
    location: doc.location as string,
    isActive: doc.isActive as boolean,
    createdAt: doc.$createdAt as string,
    contractType: doc.contractType as Job['contractType'],
    remote: doc.remote as Job['remote'],
    salary: doc.salary as number | undefined,
    companyName: doc.companyName as string | undefined,
    expiresAt: doc.expiresAt as string | undefined,
    recruiterId: (doc.recruiterId as string | null) || undefined,
  }
}

function isExpired(job: Job): boolean {
  if (!job.expiresAt) return false
  return new Date(job.expiresAt) < new Date()
}

export function oneMonthFromNow(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

function docToApp(doc: Record<string, unknown>): Application {
  return {
    $id: doc.$id as string,
    jobId: doc.jobId as string,
    tenantId: doc.tenantId as string,
    candidateId: doc.candidateId as string,
    cvFileId: (doc.cvFileId as string) ?? '',
    status: doc.status as Application['status'],
    aiScore: doc.aiScore as number | undefined,
    aiSummary: doc.aiSummary as string | undefined,
    aiRecommendation: doc.aiRecommendation as Application['aiRecommendation'],
    stageStatus: (doc.stageStatus as string | null) || undefined,
    funnelJson: (doc.funnelJson as string | null) || undefined,
    createdAt: doc.$createdAt as string,
  }
}

// ── Jobs ─────────────────────────────────────────────────────────

export async function getActiveJobs(params?: {
  keywords?: KeywordRow[]
  excludeKeywords?: KeywordRow[]
  location?: string
  contractType?: string
  remote?: string
  seniorityRange?: [number, number]
}): Promise<Job[]> {
  const { databases } = createAdminClient()
  // 500 here (not the usual 100) — this feeds the public /jobs listing, which paginates
  // client-side over the full filtered set rather than querying Appwrite per page.
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    Query.equal('isActive', true),
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ])
  let jobs = result.documents
    .map(d => docToJob(d as unknown as Record<string, unknown>))
    .filter(j => !isExpired(j))

  // Scoped to title + skills only — matching inside the long-form description too
  // surfaced unrelated jobs that merely mentioned the keyword in passing (e.g. searching
  // "architecture" matching a job whose description says "connaissance de l'architecture
  // microservices" but isn't an architecture role).
  if (params?.keywords) {
    jobs = jobs.filter(j => matchesKeywordRows(`${j.title} ${j.skills.join(' ')}`, params.keywords!))
  }
  if (params?.excludeKeywords) {
    jobs = jobs.filter(j => !isExcludedByKeywordRows(`${j.title} ${j.skills.join(' ')}`, params.excludeKeywords!))
  }
  if (params?.location) {
    // A region name (e.g. "Île-de-France") also matches jobs located in one of its
    // cities, and a city name also matches a search for its region — not just a raw
    // substring match against whatever string is in job.location.
    const candidates = expandLocationSearch(params.location)
    jobs = jobs.filter(j => {
      const loc = normalizeLocation(j.location)
      return candidates.some(c => loc.includes(c) || c.includes(loc))
    })
  }
  if (params?.contractType) {
    jobs = jobs.filter(j => j.contractType === params.contractType)
  }
  if (params?.remote) {
    jobs = jobs.filter(j => j.remote === params.remote)
  }
  if (params?.seniorityRange) {
    const [min, max] = params.seniorityRange
    jobs = jobs.filter(j => {
      const years = estimateJobSeniorityYears(j.title, j.description)
      if (years == null) return true // undeterminable — don't hide the job for it
      return years >= min && (max >= SENIORITY_MAX || years <= max)
    })
  }
  return jobs
}

/** Offres ouvertes (actives, non expirées) de l'organisation seule, la plus récente d'abord : celles du vivier général. */
export async function getOpenJobsOfTenant(tenantId: string): Promise<Job[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    Query.equal('tenantId', tenantId),
    Query.equal('isActive', true),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return result.documents
    .map(d => docToJob(d as unknown as Record<string, unknown>))
    .filter(j => !isExpired(j))
}

export async function getJobById(id: string): Promise<Job | null> {
  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, id)
    return docToJob(doc as unknown as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function getJobsByTenant(tenantId: string): Promise<Job[]> {
  const { databases } = createAdminClient()
  // Fetch jobs for this tenant + admin-published jobs (tenantId = ''), all of them (each read was capped at 100).
  const [tenantDocs, adminDocs] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.equal('tenantId', tenantId), Query.orderDesc('$createdAt')]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.equal('tenantId', ''), Query.orderDesc('$createdAt')]),
  ])
  const seen = new Set<string>()
  const all: Job[] = []
  for (const doc of [...tenantDocs, ...adminDocs]) {
    if (!seen.has(doc.$id)) {
      seen.add(doc.$id)
      all.push(docToJob(doc as unknown as Record<string, unknown>))
    }
  }
  return all.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
}

/**
 * Offres de l'organisation affectées aux recruteurs choisis (`selection.ids`, profils) et, avec `unassigned`, celles sans
 * recruteur — filtre par recruteur du tableau de bord. Les offres partagées de la plateforme n'en font pas partie : elles
 * ne sont affectées à personne de l'équipe. Une requête par cas, réunies (pas de Query.or ailleurs dans le projet).
 */
export async function getTenantJobsOfRecruiters(tenantId: string, selection: RecruiterSelection): Promise<Job[]> {
  const { databases } = createAdminClient()
  const read = (query: string) =>
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.equal('tenantId', tenantId), query, Query.orderDesc('$createdAt')])
  const lists = await Promise.all([
    ...(selection.ids.length > 0 ? [read(Query.equal('recruiterId', selection.ids))] : []),
    ...(selection.unassigned ? [read(Query.isNull('recruiterId'))] : []),
  ])
  return lists.flat()
    .map(doc => docToJob(doc as unknown as Record<string, unknown>))
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
}

export async function createJob(data: {
  tenantId: string
  title: string
  description: string
  skills: string[]
  location: string
  contractType?: Job['contractType']
  remote?: Job['remote']
  salary?: number
  companyName?: string
  expiresAt?: string
  /** Auteur et recruteur affecté, profils (users.$id) : jobOwnership (src/lib/job-ownership.ts). */
  postedBy: string
  recruiterId: string
}, id?: string): Promise<Job> {
  const { databases } = createAdminClient()
  // `id` fixe (offre publiée depuis un appel d'offres) : une seconde création échoue (409) au lieu de faire un doublon.
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, id ? ID.custom(id) : ID.unique(), {
    ...data,
    isActive: true,
  })
  return docToJob(doc as unknown as Record<string, unknown>)
}

/** Offres actives (publiées, non expirées) d'une organisation : limite d'offres actives de sa formule (plans.ts). */
export async function countActiveJobs(tenantId: string): Promise<number> {
  const { databases } = createAdminClient()
  const docs = await listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.equal('tenantId', tenantId), Query.equal('isActive', true)])
  return docs.filter(doc => !isExpired(docToJob(doc as unknown as Record<string, unknown>))).length
}

export async function updateJobStatus(jobId: string, isActive: boolean): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, jobId, { isActive })
}

export async function deleteJob(jobId: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, COLLECTIONS.JOBS, jobId)
}

// ── Applications ──────────────────────────────────────────────────

export async function getApplicationsByCandidate(candidateId: string): Promise<Application[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('candidateId', candidateId),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return result.documents.map(d => docToApp(d as unknown as Record<string, unknown>))
}

export async function getApplicationsByJob(jobId: string): Promise<Application[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('jobId', jobId),
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])
  return result.documents.map(d => docToApp(d as unknown as Record<string, unknown>))
}

export async function getApplicationsByTenant(tenantId: string): Promise<Application[]> {
  const { databases } = createAdminClient()
  // All of them: the dashboard and reporting figures are computed on this list (it was capped at 500).
  const docs = await listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('tenantId', tenantId),
    Query.orderDesc('$createdAt'),
  ])
  return docs.map(d => docToApp(d as unknown as Record<string, unknown>))
}

/** Candidatures de l'organisation aux offres `jobIds` (tableau de bord filtré par recruteur), toutes, par lots d'offres. */
export async function getApplicationsOfJobs(tenantId: string, jobIds: string[]): Promise<Application[]> {
  const { databases } = createAdminClient()
  const batches: string[][] = []
  for (let i = 0; i < jobIds.length; i += JOB_BATCH) batches.push(jobIds.slice(i, i + JOB_BATCH))
  // Même périmètre que getApplicationsByTenant (organisation de la candidature), restreint aux offres choisies.
  const lists = await Promise.all(batches.map(ids => listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('tenantId', tenantId), Query.equal('jobId', ids), Query.orderDesc('$createdAt'),
  ])))
  return lists.flat().map(d => docToApp(d as unknown as Record<string, unknown>))
}

export async function hasApplied(jobId: string, candidateId: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('jobId', jobId),
    Query.equal('candidateId', candidateId),
    Query.limit(1),
  ])
  return result.total > 0
}

export async function createApplication(data: {
  jobId: string
  tenantId: string
  candidateId: string
  cvFileId: string
}): Promise<Application> {
  const { databases } = createAdminClient()
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.APPLICATIONS, ID.unique(), {
    ...data,
    status: 'pending',
  })
  return docToApp(doc as unknown as Record<string, unknown>)
}

export async function updateApplicationStatus(
  applicationId: string,
  status: Application['status']
): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, { status })
}

export async function updateApplicationCard(
  applicationId: string,
  data: { tags?: string[]; note?: string }
): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, data)
}

export async function deleteApplication(applicationId: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId)
}
