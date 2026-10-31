// Sous-menu de l'espace recruteur (src/components/recruiter/recruiter-subnav.tsx, dans le layout recruteur) : les
// rubriques, dans l'ordre affiché, et la rubrique d'une page. Demande du 2026-10-30 : un sous-menu à la place des
// cartes du tableau de bord. Règles pures, testées dans recruiter-nav.test.ts.

export type RecruiterSectionKey = 'espace' | 'dashboard' | 'ao' | 'parcours' | 'reporting' | 'vivier' | 'cvtheque' | 'equipe' | 'interviews'

export interface RecruiterSection {
  key: RecruiterSectionKey
  label: string
  href: string
  /** Autres pages de la rubrique : la rubrique reste en surbrillance sur elles (et leurs sous-pages). */
  also: string[]
}

export const RECRUITER_SECTIONS: RecruiterSection[] = [
  // Espace du recruteur : ses recrutements et leur avancement (demande de Dav du 2026-10-31).
  { key: 'espace', label: 'Mon espace', href: '/recruiter/espace', also: [] },
  // Pipeline, fiche candidat, import, processus de recrutement et suivi des annonces (lien « Suivi & rapports » de
  // « Mes offres », sans rubrique depuis le 2026-10-30) partent des offres du tableau de bord.
  { key: 'dashboard', label: 'Tableau de bord', href: '/recruiter/dashboard', also: ['/recruiter/pipeline', '/recruiter/candidates', '/recruiter/candidate-preview', '/recruiter/import', '/recruiter/funnel', '/recruiter/annonces'] },
  { key: 'ao', label: 'Appels d’offres', href: '/recruiter/parametres/boites-ao', also: [] },
  // Parcours consultant, de l'AO à la facture (ADR 0021, demande du 2026-10-30).
  { key: 'parcours', label: 'Parcours', href: '/recruiter/parcours', also: [] },
  { key: 'reporting', label: 'Reporting', href: '/recruiter/reporting', also: [] },
  { key: 'vivier', label: 'Mon vivier', href: '/recruiter/vivier', also: [] },
  { key: 'cvtheque', label: 'CV Thèque', href: '/recruiter/cvtheque', also: [] },
  // La marque employeur se gère depuis la page de l'équipe.
  { key: 'equipe', label: 'Mon équipe', href: '/recruiter/equipe', also: ['/recruiter/marque-employeur'] },
  // Le screening des CV n'a pas de rubrique : il est rangé avec les entretiens IA (lien sur leur page).
  { key: 'interviews', label: 'Entretiens IA', href: '/recruiter/interviews', also: ['/recruiter/screening'] },
]

/** `path` est `base` ou une de ses sous-pages (« /recruiter/vivier/abc », pas « /recruiter/viviers »). */
const isUnder = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** Rubrique de la page `pathname` ; null pour une page hors rubrique (support…). */
export function recruiterSectionOf(pathname: string): RecruiterSectionKey | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  return RECRUITER_SECTIONS.find(section => [section.href, ...section.also].some(base => isUnder(path, base)))?.key ?? null
}

/** Sous-menu affiché sur la page ? Pas sur « Mon espace », qui regroupe déjà toutes les rubriques dans un seul bloc (demande du 2026-10-31). */
export const showsRecruiterSubnav = (pathname: string) => recruiterSectionOf(pathname) !== 'espace'
