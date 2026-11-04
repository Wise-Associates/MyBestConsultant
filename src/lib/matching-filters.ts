import { SOURCING_MIN_SCORE } from './sourcing-rules'

// Filtres de la page Matching IA d'une offre (/recruiter/pipeline/<offre>/matching, demande du 2026-11-04) : type de
// candidat, score et recherche par nom ou e-mail. Appliqués dans le navigateur (toutes les correspondances sont lues
// par la page) et gardés dans l'adresse, comme ceux de « Mes offres » : « Retour » depuis un profil les retrouve.
// Règles pures, testées dans matching-filters.test.ts.

export type MatchSource = 'application' | 'pool' | 'vivier'
export type MatchSourceFilter = 'all' | MatchSource
/** « Correspond » = noté SOURCING_MIN_SCORE (65) ou plus, le seuil du vivier et du sourcing ; « pending » = pas encore noté. */
export type MatchScoreFilter = 'all' | 'match' | 'below' | 'pending'

export interface MatchingFilters {
  /** Nom ou e-mail ; sans tenir compte de la casse ni des accents. */
  q: string
  source: MatchSourceFilter
  score: MatchScoreFilter
}

export const EMPTY_MATCHING_FILTERS: MatchingFilters = { q: '', source: 'all', score: 'all' }

export interface MatchRow {
  source: MatchSource
  name: string
  email: string
  score: number | null
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function scoreMatches(score: number | null, filter: MatchScoreFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'match': return score !== null && score >= SOURCING_MIN_SCORE
    case 'below': return score !== null && score < SOURCING_MIN_SCORE
    case 'pending': return score === null
  }
}

/** Correspondances qui passent les filtres, dans leur ordre (meilleur score d'abord, tri de la page). */
export function filterMatches<T extends MatchRow>(rows: T[], f: MatchingFilters): T[] {
  const q = fold(f.q.trim())
  return rows.filter(r =>
    (f.source === 'all' || r.source === f.source)
    && scoreMatches(r.score, f.score)
    && (!q || fold(`${r.name} ${r.email}`).includes(q)))
}

export const isFilteringMatches = (f: MatchingFilters) => f.q.trim() !== '' || f.source !== 'all' || f.score !== 'all'

const SOURCES: MatchSourceFilter[] = ['all', 'application', 'pool', 'vivier']
const SCORES: MatchScoreFilter[] = ['all', 'match', 'below', 'pending']
/** Recherche relue bornée : une adresse modifiée ne fait pas filtrer sur un texte démesuré. */
const MAX_QUERY = 200

/** Filtres lus dans l'adresse ; une valeur inconnue (ancien lien, adresse modifiée) reprend sa valeur par défaut. */
export function matchingFiltersFromSearchParams(sp: URLSearchParams): MatchingFilters {
  return {
    q: (sp.get('q') ?? '').slice(0, MAX_QUERY),
    source: SOURCES.find(s => s === sp.get('type')) ?? EMPTY_MATCHING_FILTERS.source,
    score: SCORES.find(s => s === sp.get('score')) ?? EMPTY_MATCHING_FILTERS.score,
  }
}

/** Copie de `sp` (autres paramètres gardés) avec les filtres `f`, valeurs par défaut omises. */
export function withMatchingFilters(sp: URLSearchParams, f: MatchingFilters): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const key of ['q', 'type', 'score']) next.delete(key)
  if (f.q) next.set('q', f.q)
  if (f.source !== 'all') next.set('type', f.source)
  if (f.score !== 'all') next.set('score', f.score)
  return next
}
