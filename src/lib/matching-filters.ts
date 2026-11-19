import { SOURCING_MIN_SCORE } from './sourcing-rules'
import { REVIEW_STATUSES, type ReviewStatus } from './match-review'

// Filtres de la page Matching IA d'une offre (/recruiter/pipeline/<offre>/matching, demande du 2026-11-04) : type de
// candidat, score, revue des correspondances de la base (ADR 0047) et recherche par nom, e-mail, ville ou compétence.
// Appliqués dans le navigateur (toutes les correspondances sont lues par la page) et gardés dans l'adresse, comme ceux de « Mes offres » : « Retour » depuis un profil les retrouve.
// Règles pures, testées dans matching-filters.test.ts.

export type MatchSource = 'application' | 'pool' | 'vivier'
export type MatchSourceFilter = 'all' | MatchSource
/** « Correspond » = noté SOURCING_MIN_SCORE (65) ou plus, le seuil du vivier et du sourcing ; « pending » = pas encore noté. */
export type MatchScoreFilter = 'all' | 'match' | 'below' | 'pending'
/** Revue d'une correspondance de la base candidats ; les candidatures et le vivier n'en ont pas. */
export type MatchReviewFilter = 'all' | ReviewStatus

export interface MatchingFilters {
  /** Nom, e-mail, ville ou compétence ; sans tenir compte de la casse ni des accents. */
  q: string
  source: MatchSourceFilter
  score: MatchScoreFilter
  review: MatchReviewFilter
}

export const EMPTY_MATCHING_FILTERS: MatchingFilters = { q: '', source: 'all', score: 'all', review: 'all' }

export interface MatchRow {
  source: MatchSource
  name: string
  email: string
  score: number | null
  review?: ReviewStatus
  city?: string
  skills?: string[]
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

/**
 * Correspondances qui passent les filtres, dans leur ordre (meilleur score d'abord, tri de la page). Un filtre de revue
 * ne garde que la base candidats (seule à en avoir une).
 */
export function filterMatches<T extends MatchRow>(rows: T[], f: MatchingFilters): T[] {
  const q = fold(f.q.trim())
  return rows.filter(r =>
    (f.source === 'all' || r.source === f.source)
    && scoreMatches(r.score, f.score)
    && (f.review === 'all' || (r.source === 'pool' && (r.review ?? 'nouveau') === f.review))
    && (!q || fold(`${r.name} ${r.email} ${r.city ?? ''} ${(r.skills ?? []).join(' ')}`).includes(q)))
}

export const isFilteringMatches = (f: MatchingFilters) => f.q.trim() !== '' || f.source !== 'all' || f.score !== 'all' || f.review !== 'all'

const SOURCES: MatchSourceFilter[] = ['all', 'application', 'pool', 'vivier']
const SCORES: MatchScoreFilter[] = ['all', 'match', 'below', 'pending']
const REVIEWS: MatchReviewFilter[] = ['all', ...REVIEW_STATUSES]
/** Recherche relue bornée : une adresse modifiée ne fait pas filtrer sur un texte démesuré. */
const MAX_QUERY = 200

/** Filtres lus dans l'adresse ; une valeur inconnue (ancien lien, adresse modifiée) reprend sa valeur par défaut. */
export function matchingFiltersFromSearchParams(sp: URLSearchParams): MatchingFilters {
  return {
    q: (sp.get('q') ?? '').slice(0, MAX_QUERY),
    source: SOURCES.find(s => s === sp.get('type')) ?? EMPTY_MATCHING_FILTERS.source,
    score: SCORES.find(s => s === sp.get('score')) ?? EMPTY_MATCHING_FILTERS.score,
    review: REVIEWS.find(s => s === sp.get('revue')) ?? EMPTY_MATCHING_FILTERS.review,
  }
}

/** Copie de `sp` (autres paramètres gardés) avec les filtres `f`, valeurs par défaut omises. */
export function withMatchingFilters(sp: URLSearchParams, f: MatchingFilters): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const key of ['q', 'type', 'score', 'revue']) next.delete(key)
  if (f.q) next.set('q', f.q)
  if (f.source !== 'all') next.set('type', f.source)
  if (f.score !== 'all') next.set('score', f.score)
  if (f.review !== 'all') next.set('revue', f.review)
  return next
}
