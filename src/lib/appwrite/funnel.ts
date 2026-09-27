import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { getCurrentUser } from './auth'
import { ID, Query } from 'node-appwrite'
import { DEFAULT_STAGE_INPUTS, DEFAULT_STATUS_LIBRARY, sanitizeStatusList, type StageInput } from '@/lib/funnel-config'
import { COLUMN_DEFS, COLUMN_RANK } from '@/lib/candidate-funnel'
import type { FunnelStage, FunnelPipeline, FunnelEvent, FunnelEventKind } from '@/types'

type Doc = Record<string, unknown> & { $id: string }

const parseJson = <T,>(raw: unknown, fallback: T): T => { try { return typeof raw === 'string' && raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }

function docToStage(doc: Doc): FunnelStage {
  const statuses = sanitizeStatusList(parseJson<unknown[]>(doc.statusesJson, []))
  return {
    $id: doc.$id,
    tenantId: doc.tenantId as string,
    slug: doc.slug as string,
    label: doc.label as string,
    color: doc.color as string,
    order: doc.order as number,
    autoAction: (doc.autoAction as FunnelStage['autoAction']) || undefined,
    pipelineId: (doc.pipelineId as string) || undefined,
    statuses: statuses.length ? statuses : undefined,
  }
}

const stageData = (tenantId: string, pipelineId: string | null, s: StageInput, order: number) => ({
  tenantId, slug: s.slug, label: s.label, color: s.color, order,
  autoAction: s.autoAction || null,
  pipelineId: pipelineId || null,
  statusesJson: s.statuses?.length ? JSON.stringify(s.statuses) : null,
})

/** Toutes les phases du tenant (pipeline par défaut + pipelines personnalisés). */
async function tenantStageDocs(tenantId: string): Promise<Doc[]> {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.FUNNEL_STAGES, [
    Query.equal('tenantId', tenantId), Query.orderAsc('order'), Query.limit(400),
  ])
  return result.documents as unknown as Doc[]
}

/** Pipelines personnalisés. Ne casse jamais l'écran : sans la collection (ou en cas d'erreur), il n'y a que le pipeline par défaut. */
async function pipelineDocs(tenantId: string): Promise<Doc[]> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, [Query.equal('tenantId', tenantId), Query.limit(200)])
    return result.documents as unknown as Doc[]
  } catch {
    return []
  }
}

const isPipeline = (d: Doc) => (d.kind as string | null) !== 'statuses'

// Every tenant gets the 6 default stages (matching the historical fixed
// ApplicationStatus values, so existing applications land in a real column with no
// migration needed) the first time they're requested — recruiters can then rename,
// recolor, reorder, add, or remove stages freely.
export async function getDefaultStages(tenantId: string, docs?: Doc[]): Promise<FunnelStage[]> {
  const all = docs ?? await tenantStageDocs(tenantId)
  const own = all.filter(d => !d.pipelineId)
  if (own.length > 0) return own.map(docToStage).sort((a, b) => a.order - b.order)

  const { databases } = createAdminClient()
  const created = await Promise.all(DEFAULT_STAGE_INPUTS.map((s, i) =>
    databases.createDocument(DB_ID, COLLECTIONS.FUNNEL_STAGES, ID.unique(), stageData(tenantId, null, s, i))
  ))
  return created.map(d => docToStage(d as unknown as Doc)).sort((a, b) => a.order - b.order)
}

/**
 * Toutes les phases connues du tenant, pipeline par défaut d'abord puis les phases propres aux autres pipelines
 * (dédoublonnées par identifiant). Sert aux écrans qui agrègent plusieurs offres : tableau de bord, rapports, équipe.
 * Le pipeline d'UNE offre s'obtient avec getStagesForJob.
 */
export async function getFunnelStages(tenantId: string): Promise<FunnelStage[]> {
  const docs = await tenantStageDocs(tenantId)
  const base = await getDefaultStages(tenantId, docs)
  const known = new Set(base.map(s => s.slug))
  const extra: FunnelStage[] = []
  for (const d of docs.filter(d => d.pipelineId)) {
    const s = docToStage(d)
    if (known.has(s.slug)) continue
    known.add(s.slug)
    extra.push({ ...s, order: base.length + extra.length })
  }
  return [...base, ...extra]
}

