import type { FunnelStageAutoAction } from '@/types'

// Configuration du funnel de recrutement : phases, statuts de phase, modèles de pipeline.
// Sans accès base : partagé entre le serveur (validation) et l'écran de gestion.

export interface StageInput { slug: string; label: string; color: string; autoAction?: FunnelStageAutoAction; statuses?: string[] }

export const STAGE_LIMITS = { stages: 20, label: 60, statuses: 12, status: 40, pipelines: 15, pipelineName: 80 } as const

export const PHASE_COLORS = ['#6b7280', '#8b5cf6', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6']

/** Statuts proposés par défaut : le recruteur peut les modifier dans l'onglet « Statuts ». */
export const DEFAULT_STATUS_LIBRARY = ['À planifier', 'Planifié', 'À replanifier', 'En attente', 'À recontacter', 'Écarté', 'Embauché(e)']

/** Pipeline par défaut : identique aux 6 étapes historiques (les candidatures existantes y trouvent leur colonne). */
export const DEFAULT_STAGE_INPUTS: StageInput[] = [
  { slug: 'pending', label: 'Candidats sélectionnés', color: '#6b7280' },
  { slug: 'screening', label: 'Screening IA', color: '#8b5cf6', autoAction: 'screening' },
  { slug: 'interview', label: 'Entretien IA', color: '#6366f1', autoAction: 'interview' },
  { slug: 'phone_interview', label: 'Entretien téléphonique', color: '#0ea5e9' },
  { slug: 'video_interview', label: 'Entretien visio', color: '#3b82f6' },
  { slug: 'onsite_interview', label: 'Entretien présentiel', color: '#f59e0b' },
  { slug: 'accepted', label: 'Embauchés', color: '#10b981' },
  { slug: 'on_hold', label: 'Vivier', color: '#a16207' },
  { slug: 'rejected', label: 'Refusé', color: '#ef4444' },
]

const PLAN = ['À planifier', 'Planifié', 'À replanifier']

export const STAGE_TEMPLATES: { id: 'default' | 'interviews' | 'blank'; name: string; description: string; stages: StageInput[] | null }[] = [
  { id: 'default', name: 'Copie du pipeline par défaut', description: 'Les mêmes phases que votre pipeline actuel, à adapter ensuite.', stages: null },
  {
    id: 'interviews', name: 'Plusieurs entretiens', description: 'Nouveaux candidats, screening IA, entretiens téléphonique, visio et présentiel, embauche.',
    stages: [
      { slug: 'pending', label: 'Nouveaux candidats', color: '#6b7280' },
      { slug: 'screening', label: 'Screening IA', color: '#8b5cf6', autoAction: 'screening' },
      { slug: 'phone_interview', label: 'Entretien téléphonique', color: '#0ea5e9', statuses: PLAN },
      { slug: 'interview', label: 'Entretien visio', color: '#3b82f6', autoAction: 'interview', statuses: PLAN },
      { slug: 'onsite_interview', label: 'Entretien présentiel', color: '#6366f1', statuses: PLAN },
      { slug: 'accepted', label: 'Embauchés', color: '#10b981' },
      { slug: 'on_hold', label: 'Vivier', color: '#f59e0b', statuses: ['À recontacter', 'En attente'] },
      { slug: 'rejected', label: 'Écartés', color: '#ef4444' },
    ],
  },
  {
    id: 'blank', name: 'Pipeline minimal', description: 'Trois phases seulement : nouveaux candidats, embauchés, refusés.',
    stages: [
      { slug: 'pending', label: 'Nouveaux candidats', color: '#6b7280' },
      { slug: 'accepted', label: 'Embauchés', color: '#10b981' },
      { slug: 'rejected', label: 'Refusé', color: '#ef4444' },
    ],
  },
]

/** Identifiant technique (20 caractères max : c'est la valeur stockée sur la candidature), unique dans le pipeline. */
export function slugify(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const base = (label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16)) || 'phase'
  if (!used.has(base)) return base
  for (let i = 2; i < 100; i++) { const s = `${base.slice(0, 16)}_${i}`; if (!used.has(s)) return s }
  return `${base.slice(0, 12)}_${Date.now().toString(36).slice(-6)}`
}

export function sanitizeStatusList(raw: unknown, max: number = STAGE_LIMITS.statuses): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, STAGE_LIMITS.status)
    if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= max) break
  }
  return out
}

export function sanitizeStageInputs(raw: unknown): { stages?: StageInput[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Ajoutez au moins une phase.' }
  if (raw.length > STAGE_LIMITS.stages) return { error: `Un pipeline compte ${STAGE_LIMITS.stages} phases au maximum.` }
  const seen = new Set<string>()
  const stages: StageInput[] = []
  for (const r of raw) {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const label = String(x.label ?? '').replace(/\s+/g, ' ').trim().slice(0, STAGE_LIMITS.label)
    const slug = String(x.slug ?? '').trim()
    if (!label) return { error: 'Chaque phase doit avoir un nom.' }
    if (!/^[a-z0-9_]{1,20}$/.test(slug)) return { error: `Identifiant de phase invalide (« ${label} »).` }
    if (seen.has(slug)) return { error: `Deux phases portent le même identifiant (« ${label} »).` }
    seen.add(slug)
    const color = /^#[0-9a-fA-F]{6}$/.test(String(x.color ?? '')) ? String(x.color) : '#6b7280'
    const autoAction = x.autoAction === 'screening' || x.autoAction === 'interview' ? x.autoAction : undefined
    stages.push({ slug, label, color, autoAction, statuses: sanitizeStatusList(x.statuses) })
  }
  return { stages }
}
