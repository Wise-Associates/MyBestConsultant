import { expandLocationSearch, normalizeLocation } from '@/lib/regions'
import { SKILL_IMPLIES, SKILL_VARIANTS } from '@/lib/skill-equivalences'
import { JOB_FAMILIES, isJobFamily, type JobFamily } from '@/lib/job-families'

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
  /** Famille de métier lue dans la classification du CV (ADR 0044) ; null : CV pas encore classé. */
  jobFamily: JobFamily | null
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
  /** Familles de métiers de la classification des CV (ADR 0057) ; l'une d'elles suffit. Un CV pas encore classé est écarté. */
  jobFamilies: JobFamily[]
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
  location: '', skills: [], sectors: [], jobFamilies: [], languages: [], company: '', school: '', titleQuery: '', experienceQuery: '',
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
    // Terme sans lettre ni chiffre (« / », « & ») : ignoré, il répondrait à tous les profils (exclusion « stagiaire /
    // alternant » qui viderait la liste).
    if (words(t).length > 0) groups[groups.length - 1].push(t)
  }
  return groups.filter(g => g.length > 0)
}

/**
 * Mots d'un texte normalisé : lettres, chiffres, « + » et « # » (C++, C#) ; tout le reste sépare (« Node.js » = node, js).
 * Comparer des mots et non des morceaux de texte (demande du PO, 2026-11-18) : « Java » ne trouve plus « JavaScript ».
 */
