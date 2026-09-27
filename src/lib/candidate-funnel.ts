// Funnel de recrutement d'UN candidat : le parcours d'étapes défini par le recruteur (Screening, entretiens IA / téléphonique /
// visio / présentiel, embauche…), dans l'ordre et en nombre libres. Le pipeline (vue Kanban de l'offre) en est la vue globale :
// chaque type d'étape correspond à une colonne. Pur (aucun accès base) : partagé entre l'écran et le serveur.

export type StepType = 'screening' | 'ai_interview' | 'phone' | 'video' | 'onsite' | 'other' | 'hired'
export type StepStatus = 'todo' | 'scheduled' | 'done' | 'validated' | 'skipped'
export type StepResult = 'positive' | 'neutral' | 'negative'

export interface FunnelStep {
  id: string
  type: StepType
  label: string
  /** true = libellé modifié à la main (il n'est plus renuméroté automatiquement). */
  custom?: boolean
  status: StepStatus
  result?: StepResult
  /** Compte rendu de l'étape (saisi ou généré par l'IA). */
  report?: string
  reportBy?: 'ai' | 'manual'
  validatedAt?: string
  validatedBy?: string
}

export const FUNNEL_LIMITS = { steps: 12, label: 60, report: 1200, perType: 5 } as const

export const STEP_TYPES: Record<StepType, { label: string; short: string; description: string; color: string; column: string; repeatable: boolean }> = {
  screening:    { label: 'Screening',              short: 'Screening',    description: 'Analyse du CV par l’IA',             color: '#8b5cf6', column: 'screening',        repeatable: false },
  ai_interview: { label: 'Entretien IA',           short: 'IA',           description: 'Entretien mené par l’agent IA',      color: '#6366f1', column: 'interview',        repeatable: true },
  phone:        { label: 'Entretien téléphonique', short: 'Téléphone',    description: 'Appel avec le recruteur',            color: '#0ea5e9', column: 'phone_interview',  repeatable: true },
  video:        { label: 'Entretien visio',        short: 'Visio',        description: 'Teams, Meet ou Zoom',                color: '#3b82f6', column: 'video_interview',  repeatable: true },
  onsite:       { label: 'Entretien présentiel',   short: 'Présentiel',   description: 'Rencontre physique',                 color: '#f59e0b', column: 'onsite_interview', repeatable: true },
  other:        { label: 'Autre étape',            short: 'Autre',        description: 'Test technique, référence, etc.',    color: '#14b8a6', column: 'other_interview',  repeatable: true },
  hired:        { label: 'Embauché',               short: 'Embauche',     description: 'Décision finale',                    color: '#10b981', column: 'accepted',         repeatable: false },
}

export const STEP_ORDER: StepType[] = ['screening', 'ai_interview', 'phone', 'video', 'onsite', 'other', 'hired']

/** Colonnes du pipeline liées aux types d'étapes (libellé, couleur, action suggérée) — sert à les créer automatiquement. */
export const COLUMN_DEFS: Record<string, { label: string; color: string; autoAction?: 'screening' | 'interview' }> = {
  screening: { label: 'Screening IA', color: '#8b5cf6', autoAction: 'screening' },
  interview: { label: 'Entretien IA', color: '#6366f1', autoAction: 'interview' },
  phone_interview: { label: 'Entretien téléphonique', color: '#0ea5e9' },
  video_interview: { label: 'Entretien visio', color: '#3b82f6' },
  onsite_interview: { label: 'Entretien présentiel', color: '#f59e0b' },
  other_interview: { label: 'Autre étape', color: '#14b8a6' },
  accepted: { label: 'Embauchés', color: '#10b981' },
}

/** Ordre habituel des colonnes : sert à insérer une colonne manquante à sa place logique. */
export const COLUMN_RANK: Record<string, number> = {
  pending: 0, screening: 1, interview: 2, phone_interview: 3, video_interview: 4, onsite_interview: 5, other_interview: 6, accepted: 7, on_hold: 8, rejected: 9,
}

const newId = () => Math.random().toString(36).slice(2, 8)

/** Funnel par défaut : Screening → Entretien IA → téléphonique → visio → présentiel → Embauché. */
export function defaultFunnel(): FunnelStep[] {
  return (['screening', 'ai_interview', 'phone', 'video', 'onsite', 'hired'] as StepType[]).map(type => ({ id: newId(), type, label: STEP_TYPES[type].label, status: 'todo' as StepStatus }))
}

/** Numérote les étapes d'un même type (« Entretien IA 1 », « Entretien IA 2 »…) sauf celles dont le libellé a été personnalisé. */
export function renumber(steps: FunnelStep[]): FunnelStep[] {
  const total: Partial<Record<StepType, number>> = {}
  steps.forEach(s => { total[s.type] = (total[s.type] ?? 0) + 1 })
  const seen: Partial<Record<StepType, number>> = {}
  return steps.map(s => {
    seen[s.type] = (seen[s.type] ?? 0) + 1
    if (s.custom) return s
    const base = STEP_TYPES[s.type].label
    return { ...s, label: (total[s.type] ?? 1) > 1 ? `${base} ${seen[s.type]}` : base }
  })
}

export const countOf = (steps: FunnelStep[], type: StepType) => steps.filter(s => s.type === type).length

