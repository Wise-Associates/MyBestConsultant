import { SECTORS } from '@/lib/cv-classification'
import { STANDARD_KEYS, defaultCriteriaSet, type OfferCriteriaSet, type OfferCriterion } from '@/lib/offer-criteria'
import { expandLocationSearch, normalizeLocation } from '@/lib/regions'
import { cleanTitle, covers, type OfferForSearch, type SearchHit } from './cv-search'

// Filtre des CV de la base après le préfiltre de l'index (ADR 0061 phase 2, demande du 2026-11-24 : « appliquer
// l'approche de MBC Search pour n'avoir qu'un minimum de candidats à noter »). Comme MBC Search (ADR 0037) : plusieurs
// recherches — le titre de l'offre, ses métiers et leurs autres intitulés, ses technologies —, puis des critères requis
// (★ des critères de l'offre) vérifiés par le code sur les champs classés de chaque CV, assouplis pas à pas s'il n'y a
// pas assez de CV : la ville d'abord, puis la séniorité, puis le secteur et la langue, puis le métier ; les technologies ★
// ne sont jamais assouplies (absentes, elles plafonnent le score sous 65 : noter le CV serait payer pour rien). Chaque
// vérification répond « oui », « non » ou « inconnu » : une valeur absente du CV, ou un libellé que le code ne sait pas
// lire (« France », « Hybride »), n'écarte jamais et compte pour moitié dans le pré-score — un CV écarté à tort n'est
// jamais noté, d'où des comparaisons tolérantes (orthographes des technologies, régions, fourchettes d'années ; revue de
// code du 2026-11-24). Enfin un pré-score aux poids de l'offre (libellés compris) classe les CV d'un même niveau. Sans
// critères, ceux par défaut de l'offre (defaultCriteriaSet). Pur, testé (offer-filter.test.ts) ; appel : prefilter.ts.

/** Libellé pondéré d'un critère, tel que le filtre le lit. */
interface Weighted { label: string; weight: number; required: boolean }

export interface SearchProfile {
  /** Recherches par intitulé : titre de l'offre, métiers du poste, autres intitulés (sans doublon). */
  titles: string[]
  /** Métiers du poste (libellés) et autres intitulés, qui valent pour le premier métier. */
  roles: Weighted[]
  alternativeTitles: string[]
  skills: Weighted[]
  location: Weighted[]
  seniority: Weighted[]
  sector: Weighted[]
  language: Weighted[]
  /** Poids de chaque critère mesurable sur l'index (les autres — contexte, projet, formation, TJM, critères ajoutés — non). */
  weights: { role: number; skills: number; location: number; seniority: number; sector: number; language: number }
}

/** Recherches par intitulé et par technologie envoyées à l'index au plus (une seule requête groupée). */
const MAX_TITLE_QUERIES = 6
const MAX_SKILL_QUERIES = 12

const labelsOf = (c: OfferCriterion | undefined): Weighted[] => c?.labels.map(l => ({ label: l.label, weight: l.weight, required: l.required })) ?? []
const dedupe = (texts: string[]) => {
  const seen = new Set<string>()
  return texts.map(t => t.trim()).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

/** Ce que le filtre retient d'une offre : ses critères (ADR 0061) ou, sans eux, ses critères par défaut. */
export function searchProfileOf(offer: OfferForSearch, criteria?: OfferCriteriaSet | null): SearchProfile {
  const set = criteria ?? defaultCriteriaSet({ title: offer.title, skills: offer.skills, location: offer.location })
  const by = (id: string) => set.criteria.find(c => c.id === id)
  const roles = labelsOf(by('poste'))
  const weightOf = (id: (typeof STANDARD_KEYS)[number]) => by(id)?.weight ?? 0
  return {
    titles: dedupe([cleanTitle(offer.title), ...roles.map(r => r.label), ...set.alternativeTitles]).slice(0, MAX_TITLE_QUERIES),
    roles,
    alternativeTitles: set.alternativeTitles,
    skills: labelsOf(by('competences')),
    location: labelsOf(by('localisation')),
    seniority: labelsOf(by('niveau')),
    sector: labelsOf(by('domaine')),
    language: labelsOf(by('langue')),
    weights: {
      role: weightOf('poste'), skills: weightOf('competences'), location: weightOf('localisation'), seniority: weightOf('niveau'),
      sector: weightOf('domaine'), language: weightOf('langue'),
    },
  }
}

const ATTRIBUTES = ['id', 'sourceId', 'roles', 'skills', 'city', 'jobFamily', 'seniority', 'sectors', 'languages', 'yearsOfExperience']

/** Recherches d'une offre : chaque intitulé, puis chaque technologie (★ d'abord), réunies ensuite. */
export function profileQueries(profile: SearchProfile, filter: string, indexUid: string) {
  const skills = [...profile.skills].sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight).map(s => s.label)
  const terms = [
    ...profile.titles.map((q, i) => ({ q, limit: i === 0 ? 100 : 60 })),
    ...dedupe(skills).filter(s => !profile.titles.some(t => t.toLowerCase() === s.toLowerCase())).slice(0, MAX_SKILL_QUERIES).map(q => ({ q, limit: 50 })),
  ]
  return terms.map(t => ({ indexUid, q: t.q, filter, limit: t.limit, attributesToRetrieve: ATTRIBUTES, matchingStrategy: 'last' as const }))
}