export async function getPipelines(tenantId: string): Promise<FunnelPipeline[]> {
  const [pipes, docs] = await Promise.all([pipelineDocs(tenantId), tenantStageDocs(tenantId).catch(() => [] as Doc[])])
  return pipes.filter(isPipeline).map(p => ({
    id: p.$id,
    name: (p.name as string) || 'Pipeline',
    jobIds: parseJson<string[]>(p.jobIdsJson, []),
    stages: docs.filter(d => d.pipelineId === p.$id).map(docToStage).sort((a, b) => a.order - b.order),
  }))
}

/** Phases à utiliser pour une offre : celles de son pipeline personnalisé, sinon le pipeline par défaut. */
export async function getStagesForJob(tenantId: string, jobId: string): Promise<{ stages: FunnelStage[]; pipeline: { id: string; name: string } | null }> {
  const [pipes, docs] = await Promise.all([pipelineDocs(tenantId), tenantStageDocs(tenantId)])
  const mine = pipes.filter(isPipeline).find(p => parseJson<string[]>(p.jobIdsJson, []).includes(jobId))
  if (mine) {
    const stages = docs.filter(d => d.pipelineId === mine.$id).map(docToStage).sort((a, b) => a.order - b.order)
    if (stages.length) return { stages, pipeline: { id: mine.$id, name: (mine.name as string) || 'Pipeline' } }
  }
  return { stages: await getDefaultStages(tenantId, docs), pipeline: null }
}

/** Remplace les phases d'un pipeline (null = pipeline par défaut). Les nouvelles phases sont créées avant de retirer les anciennes. */
export async function replaceStages(tenantId: string, pipelineId: string | null, stages: StageInput[]): Promise<FunnelStage[]> {
  const { databases } = createAdminClient()
  const old = (await tenantStageDocs(tenantId)).filter(d => (pipelineId ? d.pipelineId === pipelineId : !d.pipelineId))
  const created = await Promise.all(stages.map((s, i) =>
    databases.createDocument(DB_ID, COLLECTIONS.FUNNEL_STAGES, ID.unique(), stageData(tenantId, pipelineId, s, i))
  ))
  await Promise.all(old.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.FUNNEL_STAGES, d.$id).catch(() => undefined)))
  return created.map(d => docToStage(d as unknown as Doc)).sort((a, b) => a.order - b.order)
}

/**
 * Crée les colonnes du pipeline qui manquent pour les types d'étapes d'un funnel (ex. « Entretien téléphonique »), à leur place
 * logique : le funnel du candidat « génère » ainsi le pipeline. Les colonnes existantes ne sont jamais touchées.
 */
export async function ensureColumns(tenantId: string, pipelineId: string | null, slugs: string[]): Promise<FunnelStage[]> {
  const docs = await tenantStageDocs(tenantId)
  const current = pipelineId
    ? docs.filter(d => d.pipelineId === pipelineId).map(docToStage).sort((a, b) => a.order - b.order)
    : await getDefaultStages(tenantId, docs)
  // « screening » et « interview » peuvent exister sous un autre identifiant : on les reconnaît à leur action suggérée.
  const has = (slug: string) => current.some(s => s.slug === slug || (slug === 'screening' && s.autoAction === 'screening') || (slug === 'interview' && s.autoAction === 'interview'))
  const missing = [...new Set(slugs)].filter(s => COLUMN_DEFS[s] && !has(s)).sort((a, b) => (COLUMN_RANK[a] ?? 99) - (COLUMN_RANK[b] ?? 99))
  if (missing.length === 0) return current

  const list: StageInput[] = current.map(s => ({ slug: s.slug, label: s.label, color: s.color, autoAction: s.autoAction, statuses: s.statuses }))
  for (const slug of missing) {
    const rank = COLUMN_RANK[slug] ?? 99
    const at = list.findIndex(s => (COLUMN_RANK[s.slug] ?? -1) > rank)
    const def = COLUMN_DEFS[slug]
    const item: StageInput = { slug, label: def.label, color: def.color, autoAction: def.autoAction, statuses: [] }
    if (at < 0) list.push(item); else list.splice(at, 0, item)
  }
  return replaceStages(tenantId, pipelineId, list)
}

async function ownedPipeline(tenantId: string, id: string): Promise<Doc> {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, id).catch(() => null) as unknown as Doc | null
  if (!doc || doc.tenantId !== tenantId || !isPipeline(doc)) throw new Error('Pipeline introuvable.')
  return doc
}

