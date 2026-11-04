// Vue de « Suivi des annonces » (/recruiter/annonces) gardée dans l'adresse (demande du 2026-11-04 : « Retour » depuis
// le rapport d'une annonce, Précédent du navigateur et rechargement retrouvent la recherche, le statut, le tri et la page).
// Filtres appliqués dans le navigateur (annonces-client.tsx) ; mêmes noms de paramètres que « Mes offres »
// (recruiter-job-filters.ts), valeurs par défaut omises. Règles pures, testées dans annonces-filters.test.ts.

export type AnnoncesStatus = 'all' | 'active' | 'archived'
export type AnnoncesSort = 'recent' | 'candidates' | 'score' | 'todo'

export interface AnnoncesView {
  /** Intitulé, lieu ou nom d'un candidat. */
  q: string
  status: AnnoncesStatus
  sort: AnnoncesSort
  /** Page de la liste, à partir de 1 (ramenée à la dernière page par la liste si elle la dépasse). */
  page: number
}

export const DEFAULT_ANNONCES_VIEW: AnnoncesView = { q: '', status: 'all', sort: 'recent', page: 1 }

const STATUSES: AnnoncesStatus[] = ['all', 'active', 'archived']
const SORTS: AnnoncesSort[] = ['recent', 'candidates', 'score', 'todo']
/** Recherche relue bornée : une adresse modifiée ne fait pas filtrer sur un texte démesuré. */
const MAX_QUERY = 200

/** Vue lue dans l'adresse ; une valeur inconnue (ancien lien, adresse modifiée) reprend sa valeur par défaut. */
export function annoncesViewFromSearchParams(sp: URLSearchParams): AnnoncesView {
  const page = Number.parseInt(sp.get('page') ?? '', 10)
  return {
    q: (sp.get('q') ?? '').slice(0, MAX_QUERY),
    status: STATUSES.find(s => s === sp.get('status')) ?? DEFAULT_ANNONCES_VIEW.status,
    sort: SORTS.find(s => s === sp.get('sort')) ?? DEFAULT_ANNONCES_VIEW.sort,
    page: Number.isFinite(page) && page > 1 ? page : 1,
  }
}

/** Copie de `sp` avec la vue `v` (autres paramètres de la page gardés). */
export function withAnnoncesView(sp: URLSearchParams, v: AnnoncesView): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const key of ['q', 'status', 'sort', 'page']) next.delete(key)
  if (v.q) next.set('q', v.q)
  if (v.status !== DEFAULT_ANNONCES_VIEW.status) next.set('status', v.status)
  if (v.sort !== DEFAULT_ANNONCES_VIEW.sort) next.set('sort', v.sort)
  if (v.page > 1) next.set('page', String(v.page))
  return next
}