export function words(s: string): string[] {
  return normalizeText(s).split(/[^\p{L}\p{N}+#]+/u).filter(Boolean)
}

/** Les mots de `term` se suivent dans `haystack` (« react native » dans « développeur react native mobile »). */
export function hasPhrase(haystack: string[], term: string): boolean {
  const needle = words(term)
  if (needle.length === 0) return true
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true
  }
  return false
}

// ── Compétences et leurs équivalences (ADR 0057) ─────────────────────────────────────────────────────────────────────

/** Mots d'une compétence collés : « Node.js », « NodeJS » et « node js » donnent la même clé, « nodejs ». */
export function skillKey(s: string): string {
  return words(s).join('')
}

interface EquivalenceIndex {
  /** Clé d'une écriture → clé de la forme usuelle de son groupe. */
  groupOf: Map<string, string>
  /** Clé de la forme usuelle → clés de toutes les écritures du groupe. */
  members: Map<string, string[]>
  /** Clé de la forme usuelle → formes usuelles des compétences qui l'impliquent directement. */
  impliedBy: Map<string, string[]>
  /** Clé de la forme usuelle → écritures des tables (« Node.js », « Node »), pour les chercher dans un texte. */
  names: Map<string, string[]>
}

let equivalenceIndex: EquivalenceIndex | null = null

/** Index des tables de skill-equivalences.ts, construit au premier usage. */
function equivalences(): EquivalenceIndex {
  if (equivalenceIndex) return equivalenceIndex
  const groupOf = new Map<string, string>()
  const members = new Map<string, string[]>()
  const names = new Map<string, string[]>()
  const addName = (key: string, name: string) => { if (!names.get(key)?.includes(name)) names.set(key, [...(names.get(key) ?? []), name]) }
  for (const group of SKILL_VARIANTS) {
    const keys = [...new Set(group.map(skillKey).filter(Boolean))]
    if (keys.length === 0) continue
    for (const k of keys) groupOf.set(k, keys[0])
    members.set(keys[0], keys)
    for (const name of group) addName(keys[0], name)
  }
  const usual = (s: string) => groupOf.get(skillKey(s)) ?? skillKey(s)
  const impliedBy = new Map<string, string[]>()
  for (const [from, targets] of SKILL_IMPLIES) {
    addName(usual(from), from)
    for (const target of targets) {
      addName(usual(target), target)
      impliedBy.set(usual(target), [...(impliedBy.get(usual(target)) ?? []), usual(from)])
    }
  }
  equivalenceIndex = { groupOf, members, impliedBy, names }
  return equivalenceIndex
}

/** Formes usuelles de `askedKey` et de toutes les compétences qui l'impliquent, de proche en proche. */
function reachedFrom(askedKey: string): string[] {
  const { groupOf, impliedBy } = equivalences()
  const reached = [groupOf.get(askedKey) ?? askedKey]
  for (let i = 0; i < reached.length; i++) {
    for (const from of impliedBy.get(reached[i]) ?? []) if (!reached.includes(from)) reached.push(from)
  }
  return reached
}

/**
 * Clés des compétences d'un profil qui valent `asked` : ses propres écritures, puis celles de toutes les compétences
 * qui l'impliquent, de proche en proche (« JavaScript » : JS, TypeScript, Node.js, NestJS, React, Next.js…).
 */
export function equivalentSkillKeys(asked: string): Set<string> {
  const own = skillKey(asked)
  if (!own) return new Set()
  const { members } = equivalences()
  const keys = new Set([own])
  for (const k of reachedFrom(own)) for (const m of members.get(k) ?? [k]) keys.add(m)
  return keys
}

/** Mêmes équivalences que `equivalentSkillKeys`, écrites comme dans les tables, pour les chercher dans un texte. */
export function equivalentSkillNames(asked: string): string[] {
  const own = skillKey(asked)
  if (!own) return []
  const { names } = equivalences()
  return [...new Set([asked, ...reachedFrom(own).flatMap(k => names.get(k) ?? [])])]
}

/** Compétence du profil qui répond à une compétence demandée ; `viaEquivalence` : écrite autrement ou voisine. */
export interface SkillMatch {
  own: string
  viaEquivalence: boolean
}

/**
 * Règle d'une compétence demandée, à appliquer à la liste des compétences d'un profil : mot à mot d'abord (la règle
 * d'avant : « React » trouve « React Native »), sinon une compétence entière du profil qui lui est équivalente
 * (« NodeJS » ou « NestJS » pour « Node.js »). Préparée une fois par recherche, appliquée à chaque profil.
 */
export function skillMatcher(asked: string): (own: string[]) => SkillMatch | null {
  const askedKey = skillKey(asked)
  const keys = equivalentSkillKeys(asked)
  return own => {
    const direct = own.find(o => hasPhrase(words(o), asked))
    if (direct !== undefined) return { own: direct, viaEquivalence: false }
    const equivalent = own.find(o => keys.has(skillKey(o)))
    return equivalent === undefined ? null : { own: equivalent, viaEquivalence: skillKey(equivalent) !== askedKey }
  }
}

/** Compétences demandées trouvées par une équivalence, pour dire au recruteur pourquoi le profil est retenu. */
export function skillCorrespondences(own: string[], asked: string[]): { asked: string; own: string }[] {
  return asked.filter(a => words(a).length > 0).flatMap(a => {
    const match = skillMatcher(a)(own)
    return match?.viaEquivalence ? [{ asked: a, own: match.own }] : []
  })
}

/** Un des `texts` contient un des `terms`, en mots entiers. */
const mentions = (texts: string[], terms: string[]) => texts.some(t => {
  const h = words(t)
  return terms.some(term => hasPhrase(h, term))
})

/**
 * Tri des profils retenus par les compétences demandées (demande du 2026-11-23, ADR 0057) : le filtre retient tout CV qui
 * cite la compétence, y compris un chef de projet qui l'a seulement listée. Les profils qui l'exercent passent d'abord :
 * pour chaque compétence, 2 points si un intitulé (poste visé ou exercé) la nomme, 1 si le résumé ou une mission la
 * nomme, 0 si seule la liste de compétences la cite. Ses équivalences comptent aussi (« JS » ou « Angular » dans
 * l'intitulé pour une recherche « JavaScript »). Personne n'est écarté ; à égalité, l'ordre d'arrivée est gardé.
 */
export function rankBySkillUse<T extends SearchableCandidate>(list: T[], skills: string[]): T[] {
  const asked = skills.filter(s => words(s).length > 0).map(equivalentSkillNames)
  if (asked.length === 0) return list
  const score = (c: T) => {
    const titles = [...c.desiredRoles, ...c.experiences.map(e => e.title)]
    const details = [c.experienceSummary, ...c.experiences.flatMap(e => e.missions)]
    return asked.reduce((sum, terms) => sum + (mentions(titles, terms) ? 2 : mentions(details, terms) ? 1 : 0), 0)
  }
  return list.map((c, i) => ({ c, i, s: score(c) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.c)
}

/** `text` répond à la recherche `groups` (aucune recherche : oui), terme par terme en mots entiers. */
export function matchesQuery(text: string, groups: string[][]): boolean {
  if (groups.length === 0) return true
  const h = words(text)
  return groups.some(g => g.every(term => hasPhrase(h, term)))
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
  const skills = f.skills.filter(s => words(s).length > 0).map(skillMatcher)
  const sectors = new Set(f.sectors.map(normalizeText))
  const families = new Set<JobFamily>(f.jobFamilies)
  const languages = f.languages.filter(l => words(l).length > 0)
  const company = words(f.company).length > 0 ? f.company : ''
  const school = words(f.school).length > 0 ? f.school : ''
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
    if (skills.length > 0 && !skills.every(match => match(c.skills) !== null)) return false
    if (sectors.size > 0 && !c.desiredSector.some(s => sectors.has(normalizeText(s)))) return false
    if (families.size > 0 && (c.jobFamily === null || !families.has(c.jobFamily))) return false
    if (languages.length > 0) {
      const own = c.languages.map(l => words(l.name))
      if (!languages.every(l => own.some(o => hasPhrase(o, l)))) return false
    }
    if (company && !c.experiences.some(e => hasPhrase(words(e.company), company))) return false
    if (school && !c.education.some(e => hasPhrase(words(`${e.degree} ${e.school}`), school))) return false
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
    f.location.trim() !== '', f.skills.length > 0, f.sectors.length > 0, f.jobFamilies.length > 0, f.languages.length > 0,
    f.company.trim() !== '', f.school.trim() !== '', f.titleQuery.trim() !== '', f.experienceQuery.trim() !== '',
  ].filter(Boolean).length
}

/** Familles de métiers des profils chargés, dans l'ordre de la liste, avec leur nombre (filtre « Métier »). */
export function jobFamilyCounts(list: { jobFamily: JobFamily | null }[]): { family: JobFamily; label: string; count: number }[] {
  const counts = new Map<JobFamily, number>()
  for (const c of list) if (c.jobFamily) counts.set(c.jobFamily, (counts.get(c.jobFamily) ?? 0) + 1)
  return (Object.keys(JOB_FAMILIES) as JobFamily[]).map(family => ({ family, label: JOB_FAMILIES[family], count: counts.get(family) ?? 0 }))
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

// ── Filtres dans l'adresse et dans une recherche enregistrée (ADR 0045) ──────────────────────────────────────────────
// Une recherche enregistrée garde exactement les filtres de la liste : rouverte, elle redonne la même liste, et les
// alertes appliquent la même règle (filterCandidates) aux nouveaux candidats. Les deux sources (adresse, document
// enregistré) sont lues comme non fiables : longueurs et nombres de valeurs bornés, valeurs inconnues ignorées.

const MAX_QUERY = 300
const MAX_FIELD = 200
const MAX_VALUE = 80
const MAX_VALUES = 20

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const values = (v: unknown) => {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const value = raw.trim().slice(0, MAX_VALUE)
    if (value && !seen.has(normalizeText(value))) {
      seen.add(normalizeText(value))
      out.push(value)
    }
    if (out.length === MAX_VALUES) break
  }
  return out
}
/** Familles connues seulement, sans doublon, dans l'ordre de la liste (une recherche enregistrée garde la même adresse). */
const families = (v: unknown): JobFamily[] => {
  const asked = new Set(Array.isArray(v) ? v.filter(isJobFamily) : [])
  return (Object.keys(JOB_FAMILIES) as JobFamily[]).filter(k => asked.has(k))
}
function range(v: unknown, max: number): [number, number] {
  const [lo, hi] = Array.isArray(v) ? v : []
  const int = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(0, Math.round(x))) : fallback)
  const a = int(lo, 0)
  const b = int(hi, max)
  return a <= b ? [a, b] : [b, a]
}