// ── Vérifications, libellé par libellé ───────────────────────────────────────────────────────────────────────────

/** oui, non, ou inconnu : le CV n'en dit rien, ou le libellé n'est pas lisible par le code. */
export type Check = 'pass' | 'fail' | 'unknown'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Mots d'un intitulé : sans mots vides ni genre ; « C » et « R » gardés (langages) ; pluriel ramené au singulier.
const TITLE_STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'a', 'pour', 'sur', 'un', 'une', 'h', 'f', 'hf', 'fh', 'cdi', 'cdd', 'freelance', 'mission', 'senior', 'junior', 'confirme', 'expert'])
const titleWords = (s: string) => fold(s).split(/[^a-z0-9+#]+/)
  .filter(w => (w.length > 1 || w === 'c' || w === 'r') && !TITLE_STOP.has(w))
  .map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))

/**
 * Part (0 à 1) des mots d'un intitulé retrouvés dans le meilleur des métiers exercés du CV. Un intitulé de deux mots ou
 * moins doit s'y trouver entier (« Développeur Java » ≠ « Développeur Python ») ; au-delà, les deux tiers suffisent.
 */
export function titleFit(roles: string[], title: string): { ratio: number; matches: boolean } {
  const wanted = titleWords(cleanTitle(title))
  if (wanted.length === 0) return { ratio: 0, matches: false }
  const ratio = Math.max(0, ...roles.map(r => {
    const have = new Set(titleWords(r))
    return wanted.filter(w => have.has(w)).length / wanted.length
  }))
  return { ratio, matches: ratio >= (wanted.length <= 2 ? 1 : 2 / 3) }
}

// Mêmes équivalences que l'index (synonyms de CV_INDEX_SETTINGS) et formes courantes des outils.
const SKILL_ALIASES: Record<string, string> = {
  js: 'javascript', ts: 'typescript', k8s: 'kubernetes', golang: 'go', postgres: 'postgresql', csharp: 'c#', 'dotnet': '.net',
}

/** Forme compacte d'une technologie : « Spring Boot » = « SpringBoot », « Node.js » = « NodeJS » = « Node », « JS » = « JavaScript ». */
export function skillKey(skill: string): string {
  const key = fold(skill).replace(/[\s._-]+/g, '')
  if (SKILL_ALIASES[key]) return SKILL_ALIASES[key]
  return key.length > 4 && key.endsWith('js') ? key.slice(0, -2) : key
}

/** Le CV a-t-il la technologie ? Libellé composé (« Java/Angular ») : chacune de ses parties. */
export function skillCheck(cvSkills: string[], label: string): Check {
  const parts = label.split(/[/&]/).map(p => p.trim()).filter(p => skillKey(p))
  if (parts.length === 0 || cvSkills.length === 0) return 'unknown'
  const have = new Set(cvSkills.map(skillKey))
  return parts.every(part => have.has(skillKey(part)) || covers(cvSkills, part)) ? 'pass' : 'fail'
}

// Mots d'un libellé de lieu qui ne nomment pas un lieu : « Paris (hybride) », « Télétravail complet ».
const NON_PLACE = new Set([
  'hybride', 'teletravail', 'remote', 'full', 'site', 'sur', 'partiel', 'partielle', 'complet', 'distance', 'national',
  'nationale', 'europe', 'international', 'deplacements', 'deplacement', 'mobilite', 'possible', 'jours', 'jour', 'semaine',
  'par', 'region', 'proche', 'environs', 'secteur',
])
// Mots qui font partie de noms de lieux (« Île-de-France », « Hauts-de-France ») mais n'en nomment aucun seuls (« France »).
const PLACE_GLUE = new Set(['france', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'ou', 'a', 'l', 'd'])

/**
 * Le CV est-il au lieu demandé ? Même ville, ou une ville de la même région (regions.ts, comme le jugement de l'IA :
 * « même ville ou région ») ; ville du CV en plusieurs mots comparée entière (« Saint-Denis » ≠ « Saint-Étienne »).
 * Ville inconnue, ou libellé sans lieu (« Télétravail », « France ») : inconnu.
 */
