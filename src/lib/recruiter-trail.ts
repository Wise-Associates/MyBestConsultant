import { RECRUITER_SECTIONS } from './recruiter-nav'

// Lien « ← Retour : <page d'origine> » des pages de détail de l'espace recruteur (demande du 2026-11-04 : un retour
// intuitif, qui ramène là d'où l'on vient, filtres compris). Le layout recruteur note les pages visitées dans l'onglet
// (src/components/recruiter/back-link.tsx, sessionStorage) ; ces règles pures disent quoi noter, où renvoyer et comment
// nommer la page d'origine. Testées dans recruiter-trail.test.ts.

/** Pages gardées : assez pour revenir de quelques crans, sans grossir le stockage de l'onglet. */
export const TRAIL_MAX = 10

/** Adresse d'une page de l'espace recruteur, relative au site (pas « //autre-site/recruiter »). */
const RECRUITER_URL = /^\/recruiter(?:[/?#]|$)/

const pathOf = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, '') || '/'

/**
 * Pages visitées après l'arrivée sur `url`. Même page (seuls les paramètres changent : filtres, onglet) : son dernier
 * état remplace le précédent. Retour à la page d'avant (Précédent du navigateur, lien « Retour », ou lien vers elle) :
 * on revient d'un cran, pour que cette page renvoie de nouveau à sa propre origine. Sinon, la page s'ajoute.
 * Rend `trail` lui-même quand rien ne change.
 */
export function recordVisit(trail: readonly string[], url: string): string[] {
  if (!RECRUITER_URL.test(url)) return trail as string[]
  const path = pathOf(url)
  const last = trail.at(-1)
  if (last !== undefined && pathOf(last) === path) return last === url ? trail as string[] : [...trail.slice(0, -1), url]
  const previous = trail.at(-2)
  if (previous !== undefined && pathOf(previous) === path) return [...trail.slice(0, -2), url]
  return [...trail, url].slice(-TRAIL_MAX)
}

/**
 * Page où renvoie « Retour » sur la page `pathname` : celle visitée juste avant dans l'onglet. Null quand il n'y en a
 * pas (page ouverte directement, dans un nouvel onglet, après un rechargement sans historique) : la page affiche alors
 * sa page parente. La page affichée est comptée même si elle n'est pas encore notée : la réponse ne dépend pas de
 * l'ordre dans lequel React affiche le lien et note la page.
 */
export function backTarget(trail: readonly string[], pathname: string): string | null {
  const visited = recordVisit(trail, pathname)
  const last = visited.at(-1)
  if (last === undefined || pathOf(last) !== pathOf(pathname)) return null
  return visited.at(-2) ?? null
}

/** Pages relues dans le stockage de l'onglet ; tout ce qui n'est pas une adresse de l'espace recruteur est écarté. */
export function parseTrail(raw: string | null): string[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // Valeur abîmée ou écrite par une autre version : on repart d'un historique vide, rien d'autre n'en dépend.
    return []
  }
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && RECRUITER_URL.test(v)).slice(-TRAIL_MAX)
}

// Pages hors rubrique du sous-menu, dans l'ordre où les chercher : une sous-page fixe (« new », « boites ») avant la
// page d'un élément au même niveau.
const PAGE_LABELS: [RegExp, string][] = [
  [/^\/recruiter\/pipeline\/[^/]+$/, 'Pipeline de l’offre'],
  [/^\/recruiter\/pipeline\/[^/]+\/matching$/, 'Matching IA'],
  [/^\/recruiter\/candidates\/[^/]+$/, 'Fiche candidat'],
  [/^\/recruiter\/candidate-preview\/[^/]+\/[^/]+$/, 'Profil du candidat'],
  [/^\/recruiter\/annonces$/, 'Suivi des annonces'],
  [/^\/recruiter\/annonces\/[^/]+$/, 'Rapport de l’annonce'],
  [/^\/recruiter\/vivier\/[^/]+$/, 'Vivier de l’offre'],
  [/^\/recruiter\/parametres\/boites-ao\/boites$/, 'Boîtes AO'],
  [/^\/recruiter\/parametres\/boites-ao\/statistiques$/, 'Statistiques AO'],
  [/^\/recruiter\/parametres\/boites-ao\/[^/]+$/, 'Appel d’offres'],
  [/^\/recruiter\/marque-employeur$/, 'Marque employeur'],
  [/^\/recruiter\/interviews\/new$/, 'Nouvel entretien'],
  [/^\/recruiter\/interviews\/questions$/, 'Questions génériques'],
  [/^\/recruiter\/interviews\/[^/]+$/, 'Entretien IA'],
  [/^\/recruiter\/interviews\/[^/]+\/room$/, 'Salle d’entretien'],
  [/^\/recruiter\/screening$/, 'Screening IA'],
  [/^\/recruiter\/screening\/best$/, 'Meilleurs candidats'],
  [/^\/recruiter\/screening\/[^/]+$/, 'Screening de l’offre'],
  [/^\/recruiter\/import$/, 'Import d’offres'],
  [/^\/recruiter\/support$/, 'Support'],
  [/^\/recruiter\/support\/[^/]+$/, 'Demande au support'],
]

/** Nom de la page `url` dans « Retour : <nom> » : la rubrique du sous-menu, ou la page de détail. */
export function recruiterPageLabel(url: string): string {
  const path = pathOf(url)
  // L'onglet « Vivier général » de /recruiter/vivier est gardé dans l'adresse (vivier-tabs.tsx).
  if (path === '/recruiter/vivier' && new URLSearchParams(url.split('?')[1]?.split('#')[0] ?? '').get('vue') === 'general') return 'Vivier général'
  const section = RECRUITER_SECTIONS.find(s => s.href === path)
  if (section) return section.label
  return PAGE_LABELS.find(([pattern]) => pattern.test(path))?.[1] ?? 'Page précédente'
}