export async function createPipeline(tenantId: string, name: string, stages: StageInput[]): Promise<FunnelPipeline> {
  const { databases } = createAdminClient()
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, ID.unique(), {
    tenantId, kind: 'pipeline', name, jobIdsJson: '[]',
  }) as unknown as Doc
  const created = await replaceStages(tenantId, doc.$id, stages)
  return { id: doc.$id, name, jobIds: [], stages: created }
}

export async function renamePipeline(tenantId: string, id: string, name: string): Promise<void> {
  await ownedPipeline(tenantId, id)
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, id, { name })
}

export async function deletePipeline(tenantId: string, id: string): Promise<void> {
  await ownedPipeline(tenantId, id)
  const { databases } = createAdminClient()
  const stages = (await tenantStageDocs(tenantId)).filter(d => d.pipelineId === id)
  await Promise.all(stages.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.FUNNEL_STAGES, d.$id).catch(() => undefined)))
  await databases.deleteDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, id)
}

/**
 * Affecte des offres à un pipeline (une offre n'appartient qu'à un pipeline). `pipelineId` null = pipeline par défaut :
 * les offres sont simplement retirées de tous les pipelines personnalisés.
 */
export async function setPipelineJobs(tenantId: string, pipelineId: string | null, jobIds: string[]): Promise<void> {
  const { databases } = createAdminClient()
  if (pipelineId) await ownedPipeline(tenantId, pipelineId)
  const pipes = (await pipelineDocs(tenantId)).filter(isPipeline)
  const moving = new Set(jobIds)
  await Promise.all(pipes.map(async p => {
    const current = parseJson<string[]>(p.jobIdsJson, [])
    const next = p.$id === pipelineId ? [...new Set(jobIds)] : current.filter(id => !moving.has(id))
    if (p.$id !== pipelineId && next.length === current.length) return
    await databases.updateDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, p.$id, { jobIdsJson: JSON.stringify(next).slice(0, 8000) })
  }))
}

// ── Bibliothèque de statuts (liste commune proposée pour toutes les phases) ──

export async function getStatusLibrary(tenantId: string): Promise<string[]> {
  const doc = (await pipelineDocs(tenantId)).find(d => d.kind === 'statuses')
  const list = doc ? sanitizeStatusList(parseJson<unknown[]>(doc.dataJson, []), 60) : []
  return doc ? list : DEFAULT_STATUS_LIBRARY
}

export async function saveStatusLibrary(tenantId: string, labels: unknown): Promise<string[]> {
  const list = sanitizeStatusList(labels, 60)
  const { databases } = createAdminClient()
  const doc = (await pipelineDocs(tenantId)).find(d => d.kind === 'statuses')
  const data = { tenantId, kind: 'statuses', name: 'statuses', dataJson: JSON.stringify(list) }
  if (doc) await databases.updateDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, doc.$id, data)
  else await databases.createDocument(DB_ID, COLLECTIONS.FUNNEL_PIPELINES, ID.unique(), data)
  return list
}

// `actorName` : qui a fait l'action (historique d'équipe). Non fourni → déduit de la session en cours,
// uniquement si c'est un recruteur (un candidat qui termine un entretien n'est pas un acteur d'équipe).
export async function logFunnelEvent(applicationId: string, stageSlug: string, kind: FunnelEventKind, note?: string, actorName?: string): Promise<void> {
  try {
    const { databases } = createAdminClient()
    let actor = actorName?.trim() || ''
    if (!actor) {
      const u = await getCurrentUser().catch(() => null)
      if (u?.role === 'recruiter') actor = `${u.firstName} ${u.lastName}`.trim()
    }
    await databases.createDocument(DB_ID, COLLECTIONS.FUNNEL_EVENTS, ID.unique(), {
      applicationId, stageSlug, kind, note: note?.slice(0, 2000) || null, actorName: actor.slice(0, 100) || null,
    })
  } catch { /* history is best-effort — never blocks the actual action */ }
}

export async function getFunnelEvents(applicationId: string): Promise<FunnelEvent[]> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.FUNNEL_EVENTS, [
      Query.equal('applicationId', applicationId), Query.orderDesc('$createdAt'), Query.limit(50),
    ])
    return result.documents.map(d => ({
      $id: d.$id, applicationId: d.applicationId as string, stageSlug: d.stageSlug as string,
      kind: d.kind as FunnelEventKind, note: d.note as string | undefined, actorName: (d.actorName as string | null) || undefined, $createdAt: d.$createdAt,
    }))
  } catch {
    return []
  }
}
