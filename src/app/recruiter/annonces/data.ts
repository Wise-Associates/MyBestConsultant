import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getJobsByTenant, getApplicationsByTenant } from '@/lib/appwrite/jobs'
import { getFunnelStages } from '@/lib/appwrite/funnel'

async function listAll(collection: string, queries: string[]) {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, collection, [...queries, Query.limit(500)])
    return res.documents
  } catch {
    return []
  }
}

export async function loadTenantOverview(tenantId: string) {
  const [jobs, apps, stages, interviews, matches, viviers] = await Promise.all([
    getJobsByTenant(tenantId),
    getApplicationsByTenant(tenantId),
    getFunnelStages(tenantId),
    listAll(COLLECTIONS.INTERVIEWS, [Query.equal('tenantId', tenantId)]),
    listAll(COLLECTIONS.JOB_MATCHES, [Query.equal('tenantId', tenantId)]),
    listAll(COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', tenantId)]),
  ])

  const candidateIds = [...new Set(apps.map(a => a.candidateId))]
  const chunks: string[][] = []
  for (let i = 0; i < candidateIds.length; i += 100) chunks.push(candidateIds.slice(i, i + 100))
  const userDocs = (await Promise.all(chunks.map(ids => listAll(COLLECTIONS.USERS, [Query.equal('$id', ids)])))).flat()
  const names = new Map(userDocs.map(u => [u.$id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || (u.email as string)]))

  return { jobs, apps, stages, interviews, matches, viviers, names }
}
