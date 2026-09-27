import { getDefaultStages, getPipelines, getStatusLibrary } from '@/lib/appwrite/funnel'
import { getJobsByTenant } from '@/lib/appwrite/jobs'
import type { FunnelPipeline, FunnelStage } from '@/types'

export interface FunnelData {
  defaultStages: FunnelStage[]
  pipelines: FunnelPipeline[]
  statuses: string[]
  jobs: { id: string; title: string; isActive: boolean; pipelineId: string | null }[]
}

/** Tout ce dont l'écran « Processus de recrutement » a besoin, en une fois. */
export async function loadFunnelData(tenantId: string): Promise<FunnelData> {
  const [defaultStages, pipelines, statuses, jobs] = await Promise.all([
    getDefaultStages(tenantId), getPipelines(tenantId), getStatusLibrary(tenantId), getJobsByTenant(tenantId),
  ])
  const pipelineOf = new Map<string, string>()
  for (const p of pipelines) for (const id of p.jobIds) pipelineOf.set(id, p.id)
  return {
    defaultStages, pipelines, statuses,
    jobs: jobs.map(j => ({ id: j.$id, title: j.title, isActive: j.isActive, pipelineId: pipelineOf.get(j.$id) ?? null })),
  }
}