export function locationCheck(city: string | undefined, label: string): Check {
  if (!city) return 'unknown'
  const placeWords = normalizeLocation(label).split(/[^a-z0-9]+/).filter(w => w && !NON_PLACE.has(w) && !/^\d+$/.test(w))
  const place = placeWords.join(' ')
  const cityName = normalizeLocation(city).split(/[^a-z0-9]+/).filter(Boolean).join(' ')
  if (placeWords.every(w => PLACE_GLUE.has(w)) || !cityName) return 'unknown'
  if (new Set(expandLocationSearch(place)).has(cityName) || ` ${place} `.includes(` ${cityName} `)) return 'pass'
  return 'fail'
}

/** Années minimales d'une séniorité demandée (« 5 ans et plus », « 3-5 ans », « Senior ») ; null si le libellé n'en dit rien. */
export function minimumYears(label: string): number | null {
  // Fourchette (« 3-5 ans », « entre 10 et 15 ans », « Junior (0-2 ans) ») : sa borne basse.
  const range = label.match(/(\d{1,2})\s*(?:-|–|à|a|to|et)\s*\d{1,2}\s*(?:ans?|years?)\b/i)
  if (range) return Number(range[1])
  const years = label.match(/(\d{1,2})\s*(?:\+\s*)?(?:ans?|years?)\b/i)
  if (years) return Number(years[1])
  // Mêmes seuils que seniorityOf (cv-classification.ts).
  const folded = fold(label)
  if (/\bexpert/.test(folded)) return 15
  if (/\bsenior/.test(folded)) return 8
  if (/\bconfirme/.test(folded)) return 3
  return null
}

/** Le CV a-t-il les années demandées (une de moins tolérée : l'IA jugera « partiel ») ? */
function seniorityCheck(years: number | null | undefined, label: string): Check {
  const min = minimumYears(label)
  if (min === null || years === null || years === undefined) return 'unknown'
  return years >= min - 1 ? 'pass' : 'fail'
}

/** Noms d'un secteur de l'index (« secteur_public » : « secteur public », « Secteur public » ; télécoms : « télécommunications »). */
const sectorNames = (keys: string[]) => keys.flatMap(k => [
  k.replace(/_/g, ' '), SECTORS[k as keyof typeof SECTORS] ?? '', ...(k === 'telecom' ? ['telecommunications'] : []),
])

function sectorCheck(sectors: string[], label: string): Check {
  return sectors.length === 0 ? 'unknown' : covers(sectorNames(sectors), label) ? 'pass' : 'fail'
}

// Langues écrites en anglais dans un libellé ou un CV, ramenées au nom français des classifications.
const LANGUAGE_ALIASES: Record<string, string> = {
  english: 'anglais', german: 'allemand', spanish: 'espagnol', french: 'francais', italian: 'italien', portuguese: 'portugais',
  arabic: 'arabe', chinese: 'chinois', dutch: 'neerlandais', japanese: 'japonais', russian: 'russe',
}
const languageWords = (s: string) => fold(s).split(/[^a-z]+/).filter(Boolean).map(w => LANGUAGE_ALIASES[w] ?? w)

function languageCheck(languages: string[], label: string): Check {
  if (languages.length === 0) return 'unknown'
  const have = new Set(languages.flatMap(languageWords))
  return languageWords(label).some(w => have.has(w)) ? 'pass' : 'fail'
}

const POINTS: Record<Check, number> = { pass: 1, unknown: 0.5, fail: 0 }

/** Libellés ★ d'un groupe : tous satisfaits (`every`) ou l'un d'eux (`some` : villes, secteurs, des alternatives). */
function requiredPass(labels: Weighted[], check: (label: Weighted, i: number) => Check, mode: 'every' | 'some'): boolean {
  const required = labels.map((l, i) => ({ l, i })).filter(({ l }) => l.required)
  if (required.length === 0) return true
  const ok = ({ l, i }: { l: Weighted; i: number }) => check(l, i) !== 'fail'
  return mode === 'every' ? required.every(ok) : required.some(ok)
}

/** Part pondérée (0 à 1) des libellés d'un groupe, oui 1, inconnu 0,5, non 0 ; sans libellé, 0,5. */
const share = (labels: Weighted[], value: (label: Weighted, i: number) => number) =>
  (labels.length === 0 ? 0.5 : labels.reduce((s, l, i) => s + l.weight * value(l, i), 0) / 100)

