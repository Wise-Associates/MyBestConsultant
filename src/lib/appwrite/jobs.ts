import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { ID, Query } from 'node-appwrite'
import type { Job, Application } from '@/types'
import { expandLocationSearch, normalizeLocation } from '@/lib/regions'
import { matchesKeywordRows, isExcludedByKeywordRows, type KeywordRow } from '@/lib/keyword-match'
import { estimateJobSeniorityYears, SENIORITY_MAX } from '@/lib/job-seniority'

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
  // Fetch jobs for this tenant + admin-published jobs (tenantId = '')
  const [tenantRes, adminRes] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
      Query.equal('tenantId', tenantId),
      Query.orderDesc('$createdAt'),
      Query.limit(100),
    ]),
    databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
      Query.equal('tenantId', ''),
      Query.orderDesc('$createdAt'),
      Query.limit(100),
    ]),
  ])
  const seen = new Set<string>()
  const all: Job[] = []
  for (const doc of [...tenantRes.documents, ...adminRes.documents]) {
    if (!seen.has(doc.$id)) {
      seen.add(doc.$id)
      all.push(docToJob(doc as unknown as Record<string, unknown>))
    }
  }
  return all.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
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
}): Promise<Job> {
  const { databases } = createAdminClient()
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, ID.unique(), {
    ...data,
    isActive: true,
  })
  return docToJob(doc as unknown as Record<string, unknown>)
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
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
    Query.equal('tenantId', tenantId),
    Query.orderDesc('$createdAt'),
    Query.limit(500),
  ])
  return result.documents.map(d => docToApp(d as unknown as Record<string, unknown>))
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
