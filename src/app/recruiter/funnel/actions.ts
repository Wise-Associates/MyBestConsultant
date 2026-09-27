'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createPipeline, deletePipeline, getDefaultStages, getPipelines, renamePipeline, replaceStages, saveStatusLibrary, setPipelineJobs } from '@/lib/appwrite/funnel'
import { getJobsByTenant } from '@/lib/appwrite/jobs'
import { STAGE_LIMITS, STAGE_TEMPLATES, sanitizeStageInputs } from '@/lib/funnel-config'
import { loadFunnelData, type FunnelData } from './data'

type Result = { data?: FunnelData; error?: string }

async function requireRecruiter() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Error('Non autorisé')
  return { ...user, tenantId: user.tenantId }
}

async function run(fn: (tenantId: string) => Promise<void>): Promise<Result> {
  try {
    const user = await requireRecruiter()
    await fn(user.tenantId)
    revalidatePath('/recruiter/funnel')
    revalidatePath('/recruiter/dashboard')
    return { data: await loadFunnelData(user.tenantId) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Une erreur est survenue.' }
  }
}

const cleanName = (raw: string) => raw.replace(/\s+/g, ' ').trim().slice(0, STAGE_LIMITS.pipelineName)

/** Enregistre les phases d'un pipeline (null = pipeline par défaut). */
export async function savePipelineStagesAction(pipelineId: string | null, stages: unknown): Promise<Result> {
  return run(async tenantId => {
    const parsed = sanitizeStageInputs(stages)
    if (!parsed.stages) throw new Error(parsed.error)
    if (pipelineId && !(await getPipelines(tenantId)).some(p => p.id === pipelineId)) throw new Error('Pipeline introuvable.')
    await replaceStages(tenantId, pipelineId, parsed.stages)
  })
}

export async function createPipelineAction(name: string, templateId: string): Promise<Result> {
  return run(async tenantId => {
    const clean = cleanName(name)
    if (!clean) throw new Error('Donnez un nom au pipeline.')
    if ((await getPipelines(tenantId)).length >= STAGE_LIMITS.pipelines) throw new Error(`Vous pouvez créer ${STAGE_LIMITS.pipelines} pipelines au maximum.`)
    const template = STAGE_TEMPLATES.find(t => t.id === templateId) ?? STAGE_TEMPLATES[0]
    const stages = template.stages ?? (await getDefaultStages(tenantId)).map(s => ({ slug: s.slug, label: s.label, color: s.color, autoAction: s.autoAction, statuses: s.statuses }))
    await createPipeline(tenantId, clean, stages)
  })
}

export async function renamePipelineAction(id: string, name: string): Promise<Result> {
  return run(async tenantId => {
    const clean = cleanName(name)
    if (!clean) throw new Error('Donnez un nom au pipeline.')
    await renamePipeline(tenantId, id, clean)
  })
}

export async function deletePipelineAction(id: string): Promise<Result> {
  return run(async tenantId => { await deletePipeline(tenantId, id) })
}

/** Offres qui suivent ce pipeline (null = pipeline par défaut : on les retire des pipelines personnalisés). */
export async function assignJobsAction(pipelineId: string | null, jobIds: string[]): Promise<Result> {
  return run(async tenantId => {
    const mine = new Set((await getJobsByTenant(tenantId)).map(j => j.$id))
    const ids = [...new Set(jobIds)].filter(id => mine.has(id)).slice(0, 300)
    await setPipelineJobs(tenantId, pipelineId, ids)
  })
}

export async function saveStatusesAction(statuses: string[]): Promise<Result> {
  return run(async tenantId => { await saveStatusLibrary(tenantId, statuses) })
}