/** Vérifications d'un CV : `passes` (★ satisfaits ou inconnus) et `share` (pré-score). */
function fitOf(profile: SearchProfile, hit: SearchHit) {
  const roles = hit.roles ?? []
  // Le premier métier vaut aussi par ses autres intitulés.
  const roleCheck = (l: Weighted, i: number): Check => {
    if (roles.length === 0) return 'unknown'
    return titleFit(roles, l.label).matches || (i === 0 && profile.alternativeTitles.some(t => titleFit(roles, t).matches)) ? 'pass' : 'fail'
  }
  const roleRatio = (l: Weighted, i: number) => (roles.length === 0 ? 0.5
    : Math.max(titleFit(roles, l.label).ratio, ...(i === 0 ? profile.alternativeTitles.map(t => titleFit(roles, t).ratio) : [])))
  const skills = (l: Weighted) => skillCheck(hit.skills ?? [], l.label)
  const location = (l: Weighted) => locationCheck(hit.city, l.label)
  const seniority = (l: Weighted) => seniorityCheck(hit.yearsOfExperience, l.label)
  const sector = (l: Weighted) => sectorCheck(hit.sectors ?? [], l.label)
  const language = (l: Weighted) => languageCheck(hit.languages ?? [], l.label)
  return {
    passes: {
      role: requiredPass(profile.roles, roleCheck, 'every'),
      skills: requiredPass(profile.skills, skills, 'every'),
      location: requiredPass(profile.location, location, 'some'),
      seniority: requiredPass(profile.seniority, seniority, 'every'),
      sector: requiredPass(profile.sector, sector, 'some'),
      language: requiredPass(profile.language, language, 'every'),
    },
    share: {
      role: share(profile.roles, roleRatio),
      skills: share(profile.skills, l => POINTS[skills(l)]),
      location: share(profile.location, l => POINTS[location(l)]),
      seniority: share(profile.seniority, l => POINTS[seniority(l)]),
      sector: share(profile.sector, l => POINTS[sector(l)]),
      language: share(profile.language, l => POINTS[language(l)]),
    },
  }
}

/** Critères requis abandonnés à chaque niveau d'assouplissement, dans l'ordre ; les technologies ★ jamais. */
export const RELAXATION = [
  [],
  ['location'],
  ['location', 'seniority'],
  ['location', 'seniority', 'sector', 'language'],
  ['location', 'seniority', 'sector', 'language', 'role'],
] as const

/** Premier niveau d'assouplissement auquel le CV passe (0 : tous les ★) ; null s'il lui manque une technologie ★. */
export function filterLevel(profile: SearchProfile, hit: SearchHit): number | null {
  const { passes } = fitOf(profile, hit)
  if (!passes.skills) return null
  const level = RELAXATION.findIndex(dropped => (Object.keys(passes) as (keyof typeof passes)[])
    .every(key => passes[key] || (dropped as readonly string[]).includes(key)))
  return level === -1 ? null : level
}

/** Pré-score (0 à 1) d'un CV aux poids de l'offre, sur les critères que l'index permet de mesurer ; jamais affiché. */
export function profileScore(profile: SearchProfile, hit: SearchHit): number {
  const { share: parts } = fitOf(profile, hit)
  const keys = Object.keys(profile.weights) as (keyof SearchProfile['weights'])[]
  const total = keys.reduce((s, k) => s + profile.weights[k], 0)
  if (total === 0) return 0.5
  return keys.reduce((s, k) => s + profile.weights[k] * parts[k], 0) / total
}

export interface FilterResult {
  /** Identifiants de source des CV retenus, dans l'ordre : niveau d'assouplissement, puis pré-score. */
  ids: string[]
  /** CV distincts trouvés par les recherches (avant le filtre), hors candidats exclus. */
  found: number
  /** CV trouvés écartés faute d'une technologie ★. */
  excluded: number
  /** L'index connaît des CV pour cette offre, candidats exclus compris (prefilter.ts) : sinon, les plus récents complètent. */
  indexed: boolean
}

/** Résultats des recherches réunis (un CV une fois), filtrés et classés : les `keep` premiers. */
export function selectHits(profile: SearchProfile, hitLists: SearchHit[][], keep: number): Omit<FilterResult, 'indexed'> {
  const byId = new Map<string, SearchHit>()
  for (const list of hitLists) for (const hit of list) if (!byId.has(hit.sourceId)) byId.set(hit.sourceId, hit)
  const ranked = [...byId.values()].flatMap(hit => {
    const level = filterLevel(profile, hit)
    return level === null ? [] : [{ id: hit.sourceId, level, score: profileScore(profile, hit) }]
  }).sort((a, b) => a.level - b.level || b.score - a.score)
  return { ids: ranked.slice(0, keep).map(h => h.id), found: byId.size, excluded: byId.size - ranked.length }
}
