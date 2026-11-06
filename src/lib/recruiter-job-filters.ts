import type { Job } from '@/types'
import type { JobFacts } from './recruiter-dashboard'

// Filtres de « Mes offres » sur le tableau de bord recruteur (demande du 2026-10-30, tuiles « À traiter » et tri ajoutés
// le 2026-11-02) : appliqués dans le navigateur, toutes les offres de l'organisation étant déjà chargées par la page,
// avec leurs faits (recruiter-dashboard.ts), et gardés dans l'adresse. Règles pures, testées dans
// recruiter-job-filters.test.ts.

/** « En ligne » = en ligne et non expirée ; « Archivées » = toutes les autres (archivées et expirées). */
export type JobStatusFilter = 'all' | 'active' | 'archived'
export type JobContract = NonNullable<Job['contractType']>
/** Ordre d'affichage des contrats, et ordre dans lequel une sélection est écrite. */
export const JOB_CONTRACTS: readonly JobContract[] = ['cdi', 'cdd', 'freelance', 'mission']
/** Tuiles « À traiter » : un clic garde les offres concernées. */
export type JobFocus = 'new' | 'noApplications' | 'diffusionFailed' | 'expiringSoon'
export type JobSort = 'recent' | 'applications' | 'score' | 'expiry'

export interface JobFilters {
  /** Intitulé, ville ou entreprise affichée ; sans tenir compte de la casse ni des accents. */
  q: string
  status: JobStatusFilter
  /** Contrats choisis (choix multiple, demande du 2026-11-06) ; vide = tous les contrats. */
  contract: JobContract[]
  focus: JobFocus | null
  sort: JobSort
}

export const EMPTY_JOB_FILTERS: JobFilters = { q: '', status: 'all', contract: [], focus: null, sort: 'recent' }

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
    if (f.contract.length > 0 && !(job.contractType && f.contract.includes(job.contractType))) return false
    if (f.focus && !matchesFocus(facts, f.focus)) return false
    return !q || fold([job.title, job.location, job.companyName ?? ''].join(' ')).includes(q)
  }).sort(COMPARE[f.sort])
}

/** Un filtre réduit la liste ; le tri n'en est pas un. */
export const isFiltering = (f: JobFilters) => f.q.trim() !== '' || f.status !== 'all' || f.contract.length > 0 || f.focus !== null

// Filtres gardés dans l'adresse (demande du 2026-11-04 : « Retour » depuis une offre retrouve la liste filtrée, comme un
// rechargement) : mêmes noms que les filtres des appels d'offres (src/lib/ao/filters.ts), valeurs par défaut omises.
const STATUSES: JobStatusFilter[] = ['all', 'active', 'archived']
const FOCUSES: JobFocus[] = ['new', 'noApplications', 'diffusionFailed', 'expiringSoon']
const SORTS: JobSort[] = ['recent', 'applications', 'score', 'expiry']
/** Recherche relue bornée : une adresse modifiée ne fait pas filtrer sur un texte démesuré. */
const MAX_QUERY = 200

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.find(v => v === value) ?? null

/** Sélection sans doublon, dans l'ordre de `JOB_CONTRACTS` : une même sélection donne toujours la même adresse. */
export const normalizeContracts = (list: readonly string[]): JobContract[] => JOB_CONTRACTS.filter(c => list.includes(c))

/** `contract=cdi,mission` (un seul contrat dans les anciens liens : `contract=cdi`) ; valeurs inconnues ignorées. */
const contractsFromParam = (value: string | null): JobContract[] => normalizeContracts((value ?? '').split(','))

/** Filtres lus dans l'adresse ; une valeur inconnue (ancien lien, adresse modifiée) reprend sa valeur par défaut. */
export function jobFiltersFromSearchParams(sp: URLSearchParams): JobFilters {
  return {
    q: (sp.get('q') ?? '').slice(0, MAX_QUERY),
    status: pick(sp.get('status'), STATUSES) ?? EMPTY_JOB_FILTERS.status,
    contract: contractsFromParam(sp.get('contract')),
    focus: pick(sp.get('focus'), FOCUSES),
    sort: pick(sp.get('sort'), SORTS) ?? EMPTY_JOB_FILTERS.sort,
  }
}

/** Copie de `sp` (autres paramètres de la page gardés : `recruteurs`, `offre`) avec les filtres `f`. */
export function withJobFilters(sp: URLSearchParams, f: JobFilters): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const key of ['q', 'status', 'contract', 'focus', 'sort']) next.delete(key)
  if (f.q) next.set('q', f.q)
  if (f.status !== EMPTY_JOB_FILTERS.status) next.set('status', f.status)
  if (f.contract.length > 0) next.set('contract', normalizeContracts(f.contract).join(','))
  if (f.focus) next.set('focus', f.focus)
  if (f.sort !== EMPTY_JOB_FILTERS.sort) next.set('sort', f.sort)
  return next
}

// Filtre par recruteur affecté (demande du 2026-11-03) : appliqué par le serveur, la page ne lit que les offres choisies
// et leurs candidatures. Dans l'adresse (`?recruteurs=<profil>,<profil>,aucun`) pour survivre à un rechargement et se
// partager. Profils (users.$id, ADR 0023) ; « aucun » = offres sans recruteur affecté.

export const RECRUITERS_PARAM = 'recruteurs'
const UNASSIGNED = 'aucun'

export interface RecruiterSelection {
  /** Profils des recruteurs choisis, dans l'ordre de l'équipe. */
  ids: string[]
  /** Offres sans recruteur affecté (« Non affectées »). */
  unassigned: boolean
}

/**
 * Sélection lue dans l'adresse. Seuls les recruteurs de l'équipe (`team`, profils) sont gardés : un identifiant
 * inconnu (recruteur parti, adresse modifiée) est ignoré. Rien de valable : null, toutes les offres.
 */
export function parseRecruiterSelection(raw: string | string[] | undefined, team: string[]): RecruiterSelection | null {
  const values = new Set((Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map(value => value.trim()))
  const selection = { ids: team.filter(id => values.has(id)), unassigned: values.has(UNASSIGNED) }
  return selection.ids.length > 0 || selection.unassigned ? selection : null
}

/** Valeur de `?recruteurs=` ('' : aucun filtre). */
export const recruiterSelectionParam = (selection: RecruiterSelection) =>
  [...selection.ids, ...(selection.unassigned ? [UNASSIGNED] : [])].join(',')