/** Filtres tirés d'une valeur non fiable (JSON d'une recherche enregistrée, saisie d'une action). */
export function sanitizeFilters(raw: unknown): CvthequeFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const added = r.addedWithinDays === 7 || r.addedWithinDays === 30 ? r.addedWithinDays : 0
  return {
    query: clip(r.query, MAX_QUERY), exclude: clip(r.exclude, MAX_QUERY), availableOnly: r.availableOnly === true, addedWithinDays: added,
    experience: range(r.experience, EXPERIENCE_MAX), radius: range(r.radius, RADIUS_MAX), location: clip(r.location, MAX_FIELD),
    skills: values(r.skills), sectors: values(r.sectors), jobFamilies: families(r.jobFamilies), languages: values(r.languages),
    company: clip(r.company, MAX_FIELD),
    school: clip(r.school, MAX_FIELD), titleQuery: clip(r.titleQuery, MAX_FIELD), experienceQuery: clip(r.experienceQuery, MAX_FIELD),
  }
}

/** Paramètres de l'adresse qui portent les filtres (les autres, comme `recherche`, sont gardés tels quels). */
const PARAMS = ['q', 'exclure', 'dispo', 'ajout', 'exp', 'rayon', 'lieu', 'competence', 'secteur', 'metier', 'langue', 'entreprise', 'ecole', 'intitule', 'experiences'] as const

