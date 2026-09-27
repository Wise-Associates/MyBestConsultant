import { redirect } from 'next/navigation'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getJobsByTenant, getApplicationsByTenant } from '@/lib/appwrite/jobs'
import { getFunnelStages } from '@/lib/appwrite/funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { ReportingClient, type ReportData } from './reporting-client'

async function listAll(collection: string, queries: string[]) {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, collection, [...queries, Query.limit(500)])
    return res.documents
  } catch {
    return []
  }
}

export default async function ReportingPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  const tenantId = user.tenantId

  const [jobs, apps, stages, interviews, emails, matches, viviers] = await Promise.all([
    getJobsByTenant(tenantId),
    getApplicationsByTenant(tenantId),
    getFunnelStages(tenantId),
    listAll(COLLECTIONS.INTERVIEWS, [Query.equal('tenantId', tenantId)]),
    listAll(COLLECTIONS.APPLICATION_EMAILS, [Query.equal('tenantId', tenantId)]),
    listAll(COLLECTIONS.JOB_MATCHES, [Query.equal('tenantId', tenantId)]),
    listAll(COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', tenantId)]),
  ])

  // Stage history (to measure time spent per stage) — funnel_events are keyed by application.
  const appIds = apps.map(a => a.$id)
  const chunks: string[][] = []
  for (let i = 0; i < appIds.length; i += 100) chunks.push(appIds.slice(i, i + 100))
  const eventDocs = (await Promise.all(chunks.map(ids =>
    listAll(COLLECTIONS.FUNNEL_EVENTS, [Query.equal('applicationId', ids), Query.orderAsc('$createdAt')])
  ))).flat()

  const candidateIds = [...new Set(apps.map(a => a.candidateId))]
  const userChunks: string[][] = []
  for (let i = 0; i < candidateIds.length; i += 100) userChunks.push(candidateIds.slice(i, i + 100))
  const userDocs = (await Promise.all(userChunks.map(ids => listAll(COLLECTIONS.USERS, [Query.equal('$id', ids)])))).flat()
  const names = new Map(userDocs.map(u => [u.$id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || (u.email as string)]))

  const data: ReportData = {
    jobs: jobs.map(j => ({ id: j.$id, title: j.title })),
    stages: stages.map(s => ({ slug: s.slug, label: s.label, color: s.color, order: s.order })),
    apps: apps.map(a => ({
      id: a.$id, jobId: a.jobId, candidateId: a.candidateId, name: names.get(a.candidateId) ?? 'Candidat', status: resolveStatus(stages, a.status),
      score: a.aiScore ?? null, createdAt: a.createdAt,
    })),
    events: eventDocs.filter(e => e.kind !== 'contact').map(e => ({ appId: e.applicationId as string, stage: e.stageSlug as string, at: e.$createdAt })),
    interviews: interviews.map(i => {
      let overall: number | null = null
      let reco: string | null = null
      try { if (i.analysis) { const a = JSON.parse(i.analysis as string); overall = a.overallScore ?? null; reco = a.recommendation ?? null } } catch { /* */ }
      return {
        appId: i.applicationId as string, status: i.status as string, createdAt: i.$createdAt,
        completedAt: (i.completedAt as string | null) ?? null, overall, reco,
      }
    }),
    emails: emails.map(e => ({
      appId: e.applicationId as string, createdAt: e.$createdAt, repliedAt: (e.repliedAt as string | null) ?? null,
      hasReply: !!e.reply,
    })),
    matches: [
      ...matches.map(m => ({ jobId: m.jobId as string, candidateId: m.candidateId as string, score: m.score as number, createdAt: m.$createdAt, source: 'pool' as const })),
      ...viviers.filter(v => v.matchScore != null).map(v => ({ jobId: v.jobId as string, candidateId: null, score: v.matchScore as number, createdAt: v.$createdAt, source: 'vivier' as const })),
    ],
    generatedAt: new Date().toISOString(),
  }

  return <ReportingClient data={data} />
}
