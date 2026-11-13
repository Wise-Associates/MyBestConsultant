import { expandLocationSearch, normalizeLocation } from '@/lib/regions'

// Recherche de la CV Thèque du recruteur (/recruiter/cvtheque, refonte du 2026-11-13 : barre de recherche et filtres à
// gauche, à la manière des outils de recherche de profils). Règles pures, testées dans cvtheque-search.test.ts : lecture
// d'une recherche « java AND "react native" », filtres, valeurs proposées. Le filtrage se fait dans le navigateur, sur
// les profils déjà chargés par la page (ceux qui ont un CV).

/** Ce que la recherche lit d'un candidat (CvThequeCandidate le fournit). */
export interface SearchableCandidate {
  name: string
  city: string
  mobilityRadiusKm: number | null
  skills: string[]
  experienceSummary: string
  experiences: { title: string; company: string; missions: string[] }[]
  education: { degree: string; school: string }[]
  languages: { name: string }[]
  yearsOfExperience: number | null
  openToWork: boolean
  desiredSector: string[]
  desiredRoles: string[]
  createdAt: string
}

export const EXPERIENCE_MAX = 15
export const RADIUS_MAX = 100

export interface CvthequeFilters {
  /** Barre de recherche : nom, compétences, postes, expériences, formation, langues, lieu. */
  query: string
  /** Mots ou expressions : un profil qui en contient un est écarté. */
  exclude: string
  availableOnly: boolean
  /** Ajoutés à la CV Thèque depuis moins de N jours (0 : tous). */
  addedWithinDays: 0 | 7 | 30
  /** Années d'expérience ; la borne haute à EXPERIENCE_MAX veut dire « et plus ». */
  experience: [number, number]
  /** Rayon de mobilité en km ; la borne haute à RADIUS_MAX veut dire « et plus ». */
  radius: [number, number]
  location: string
  /** Toutes requises. */
  skills: string[]
  /** L'un d'eux suffit. */
  sectors: string[]
  /** Toutes requises. */
  languages: string[]
  /** Entreprise actuelle ou passée. */
  company: string
  /** École ou diplôme. */
  school: string
  /** Recherche sur les postes visés et les intitulés des expériences. */
  titleQuery: string
  /** Recherche sur les expériences (intitulé, entreprise, missions). */
  experienceQuery: string
}

export const EMPTY_FILTERS: CvthequeFilters = {
  query: '', exclude: '', availableOnly: false, addedWithinDays: 0, experience: [0, EXPERIENCE_MAX], radius: [0, RADIUS_MAX],
  location: '', skills: [], sectors: [], languages: [], company: '', school: '', titleQuery: '', experienceQuery: '',
}

/**
 * Minuscules, sans accents, tirets lus comme des espaces : « Île-de-France » et « ile de france » se valent, comme
 * « back-end » et « back end » (les lieux étendus par regions.ts s'écrivent sans tirets).
 */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-\s]+/g, ' ').trim()
}

/**
 * Recherche écrite par le recruteur, en groupes : un profil correspond s'il contient tous les termes d'au moins un groupe.
 * Termes séparés par des espaces (tous requis), « OR » ou « OU » entre deux termes (l'un ou l'autre), expressions entre
 * guillemets. « AND » / « ET » sont acceptés et ne changent rien. Les opérateurs ne comptent qu'en majuscules : « chef de
 * projet ou PMO » cherche aussi le mot « ou ».
 */
export function parseQuery(text: string): string[][] {
  const tokens = [...text.matchAll(/"([^"]*)"|(\S+)/g)].map(m => (m[1] !== undefined ? { term: m[1], quoted: true } : { term: m[2], quoted: false }))
  const groups: string[][] = [[]]
  for (const { term, quoted } of tokens) {
    if (!quoted && (term === 'OR' || term === 'OU')) {
      if (groups[groups.length - 1].length > 0) groups.push([])
      continue
    }
    if (!quoted && (term === 'AND' || term === 'ET')) continue
    const t = normalizeText(term)
    if (t) groups[groups.length - 1].push(t)
  }
  return groups.filter(g => g.length > 0)
}

/** `text` répond à la recherche `groups` (aucune recherche : oui). */
export function matchesQuery(text: string, groups: string[][]): boolean {
  if (groups.length === 0) return true
  const h = normalizeText(text)
  return groups.some(g => g.every(term => h.includes(term)))
}

