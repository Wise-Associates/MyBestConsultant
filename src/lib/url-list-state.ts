// Filtres d'une liste tenus dans l'état du composant et recopiés dans l'adresse par history.replaceState (« Mes
// offres », Suivi des annonces). L'adresse peut aussi changer sans la liste : lien vers la même page sans filtre (onglet
// « Tableau de bord » du sous-menu). La liste reprend alors les filtres de l'adresse, sinon elle resterait filtrée sous
// une adresse qui ne l'est pas, et « Retour » y ramènerait sans les filtres vus.
// Next applique replaceState à useSearchParams dans une transition : pendant une frappe rapide, une écriture plus
// ancienne de la liste arrive après la saisie suivante. Ces écritures sont notées pour ne pas être reprises comme une
// navigation (la saisie en cours serait remplacée par une plus ancienne). Règles pures, testées dans
// url-list-state.test.ts.

/** Écritures notées au plus : une frappe en produit une par caractère. */
const MAX_PENDING = 50

export interface UrlListSync {
  /** Filtres de l'adresse (forme normalisée) au dernier rendu. */
  seen: string
  /** Filtres écrits par la liste dont l'adresse n'a pas encore été vue. */
  pending: string[]
}

export const initialUrlListSync = (query: string): UrlListSync => ({ seen: query, pending: [] })

/** La liste écrit `query` dans l'adresse. Sans effet si l'adresse a déjà, ou aura déjà, ces filtres. */
export function noteListWrite(sync: UrlListSync, query: string): UrlListSync {
  if (query === (sync.pending.at(-1) ?? sync.seen)) return sync
  return { ...sync, pending: [...sync.pending, query].slice(-MAX_PENDING) }
}

/**
 * L'adresse montre `query` (filtres normalisés). `adopt` : changement venu d'ailleurs que la liste, à reprendre dans son
 * état. Une écriture de la liste n'est pas reprise ; la dernière vue, les écritures en attente sont toutes arrivées.
 */
export function syncFromUrl(sync: UrlListSync, query: string): { sync: UrlListSync; adopt: boolean } {
  if (query === sync.seen) return { sync, adopt: false }
  const index = sync.pending.lastIndexOf(query)
  if (index === -1) return { sync: { seen: query, pending: [] }, adopt: true }
  return { sync: { seen: query, pending: index === sync.pending.length - 1 ? [] : sync.pending }, adopt: false }
}
