import type { Job } from '@/types'
import type { JobFacts } from './recruiter-dashboard'

// Filtres de « Mes offres » sur le tableau de bord recruteur (demande du 2026-10-30, tuiles « À traiter » et tri ajoutés
// le 2026-11-02) : appliqués dans le navigateur, toutes les offres de l'organisation étant déjà chargées par la page,
// avec leurs faits (recruiter-dashboard.ts). Règles pures, testées dans recruiter-job-filters.test.ts.

/** « En ligne » = en ligne et non expirée ; « Archivées » = toutes les autres (archivées et expirées). */
export type JobStatusFilter = 'all' | 'active' | 'archived'
export type JobContractFilter = 'all' | NonNullable<Job['contractType']>
/** Tuiles « À traiter » : un clic garde les offres concernées. */
export type JobFocus = 'new' | 'noApplications' | 'diffusionFailed' | 'expiringSoon'
export type JobSort = 'recent' | 'applications' | 'score' | 'expiry'

export interface JobFilters {
  /** Intitulé, ville ou entreprise affichée ; sans tenir compte de la casse ni des accents. */
  q: string
  status: JobStatusFilter
  contract: JobContractFilter
  focus: JobFocus | null
  sort: JobSort
}

export const EMPTY_JOB_FILTERS: JobFilters = { q: '', status: 'all', contract: 'all', focus: null, sort: 'recent' }

export interface JobRow {
  job: Pick<Job, 'title' | 'location' | 'contractType' | 'companyName' | 'createdAt' | 'expiresAt'>
  facts: JobFacts
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function matchesFocus(facts: JobFacts, focus: JobFocus): boolean {
  switch (focus) {
    case 'new': return facts.newApplications > 0
    case 'noApplications': return facts.state === 'online' && facts.applications === 0
    case 'diffusionFailed': return facts.diffusionFailed
    case 'expiringSoon': return facts.expiresInDays !== null
  }
}

const byRecent = (a: JobRow, b: JobRow) => (b.job.createdAt > a.job.createdAt ? 1 : b.job.createdAt < a.job.createdAt ? -1 : 0)
/** Valeur absente (pas de score, pas d'échéance) toujours en fin de liste, quel que soit le sens. */
const nullsLast = (a: number | null, b: number | null) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : 0)
/** Échéance d'une offre en ligne seulement : une offre archivée ou expirée n'a plus rien de « proche ». */
const onlineExpiry = (r: JobRow) => (r.facts.state === 'online' && r.job.expiresAt ? Date.parse(r.job.expiresAt) : null)

const COMPARE: Record<JobSort, (a: JobRow, b: JobRow) => number> = {
  recent: byRecent,
  applications: (a, b) => b.facts.applications - a.facts.applications || byRecent(a, b),
  score: (a, b) => nullsLast(a.facts.avgScore, b.facts.avgScore) || (b.facts.avgScore ?? 0) - (a.facts.avgScore ?? 0) || byRecent(a, b),
  expiry: (a, b) => {
    const ea = onlineExpiry(a), eb = onlineExpiry(b)
    return nullsLast(ea, eb) || (ea ?? 0) - (eb ?? 0) || byRecent(a, b)
  },
}

/** Lignes qui passent les filtres, triées. */
export function filterJobs<T extends JobRow>(rows: T[], f: JobFilters): T[] {
  const q = fold(f.q.trim())
  return rows.filter(({ job, facts }) => {
    if (f.status === 'active' && facts.state !== 'online') return false
    if (f.status === 'archived' && facts.state === 'online') return false
    if (f.contract !== 'all' && job.contractType !== f.contract) return false
    if (f.focus && !matchesFocus(facts, f.focus)) return false
    return !q || fold([job.title, job.location, job.companyName ?? ''].join(' ')).includes(q)
  }).sort(COMPARE[f.sort])
}

/** Un filtre réduit la liste ; le tri n'en est pas un. */
export const isFiltering = (f: JobFilters) => f.q.trim() !== '' || f.status !== 'all' || f.contract !== 'all' || f.focus !== null