/** Tout le texte d'un profil que la barre de recherche peut viser, lieu étendu (« Tunisie » trouve « Sousse »). */
function profileText(c: SearchableCandidate): string {
  return [
    c.name, c.city, expandLocationSearch(c.city).join(' '), c.skills.join(' '), c.desiredSector.join(' '), c.desiredRoles.join(' '),
    c.experienceSummary, experiencesText(c), c.education.map(e => `${e.degree} ${e.school}`).join(' '), c.languages.map(l => l.name).join(' '),
  ].join(' ')
}

const experiencesText = (c: SearchableCandidate) => c.experiences.map(e => `${e.title} ${e.company} ${e.missions.join(' ')}`).join(' ')

const within = (value: number | null, [lo, hi]: [number, number], max: number) =>
  value === null || (value >= lo && (hi >= max || value <= hi))

const DAY_MS = 24 * 60 * 60 * 1000

/** Profils qui répondent à tous les filtres. `now` : heure de la page (« ajoutés depuis »). */
export function filterCandidates<T extends SearchableCandidate>(list: T[], f: CvthequeFilters, now: Date): T[] {
  const query = parseQuery(f.query)
  const excluded = parseQuery(f.exclude).flat()
  const titleQuery = parseQuery(f.titleQuery)
  const experienceQuery = parseQuery(f.experienceQuery)
  const locations = f.location.trim() ? expandLocationSearch(f.location) : null
  const skills = f.skills.map(normalizeText)
  const sectors = new Set(f.sectors.map(normalizeText))
  const languages = f.languages.map(normalizeText)
  const company = normalizeText(f.company)
  const school = normalizeText(f.school)
  const since = f.addedWithinDays > 0 ? now.getTime() - f.addedWithinDays * DAY_MS : null

  return list.filter(c => {
    if (f.availableOnly && !c.openToWork) return false
    if (since !== null && !(new Date(c.createdAt).getTime() >= since)) return false
    // Sans valeur connue (CV sans années d'expérience, rayon non renseigné), le profil reste : on ne l'écarte pas sur un vide.
    if (!within(c.yearsOfExperience, f.experience, EXPERIENCE_MAX)) return false
    if (!within(c.mobilityRadiusKm, f.radius, RADIUS_MAX)) return false
    if (locations) {
      const loc = normalizeLocation(c.city)
      if (!loc || !locations.some(l => loc.includes(l) || l.includes(loc))) return false
    }
    if (skills.length > 0) {
      const own = c.skills.map(normalizeText)
      if (!skills.every(s => own.some(o => o.includes(s)))) return false
    }
    if (sectors.size > 0 && !c.desiredSector.some(s => sectors.has(normalizeText(s)))) return false
    if (languages.length > 0) {
      const own = c.languages.map(l => normalizeText(l.name))
      if (!languages.every(l => own.some(o => o.includes(l)))) return false
    }
    if (company && !c.experiences.some(e => normalizeText(e.company).includes(company))) return false
    if (school && !c.education.some(e => normalizeText(`${e.degree} ${e.school}`).includes(school))) return false
    if (titleQuery.length > 0 && !matchesQuery([...c.desiredRoles, ...c.experiences.map(e => e.title)].join(' | '), titleQuery)) return false
    if (experienceQuery.length > 0 && !matchesQuery(experiencesText(c), experienceQuery)) return false
    const text = profileText(c)
    if (excluded.length > 0 && matchesQuery(text, excluded.map(t => [t]))) return false
    return matchesQuery(text, query)
  })
}

/** Nombre de filtres réglés (hors barre de recherche), pour « Filtres · 3 » et « Réinitialiser ». */
export function activeFilterCount(f: CvthequeFilters): number {
  return [
    f.exclude.trim() !== '', f.availableOnly, f.addedWithinDays > 0,
    f.experience[0] > 0 || f.experience[1] < EXPERIENCE_MAX, f.radius[0] > 0 || f.radius[1] < RADIUS_MAX,
    f.location.trim() !== '', f.skills.length > 0, f.sectors.length > 0, f.languages.length > 0,
    f.company.trim() !== '', f.school.trim() !== '', f.titleQuery.trim() !== '', f.experienceQuery.trim() !== '',
  ].filter(Boolean).length
}

/** Valeurs présentes dans les profils, les plus fréquentes d'abord (casse et accents près), pour les propositions des champs. */
export function valuesByFrequency(lists: string[][], limit = 300): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const list of lists) {
    // Une valeur compte une fois par profil, même écrite deux fois (« React », « react »).
    const own = new Map<string, string>()
    for (const v of list.map(x => x.trim()).filter(Boolean)) if (!own.has(normalizeText(v))) own.set(normalizeText(v), v)
    for (const [key, raw] of own) {
      const entry = counts.get(key)
      if (entry) entry.n++
      else counts.set(key, { label: raw, n: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'fr')).slice(0, limit).map(e => e.label)
}