function rangeParam(v: string | null): [number, number] | undefined {
  const m = v?.match(/^(\d{1,3})-(\d{1,3})$/)
  return m ? [Number(m[1]), Number(m[2])] : undefined
}

/** Filtres lus dans l'adresse de la CV Thèque. */
export function filtersFromSearchParams(sp: URLSearchParams): CvthequeFilters {
  const ajout = Number(sp.get('ajout'))
  return sanitizeFilters({
    query: sp.get('q') ?? '', exclude: sp.get('exclure') ?? '', availableOnly: sp.get('dispo') === '1', addedWithinDays: ajout,
    experience: rangeParam(sp.get('exp')), radius: rangeParam(sp.get('rayon')), location: sp.get('lieu') ?? '',
    skills: sp.getAll('competence'), sectors: sp.getAll('secteur'), jobFamilies: sp.getAll('metier'), languages: sp.getAll('langue'), company: sp.get('entreprise') ?? '',
    school: sp.get('ecole') ?? '', titleQuery: sp.get('intitule') ?? '', experienceQuery: sp.get('experiences') ?? '',
  })
}

/** Copie de `sp` avec les filtres `f` (valeurs par défaut omises : une liste sans filtre a une adresse nue). */
export function withFilters(sp: URLSearchParams, f: CvthequeFilters): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const key of PARAMS) next.delete(key)
  const set = (key: string, value: string) => { if (value.trim()) next.set(key, value) }
  set('q', f.query)
  set('exclure', f.exclude)
  if (f.availableOnly) next.set('dispo', '1')
  if (f.addedWithinDays > 0) next.set('ajout', String(f.addedWithinDays))
  if (f.experience[0] > 0 || f.experience[1] < EXPERIENCE_MAX) next.set('exp', f.experience.join('-'))
  if (f.radius[0] > 0 || f.radius[1] < RADIUS_MAX) next.set('rayon', f.radius.join('-'))
  set('lieu', f.location)
  for (const v of f.skills) next.append('competence', v)
  for (const v of f.sectors) next.append('secteur', v)
  for (const v of f.jobFamilies) next.append('metier', v)
  for (const v of f.languages) next.append('langue', v)
  set('entreprise', f.company)
  set('ecole', f.school)
  set('intitule', f.titleQuery)
  set('experiences', f.experienceQuery)
  return next
}

/**
 * Une recherche à enregistrer doit demander quelque chose : sans critère qui retient des profils (seulement « disponibles
 * », « ajoutés depuis » ou une exclusion), chaque nouveau candidat déclencherait une alerte.
 */
export function hasSearchCriteria(f: CvthequeFilters): boolean {
  return [
    f.query, f.location, f.company, f.school, f.titleQuery, f.experienceQuery,
  ].some(v => words(v).length > 0) || f.skills.length > 0 || f.sectors.length > 0 || f.jobFamilies.length > 0 || f.languages.length > 0
    || f.experience[0] > 0 || f.experience[1] < EXPERIENCE_MAX || f.radius[0] > 0 || f.radius[1] < RADIUS_MAX
}

const rangeText = ([lo, hi]: [number, number], max: number, unit: string) =>
  hi >= max ? `${lo} ${unit} et plus` : lo === 0 ? `jusqu’à ${hi} ${unit}` : `${lo} à ${hi} ${unit}`

/** Critères d'une recherche en lignes lisibles (page des alertes, e-mail). */
export function filtersSummary(f: CvthequeFilters): string[] {
  const out: string[] = []
  const add = (label: string, value: string) => { if (value.trim()) out.push(`${label} : ${value.trim()}`) }
  add('Recherche', f.query)
  add('Métier', f.jobFamilies.map(k => JOB_FAMILIES[k]).join(' ou '))
  add('Intitulé', f.titleQuery)
  add('Compétences', f.skills.join(', '))
  if (f.experience[0] > 0 || f.experience[1] < EXPERIENCE_MAX) out.push(`Expérience : ${rangeText(f.experience, EXPERIENCE_MAX, 'ans')}`)
  add('Lieu', f.location)
  if (f.radius[0] > 0 || f.radius[1] < RADIUS_MAX) out.push(`Mobilité : ${rangeText(f.radius, RADIUS_MAX, 'km')}`)
  add('Langues', f.languages.join(', '))
  add('Secteurs', f.sectors.join(' ou '))
  add('Entreprise', f.company)
  add('Formation', f.school)
  add('Expériences', f.experienceQuery)
  if (f.availableOnly) out.push('Disponibles seulement')
  if (f.addedWithinDays > 0) out.push(`Ajoutés depuis ${f.addedWithinDays} jours`)
  add('Sans', f.exclude)
  return out
}
