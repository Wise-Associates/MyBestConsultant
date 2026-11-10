// Tableau de bord du chasseur (/hunter/dashboard) : les cartes de chiffres filtrent la liste des propositions, comme les
// tuiles « À traiter » du tableau de bord recruteur (demande du 2026-11-10). Pur, utilisable dans le navigateur, testé
// (hunter-dashboard.test.ts) : le chiffre d'une carte et la liste qu'elle affiche viennent de la même règle.

export type ProposalFilter = 'toutes' | 'en-cours' | 'retenus'

const FILTERS: readonly ProposalFilter[] = ['toutes', 'en-cours', 'retenus']

/** Propositions affichées sans filtre (les plus récentes) et, avec un filtre, au plus (le reste sur « Mes propositions »). */
const LATEST = 5
const FILTERED_MAX = 20

/** Filtre lu dans l'adresse (`?propositions=`) ; null sans filtre ou pour une valeur inconnue. */
export function parseProposalFilter(value: unknown): ProposalFilter | null {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value) ? value as ProposalFilter : null
}

/** En cours de traitement chez le recruteur : ni seulement reçue, ni gardée en vivier, ni décidée (retenue ou non). */
const inProgress = (status: string) => !['pending', 'rejected', 'accepted', 'on_hold'].includes(status)

export function filterProposals<T extends { status: string }>(proposals: T[], filter: ProposalFilter): T[] {
  if (filter === 'en-cours') return proposals.filter(p => inProgress(p.status))
  if (filter === 'retenus') return proposals.filter(p => p.status === 'accepted')
  return proposals
}

/** Chiffre de chaque carte : le nombre de propositions que son filtre affiche (avant la limite d'affichage). */
export function proposalCounts(proposals: { status: string }[]): Record<ProposalFilter, number> {
  return Object.fromEntries(FILTERS.map(f => [f, filterProposals(proposals, f).length])) as Record<ProposalFilter, number>
}

/** Propositions de la liste du tableau de bord (les plus récentes d'abord, ordre reçu). */
export function proposalsShown<T extends { status: string }>(proposals: T[], filter: ProposalFilter | null): T[] {
  return filter ? filterProposals(proposals, filter).slice(0, FILTERED_MAX) : proposals.slice(0, LATEST)
}

/**
 * Pages de l'espace chasseur en pleine largeur à partir de 1440 px (jusqu'à 1920 px), lue par HunterShell. Les rubriques
 * (HunterSubnav) gardent la même largeur sur toutes les pages (demande du 2026-11-10).
 */
export function isWideHunterPage(pathname: string): boolean {
  return pathname === '/hunter/dashboard'
}
