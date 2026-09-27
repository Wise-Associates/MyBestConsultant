import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getApplicationsByTenant, getJobsByTenant } from '@/lib/appwrite/jobs'
import { getFunnelStages } from '@/lib/appwrite/funnel'
import { resolveStatus, withOrphanStages } from '@/lib/funnel-stage-utils'

export interface ActivityItem {
  id: string
  at: string
  actor: string | null
  kind: 'stage_change' | 'screening' | 'interview' | 'contact'
  candidate: string
  jobTitle: string
  stageLabel: string
  stageColor: string
  note: string | null
}

// Historique partagé de l'équipe : derniers mouvements dans les pipelines de toutes les annonces
// (qui a fait quoi, sur quel candidat), tiré du journal du funnel.
export async function getTeamActivity(tenantId: string, limit = 40): Promise<ActivityItem[]> {
  const { databases } = createAdminClient()
  const [apps, jobs, rawStages] = await Promise.all([getApplicationsByTenant(tenantId), getJobsByTenant(tenantId), getFunnelStages(tenantId)])
  if (apps.length === 0) return []

  const appIds = apps.map(a => a.$id)
  const chunks: string[][] = []
  for (let i = 0; i < appIds.length; i += 100) chunks.push(appIds.slice(i, i + 100))
  const events = (await Promise.all(chunks.map(ids =>
    databases.listDocuments(DB_ID, COLLECTIONS.FUNNEL_EVENTS, [Query.equal('applicationId', ids), Query.orderDesc('$createdAt'), Query.limit(limit)])
      .then(r => r.documents).catch(() => []),
  ))).flat().sort((a, b) => b.$createdAt.localeCompare(a.$createdAt)).slice(0, limit)

  const candidateIds = [...new Set(events.map(e => apps.find(a => a.$id === e.applicationId)?.candidateId).filter(Boolean) as string[])]
  const userDocs = candidateIds.length
    ? await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('$id', candidateIds.slice(0, 100)), Query.limit(100)]).then(r => r.documents).catch(() => [])
    : []
  const names = new Map(userDocs.map(u => [u.$id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || (u.email as string)]))
  const jobTitle = new Map(jobs.map(j => [j.$id, j.title]))
  const stageLites = rawStages.map(s => ({ slug: s.slug, label: s.label, color: s.color, order: s.order, autoAction: s.autoAction ?? null }))
  const stages = withOrphanStages(stageLites, events.map(e => resolveStatus(stageLites, e.stageSlug as string)))
  const stageBy = new Map(stages.map(s => [s.slug, s]))

  return events.map(e => {
    const app = apps.find(a => a.$id === e.applicationId)!
    const slug = resolveStatus(stageLites, e.stageSlug as string)
    const stage = stageBy.get(slug)
    return {
      id: e.$id, at: e.$createdAt, actor: (e.actorName as string | null) || null,
      kind: e.kind as ActivityItem['kind'],
      candidate: names.get(app.candidateId) ?? 'Candidat',
      jobTitle: jobTitle.get(app.jobId) ?? 'Annonce',
      stageLabel: stage?.label ?? (e.stageSlug as string), stageColor: stage?.color ?? '#6b7280',
      note: (e.note as string | null) || null,
    }
  })
}
