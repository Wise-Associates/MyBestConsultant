// Menu latéral de l'espace recruteur (src/components/recruiter/recruiter-sidebar.tsx, dans le layout recruteur) : les
// rubriques, leurs groupes, dans l'ordre affiché, et la rubrique d'une page. Demande du 2026-11-13 : un menu à gauche à la
// place du sous-menu horizontal (2026-10-30), MBC Search en premier, rubriques rangées en trois groupes.
// Règles pures, testées dans recruiter-nav.test.ts.

export type RecruiterSectionKey =
  | 'dashboard' | 'funnel' | 'ao' | 'reporting' | 'vivier' | 'cvtheque' | 'mbcsearch' | 'equipe' | 'interviews'
  | 'utilisateurs' | 'abonnement' | 'organisation'

/** `compte` : rubriques du bas du menu (utilisateurs, abonnement, organisation), hors des groupes du haut. */
export type RecruiterGroupKey = 'recherche' | 'recrutement' | 'pilotage' | 'compte'

export interface RecruiterSection {
  key: RecruiterSectionKey
  label: string
  href: string
  group: RecruiterGroupKey
  /** Autres pages de la rubrique : la rubrique reste en surbrillance sur elles (et leurs sous-pages). */
  also: string[]
}

/** Groupes du haut du menu, dans l'ordre affiché (le groupe « compte » est en bas : recruiterAccountSections). */
export const RECRUITER_GROUPS: { key: RecruiterGroupKey; label: string }[] = [
  { key: 'recherche', label: 'Recherche' },
  { key: 'recrutement', label: 'Recrutement' },
  { key: 'pilotage', label: 'Pilotage' },
]

/** Rubriques dans l'ordre du menu : celles d'un même groupe se suivent. */
export const RECRUITER_SECTIONS: RecruiterSection[] = [
  // Recherche de profils hors de la plateforme, via Apollo.io (ADR 0018) ; page d'arrivée du recruteur (dashboard-routes.ts).
  { key: 'mbcsearch', label: 'MBC Search', href: '/recruiter/mbc-search', group: 'recherche', also: [] },
  { key: 'cvtheque', label: 'CV Thèque', href: '/recruiter/cvtheque', group: 'recherche', also: [] },
  { key: 'vivier', label: 'Mon vivier', href: '/recruiter/vivier', group: 'recherche', also: [] },
  // Pipeline d'une offre, fiche candidat, import et suivi des annonces (lien « Suivi & rapports » de « Mes offres », sans
  // rubrique depuis le 2026-10-30) partent des offres du tableau de bord.
  // Libellé « Job board » (demande du 2026-11-13, à la place de « Tableau de bord ») : aussi dans les liens « Retour ».
  { key: 'dashboard', label: 'Job board', href: '/recruiter/dashboard', group: 'recrutement', also: ['/recruiter/pipeline', '/recruiter/candidates', '/recruiter/candidate-preview', '/recruiter/import', '/recruiter/annonces'] },
  // Processus de recrutement : pipelines, phases et statuts de l'organisation.
  { key: 'funnel', label: 'Pipelines', href: '/recruiter/funnel', group: 'recrutement', also: [] },
  { key: 'ao', label: 'Appels d’offres', href: '/recruiter/parametres/boites-ao', group: 'recrutement', also: [] },
  // Le screening des CV n'a pas de rubrique : il est rangé avec les entretiens IA (lien sur leur page).
  { key: 'interviews', label: 'Entretiens IA', href: '/recruiter/interviews', group: 'recrutement', also: ['/recruiter/screening'] },
  { key: 'reporting', label: 'Reporting', href: '/recruiter/reporting', group: 'pilotage', also: [] },
  // La marque employeur se gère depuis la page de l'équipe.
  { key: 'equipe', label: 'Mon équipe', href: '/recruiter/equipe', group: 'pilotage', also: ['/recruiter/marque-employeur'] },
  // Bas du menu (demande du 2026-11-13, ADR 0033), derrière le sélecteur de l'organisation : son identité, ses comptes,
  // son abonnement (ordre de la maquette).
  { key: 'organisation', label: 'Organisation', href: '/recruiter/organisation', group: 'compte', also: [] },
  { key: 'utilisateurs', label: 'Utilisateurs', href: '/recruiter/utilisateurs', group: 'compte', also: [] },
  { key: 'abonnement', label: 'Abonnement', href: '/recruiter/abonnement', group: 'compte', also: [] },
]

/** Rubriques du bas du menu, dans l'ordre affiché. */
export function recruiterAccountSections(): RecruiterSection[] {
  return RECRUITER_SECTIONS.filter(section => section.group === 'compte')
}

/** Groupes du menu avec leurs rubriques, dans l'ordre affiché ; un groupe sans rubrique n'est pas affiché. */
export function recruiterNavGroups(): { key: RecruiterGroupKey; label: string; sections: RecruiterSection[] }[] {
  return RECRUITER_GROUPS
    .map(group => ({ ...group, sections: RECRUITER_SECTIONS.filter(section => section.group === group.key) }))
    .filter(group => group.sections.length > 0)
}

/** `path` est `base` ou une de ses sous-pages (« /recruiter/vivier/abc », pas « /recruiter/viviers »). */
const isUnder = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** Rubrique de la page `pathname` ; null pour une page hors rubrique (support…). */
export function recruiterSectionOf(pathname: string): RecruiterSectionKey | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  return RECRUITER_SECTIONS.find(section => [section.href, ...section.also].some(base => isUnder(path, base)))?.key ?? null
}

/** Cookie qui garde le menu latéral réduit à ses icônes (choix du recruteur, lu par le layout pour éviter un saut). */
export const SIDEBAR_COOKIE = 'mbc-recruiter-sidebar'