/** Ajoute une étape du type demandé : après la dernière du même type, sinon avant « Embauché » (ou à la fin). */
export function addStep(steps: FunnelStep[], type: StepType): FunnelStep[] {
  if (steps.length >= FUNNEL_LIMITS.steps || countOf(steps, type) >= FUNNEL_LIMITS.perType) return steps
  const step: FunnelStep = { id: newId(), type, label: STEP_TYPES[type].label, status: 'todo' }
  const last = steps.map(s => s.type).lastIndexOf(type)
  const hiredIdx = steps.findIndex(s => s.type === 'hired')
  const at = last >= 0 ? last + 1 : hiredIdx >= 0 && type !== 'hired' ? hiredIdx : steps.length
  return renumber([...steps.slice(0, at), step, ...steps.slice(at)])
}

/** Retire la dernière étape non validée du type demandé (une étape déjà validée ne se supprime pas). */
export function removeLastOfType(steps: FunnelStep[], type: StepType): FunnelStep[] {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === type && steps[i].status !== 'validated') return renumber([...steps.slice(0, i), ...steps.slice(i + 1)])
  }
  return steps
}

/** Étape en cours : la première qui n'est ni validée ni passée. -1 = parcours terminé. */
export function currentIndex(steps: FunnelStep[]): number {
  return steps.findIndex(s => s.status !== 'validated' && s.status !== 'skipped')
}

export const columnOf = (step: FunnelStep) => STEP_TYPES[step.type].column

export function progress(steps: FunnelStep[]): { done: number; total: number; current: FunnelStep | null } {
  const done = steps.filter(s => s.status === 'validated' || s.status === 'skipped').length
  const i = currentIndex(steps)
  return { done, total: steps.length, current: i >= 0 ? steps[i] : null }
}

/**
 * Le candidat vient d'être déplacé dans une colonne du pipeline : le funnel suit. Les étapes non validées qui précèdent la
 * première étape de cette colonne sont marquées « passées ». Colonne absente du funnel (Vivier, Refusé…) : rien ne change.
 */
export function alignToColumn(steps: FunnelStep[], columnSlug: string): FunnelStep[] {
  const target = steps.findIndex(s => columnOf(s) === columnSlug && s.status !== 'validated' && s.status !== 'skipped')
  if (target < 0) return steps
  return steps.map((s, i) => (i < target && s.status !== 'validated' && s.status !== 'skipped' ? { ...s, status: 'skipped' as StepStatus } : s))
}

const STATUS_VALUES: StepStatus[] = ['todo', 'scheduled', 'done', 'validated', 'skipped']
const RESULT_VALUES: StepResult[] = ['positive', 'neutral', 'negative']

/** Valide et nettoie un funnel reçu du navigateur (ou lu en base). */
export function sanitizeFunnel(raw: unknown): { steps?: FunnelStep[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Le funnel doit contenir au moins une étape.' }
  if (raw.length > FUNNEL_LIMITS.steps) return { error: `Un funnel compte ${FUNNEL_LIMITS.steps} étapes au maximum.` }
  const ids = new Set<string>()
  const counts: Partial<Record<StepType, number>> = {}
  const steps: FunnelStep[] = []
  for (const r of raw) {
    const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const type = STEP_ORDER.includes(x.type as StepType) ? (x.type as StepType) : null
    if (!type) return { error: 'Type d’étape inconnu.' }
    counts[type] = (counts[type] ?? 0) + 1
    if ((counts[type] ?? 0) > FUNNEL_LIMITS.perType) return { error: `${STEP_TYPES[type].label} : ${FUNNEL_LIMITS.perType} étapes au maximum.` }
    let id = /^[a-z0-9]{4,8}$/.test(String(x.id ?? '')) ? String(x.id) : newId()
    while (ids.has(id)) id = newId()
    ids.add(id)
    const status = STATUS_VALUES.includes(x.status as StepStatus) ? (x.status as StepStatus) : 'todo'
    const report = typeof x.report === 'string' ? x.report.trim().slice(0, FUNNEL_LIMITS.report) : ''
    steps.push({
      id, type,
      label: String(x.label ?? '').replace(/\s+/g, ' ').trim().slice(0, FUNNEL_LIMITS.label) || STEP_TYPES[type].label,
      custom: x.custom === true ? true : undefined,
      status,
      result: RESULT_VALUES.includes(x.result as StepResult) ? (x.result as StepResult) : undefined,
      report: report || undefined,
      reportBy: report ? (x.reportBy === 'ai' ? 'ai' : 'manual') : undefined,
      validatedAt: status === 'validated' && typeof x.validatedAt === 'string' ? x.validatedAt.slice(0, 40) : undefined,
      validatedBy: status === 'validated' && typeof x.validatedBy === 'string' ? x.validatedBy.slice(0, 100) : undefined,
    })
  }
  return { steps }
}

/** Funnel d'un candidat : celui enregistré, sinon le funnel par défaut aligné sur sa colonne actuelle. */
export function funnelForCandidate(raw: unknown, currentColumn: string): { steps: FunnelStep[]; saved: boolean } {
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw) as { steps?: unknown }
      const s = sanitizeFunnel(parsed.steps)
      if (s.steps) return { steps: s.steps, saved: true }
    } catch { /* funnel illisible : on repart du défaut */ }
  }
  return { steps: alignToColumn(defaultFunnel(), currentColumn), saved: false }
}

export const serializeFunnel = (steps: FunnelStep[]) => JSON.stringify({ v: 1, steps })
