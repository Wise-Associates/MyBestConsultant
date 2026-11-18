import {
  CLASSIFICATION_LIMITS, CLASSIFICATION_VERSION, EDUCATION_LEVELS, LANGUAGE_LEVELS, seniorityOf,
  type CvClassification, type JobFamily, type Sector,
} from './cv-classification'
import {
  AMBIGUOUS_CITIES, AMBIGUOUS_TERMS, CERTIFICATION_PATTERNS, COUNTRY_NAMES, GENERIC_ROLES, LANGUAGE_NAMES, ROLE_SEED,
  SECTOR_FALSE_FRIENDS, SECTOR_KEYWORDS, SENSITIVE_WORDS, SKILL_SEED, SOFT_SKILL_WORDS,
} from './cv-classification-rules-data'
import { FRANCE_REGIONS, INTERNATIONAL_LOCATIONS } from './regions'

// Classement d'un CV sans IA (ADR 0044) : quand ni Claude ni GPT-4o mini ne répondent (panne, crédits, aucune clé) ou
// que leur réponse est illisible, les champs de la classification sont tirés du texte du CV par des listes et des motifs,
// pour que le préfiltre du matching et les statistiques continuent de fonctionner. Le classement est enregistré avec le
// modèle RULES_MODEL et refait par l'IA dès qu'elle répond (isUpToDate, cv-classification.ts). Ni clients ni résumé : trop
// risqués à deviner sans IA. Règles pures, `now` injecté, testées dans cv-classification-rules.test.ts ; listes :
// cv-classification-rules-data.ts. Le texte reçu est celui de la notation : coordonnées masquées, 12 000 caractères.

export interface VocabularyTerm {
  /** Nom enregistré dans la classification (et compté par les statistiques). */
  name: string
  /** Écritures reconnues dans un CV ; « = » en tête : casse exacte. */
  variants: string[]
  /** Famille de métiers désignée ; null : outil transverse, ou terme venu de l'index ou des offres. */
  family: JobFamily | null
}

/** Compétences et métiers reconnus : listes de départ, plus ceux que l'IA a déjà relevés et ceux des offres (cv-classify.ts). */
export interface RuleVocabulary { skills: VocabularyTerm[]; roles: VocabularyTerm[] }

type Level = (typeof LANGUAGE_LEVELS)[number]
type Education = (typeof EDUCATION_LEVELS)[number]

// ---------- Texte ----------

/** Sans accents, casse gardée. Un texte en NFC garde sa longueur (positions comparables). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
/** Forme de comparaison : sans « = » de tête, sans accents, en minuscules, espaces réduits. */
const keyOf = (s: string) => fold(s.replace(/^=+/, '')).toLowerCase().replace(/\s+/g, ' ').trim()
/** Texte du CV : fins de ligne, espaces insécables, tabulations et apostrophes typographiques unifiés. */
const cleanText = (raw: string) =>
  raw.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[  \t]/g, ' ').replace(/[’‘`´]/g, "'")

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// Bornes d'un terme : ni lettre, chiffre, « + », « # » ou « . » collés devant (« ASP.NET » n'est pas « .NET » seul) ;
// derrière, ni lettre ni chiffre, ni un point suivi d'une lettre (« Node.js » pour « Node »). Un tiret est une borne :
// listes écrites « Java-Spring Boot-Docker » (« go-live » ne donne rien : « Go » seul n'est jamais cherché).
const BEFORE = String.raw`(?<![\p{L}\p{N}_+#.])`
const AFTER = String.raw`(?![\p{L}\p{N}_+#]|\.[\p{L}\p{N}])`
/**
 * Motif d'une écriture : ses mots séparés par des espaces ou des tirets (« Power BI », « Power-BI », « e-commerce »),
 * sans accents. Découpé aussi sur les tirets : un séparateur `[\s-]+` n'est jamais à côté d'un tiret du motif — sinon
 * un terme fait de tirets (« - - - a ») donnait des répétitions qui se recouvrent, et un CV plein de tirets figeait le
 * serveur des dizaines de secondes (revue de sécurité du 2026-11-18).
 */
const patternOf = (written: string) =>
  fold(written).trim().split(/[\s-]+/).filter(Boolean).map(escapeRe).join(String.raw`[\s-]+`)
/** Forme sous laquelle une écriture et le texte reconnu se retrouvent l'un l'autre. */
const matchKey = (s: string) => keyOf(s).replace(/[\s-]+/g, ' ')

/**
 * Toutes les écritures d'une liste en deux expressions compilées une fois (une par expression : environ 1 500 motifs
 * compilés un à un prenaient 2 s au premier CV) : sans casse, puis à la casse exacte (sigles courts, « =SAFe »). Les
 * plus longues d'abord : à une même position, « Power BI » l'emporte sur « Power ».
 */
interface Matcher<T> { insensitive: RegExp | null; exact: RegExp | null; byKey: Map<string, T> }

function matcherOf<T>(items: readonly { item: T; variants: readonly string[] }[], caseSensitive: (written: string) => boolean): Matcher<T> {
  const lists = { i: new Set<string>(), s: new Set<string>() }
  const byKey = new Map<string, T>()
  for (const { item, variants } of items) {
    for (const variant of variants) {
      const written = variant.replace(/^=+/, '')
      const mode = variant.startsWith('=') || caseSensitive(written) ? 's' : 'i'
      const key = `${mode}:${matchKey(written)}`
      if (!byKey.has(key)) byKey.set(key, item)
      lists[mode].add(written)
    }
  }
  const compile = (list: Set<string>, flags: string) => (list.size
    ? new RegExp(`${BEFORE}(?:${[...list].sort((a, b) => b.length - a.length).map(patternOf).join('|')})${AFTER}`, flags)
    : null)
  return { insensitive: compile(lists.i, 'giu'), exact: compile(lists.s, 'gu'), byKey }
}

interface Found<T> { item: T; index: number; end: number; count: number }

/**
 * Termes présents dans le texte : première position, fin de cette première occurrence, nombre d'occurrences. Chaque
 * passage reconnu est effacé avant la seconde expression : « BI » n'est pas compté dans « Power BI ».
 */
function findTerms<T>(text: string, matcher: Matcher<T>): Found<T>[] {
  const found = new Map<T, Found<T>>()
  let work = text
  for (const [mode, re] of [['i', matcher.insensitive], ['s', matcher.exact]] as const) {
    if (!re) continue
    re.lastIndex = 0
    work = work.replace(re, (match: string, ...rest: unknown[]) => {
      const offset = rest[rest.length - 2] as number
      const item = matcher.byKey.get(`${mode}:${matchKey(match)}`)
      if (item !== undefined) {
        const hit = found.get(item)
        if (!hit) found.set(item, { item, index: offset, end: offset + match.length, count: 1 })
        else {
          hit.count++
          if (offset < hit.index) Object.assign(hit, { index: offset, end: offset + match.length })
        }
      }
      return ' '.repeat(match.length)
    })
  }
  return [...found.values()]
}

// Expressions du vocabulaire, compilées une fois par vocabulaire (cv-classify.ts le garde une heure).
const vocabularyMatchers = new WeakMap<VocabularyTerm[], Matcher<VocabularyTerm>>()
function vocabularyMatcher(terms: VocabularyTerm[]): Matcher<VocabularyTerm> {
  let matcher = vocabularyMatchers.get(terms)
  if (!matcher) {
    matcher = matcherOf(terms.map(t => ({ item: t, variants: t.variants })), shortAcronym)
    vocabularyMatchers.set(terms, matcher)
  }
  return matcher
}

/** Expression construite au premier usage (listes fixes : villes, pays, secteurs, langues). */
function lazy<T>(build: () => T): () => T {
  let value: T | undefined
  return () => (value ??= build())
}

/** Sigle de deux caractères en capitales (« BI », « UX », « C# ») : reconnu seulement écrit ainsi. */
const shortAcronym = (written: string) => written.length <= 2 && written === written.toUpperCase()
const byPosition = <T>(a: Found<T>, b: Found<T>) => a.index - b.index
const byFrequency = <T>(a: Found<T>, b: Found<T>) => b.count - a.count || a.index - b.index

// ---------- Rubriques du CV ----------

type Section = 'header' | 'experience' | 'education' | 'certifications' | 'languages' | 'skills'

// Titres de rubrique, sur la ligne sans accents ni casse ; « education » avant « experience » (« parcours académique »).
const HEADINGS: readonly [Section, string][] = [
  ['education', 'formations?|formation academique|education|etudes|diplomes?|cursus|academic background|parcours academique|parcours scolaire'],
  ['certifications', 'certifications?|certificats?'],
  ['languages', 'langues?|languages?|competences linguistiques|language skills'],
  ['skills', 'competences|skills|technical skills|environnements? techniques?|outils|technologies'],
  ['experience', 'experiences?|parcours|professional experience|work experience|employment history|missions|historique professionnel'],
]
// Un titre peut être suivi de qualificatifs (« Expériences professionnelles », « Formations et certifications »), ou de
// deux-points et du contenu sur la même ligne (« Langues : anglais courant ») ; jamais d'une phrase.
const QUALIFIERS = String.raw`(?:\s+(?:professionnelles?|techniques?|academiques?|linguistiques?|cles|realisees|fonctionnelles|et\s+\S+|&\s+\S+))*`
const HEADING_RES = HEADINGS.map(([section, words]) => [section, new RegExp(String.raw`^(?:${words})${QUALIFIERS}\s*(:\s*\S.*)?:?\s*$`)] as const)

/**
 * Rubrique annoncée par une ligne ; `inline` : titre suivi de son contenu (« Environnement technique : Jira, Git »), qui
 * ne vaut que pour cette ligne — il clôt souvent chaque expérience, et la suivante ne doit pas sortir du parcours.
 */
function headingOf(line: string): { section: Section; inline: boolean } | null {
  const trimmed = line.trim()
  // Une puce n'est pas un titre (« - Formation des utilisateurs »).
  if (!trimmed || /^[-•*–—·]/.test(trimmed)) return null
  const k = keyOf(trimmed).replace(/^[^\p{L}]+/u, '')
  for (const [section, re] of HEADING_RES) {
    const m = re.exec(k)
    if (m) return { section, inline: m[1] !== undefined }
  }
  return null
}

interface Line { text: string; folded: string; section: Section; inHeader: boolean }

/** Lignes du CV avec leur rubrique ; l'en-tête (avant la première rubrique) borné à 800 caractères, 600 sans rubrique. */
function linesOf(text: string): Line[] {
  let section: Section = 'header'
  const lines = text.split('\n').map(raw => {
    const heading = headingOf(raw)
    if (heading && !heading.inline) section = heading.section
    return { text: raw, folded: fold(raw), section: heading?.section ?? section, inHeader: false }
  })
  const cap = lines.some(l => l.section !== 'header') ? 800 : 600
  let seen = 0
  for (const line of lines) {
    if (line.section !== 'header' || seen >= cap) break
    line.inHeader = true
    seen += line.text.length + 1
  }
  return lines
}

/** Texte de certaines lignes, les autres vidées (l'ordre et les positions relatives restent). */
const zoneOf = (lines: Line[], keep: (line: Line, i: number) => boolean) => lines.map((l, i) => (keep(l, i) ? l.folded : '')).join('\n')
/**
 * Parcours : tout sauf formation, certifications et langues. Une rubrique « Compétences » en compte : un titre
 * « Environnement technique » seul sur sa ligne, entre deux expériences, ne doit pas en retirer les suivantes.
 */
const isCareer = (l: Line) => l.section !== 'education' && l.section !== 'certifications' && l.section !== 'languages'
const YEAR = /\b(?:19[6-9]\d|20[0-4]\d)\b/

// ---------- Vocabulaire ----------

const AMBIGUOUS = new Set<string>(AMBIGUOUS_TERMS)
const SOFT_SKILLS = new Set<string>(SOFT_SKILL_WORDS)
const SENSITIVE = new Set<string>(SENSITIVE_WORDS)

/** Écriture assez sûre pour être cherchée : deux caractères au moins, une lettre, pas un mot courant. */
function usable(variant: string): boolean {
  const k = keyOf(variant)
  return k.length >= 2 && /\p{L}/u.test(k) && !AMBIGUOUS.has(k)
}

function seedTerms(seed: Partial<Record<JobFamily | 'transverse', readonly string[]>>): VocabularyTerm[] {
  return Object.entries(seed).flatMap(([family, entries]) => (entries ?? []).map(entry => {
    const [name, ...others] = entry.split('|')
    return { name: name.replace(/^=+/, ''), variants: [name, ...others].filter(usable), family: family === 'transverse' ? null : family as JobFamily }
  })).filter(term => term.variants.length > 0)
}

function addExtra(terms: VocabularyTerm[], extra: readonly string[], max: { chars: number; words: number }, rejectSoftSkills: boolean): void {
  const known = new Set(terms.flatMap(t => [t.name, ...t.variants].map(keyOf)))
  for (const raw of extra) {
    const name = String(raw).replace(/^=+/, '').replace(/\s+/g, ' ').trim()
    const k = keyOf(name)
    if (!name || name.length > max.chars || name.split(' ').length > max.words || !usable(name) || known.has(k)) continue
    // Chaque mot a une lettre ou un chiffre (« - - - a » n'est pas un terme) ; jamais une donnée sensible.
    const words = k.split(/[\s'-]+/)
    if (name.split(' ').some(word => !/[\p{L}\p{N}]/u.test(word)) || words.some(word => SENSITIVE.has(word))) continue
    if (rejectSoftSkills && words.some(word => SOFT_SKILLS.has(word))) continue
    known.add(k)
    terms.push({ name, variants: [name], family: null })
  }
}

/**
 * Vocabulaire des règles : listes de départ, puis les compétences et métiers relevés ailleurs (index de recherche :
 * les plus fréquents, issus des classifications par l'IA) qu'elles n'ont pas déjà. Seuls les termes courts sont gardés,
 * sans qualité personnelle (« Rigueur ») ni donnée sensible (« RQTH »). Pas les compétences des offres : saisies
 * librement par n'importe quel recruteur, elles lui auraient permis de faire de n'importe quel mot des CV des autres
 * organisations (un nom, une donnée de santé) une compétence indexée (revue de sécurité du 2026-11-18).
 */
export function buildRuleVocabulary(extra: { skills?: readonly string[]; roles?: readonly string[] } = {}): RuleVocabulary {
  const skills = seedTerms(SKILL_SEED)
  const roles = seedTerms(ROLE_SEED)
  addExtra(skills, extra.skills ?? [], { chars: 40, words: 4 }, true)
  addExtra(roles, extra.roles ?? [], { chars: 60, words: 6 }, false)
  return { skills, roles }
}

// ---------- Métiers, compétences, famille ----------

const GENERIC = new Set(GENERIC_ROLES.map(keyOf))

/** Métiers de l'en-tête et des lignes datées du parcours (« 2019 – 2022 · Chef de projet »), dans l'ordre du CV. */
function rolesOf(lines: Line[], vocabulary: RuleVocabulary): VocabularyTerm[] {
  const dated = new Set(lines.flatMap((l, i) => (isCareer(l) && YEAR.test(l.folded) ? [i, i + 1] : [])))
  const zone = zoneOf(lines, (l, i) => l.inHeader || (isCareer(l) && dated.has(i)))
  const found = findTerms(zone, vocabularyMatcher(vocabulary.roles)).sort(byPosition).map(f => f.item)
  // « Consultant » seul ne dit rien quand « Consultant SAP » ou « Chef de projet » est reconnu.
  const precise = found.filter(t => !GENERIC.has(keyOf(t.name)))
  return (precise.length ? precise : found).slice(0, CLASSIFICATION_LIMITS.roles)
}

/** Famille la plus représentée parmi les compétences reconnues (en nombre de compétences distinctes). */
function familyOfSkills(found: Found<VocabularyTerm>[]): JobFamily | null {
  const votes = new Map<JobFamily, { n: number; first: number }>()
  for (const f of found) {
    const family = f.item.family
    if (!family || family === 'autre') continue
    const vote = votes.get(family) ?? { n: 0, first: f.index }
    votes.set(family, { n: vote.n + 1, first: Math.min(vote.first, f.index) })
  }
  return [...votes.entries()].sort(([, a], [, b]) => b.n - a.n || a.first - b.first)[0]?.[0] ?? null
}

// ---------- Années d'expérience ----------

const MONTH = String.raw`(janv(?:ier)?|jan(?:uary)?|fevr?(?:ier)?|feb(?:ruary)?|mars|mar(?:ch)?|avr(?:il)?|apr(?:il)?|mai|may|juin|june?|juil(?:let)?|july?|aout|aug(?:ust)?|sept?(?:embre|ember)?|oct(?:obre|ober)?|nov(?:embre|ember)?|dec(?:embre|ember)?)`
const POINT = String.raw`(?:\b${MONTH}\.?\s+|\b(\d{1,2})[/.-])?((?:19|20)\d{2})\b`
const ONGOING = String.raw`(aujourd'?\s?hui|a ce jour|ce jour|present|actuel(?:lement)?|now|current|en cours|today)`
const SEPARATOR = String.raw`\s*(?:-|–|—|a|au|to|until|jusqu'?(?:a|au|en)|>|→)\s*`
// Groupes : 1 mois, 2 mois en chiffres, 3 année (début) ; 4, 5, 6 (fin) ; 7 « aujourd'hui ».
const RANGE = new RegExp(`${POINT}${SEPARATOR}(?:${POINT}|${ONGOING})`, 'g')
// Groupes : 1 mois, 2 mois en chiffres, 3 année.
const SINCE = new RegExp(String.raw`\b(?:depuis|since)\s+(?:le\s+)?(?:\b${MONTH}\.?\s+|\b(\d{1,2})[/.-])?((?:19|20)\d{2})\b`, 'g')
// Espaces bornés : une longue suite d'espaces après un chiffre ne doit pas coûter un temps quadratique.
const EXPLICIT_YEARS = /\b(\d{1,2}) {0,3}\+? {0,3}(?:ans|annees) {1,3}d'? {0,2}experience|\b(\d{1,2}) {0,3}\+? {0,3}years? {1,3}(?:of {1,3})?(?:professional {1,3})?experience/

function monthOf(name: string | undefined, digits: string | undefined): number | null {
  if (digits) {
    const n = Number(digits)
    return n >= 1 && n <= 12 ? n : null
  }
  if (!name) return null
  const order: [RegExp, number][] = [
    [/^(juil|jul)/, 7], [/^(jui|jun)/, 6], [/^jan/, 1], [/^fe/, 2], [/^ma[iy]/, 5], [/^mar/, 3], [/^(av|ap)/, 4],
    [/^(ao|au)/, 8], [/^se/, 9], [/^oc/, 10], [/^no/, 11], [/^de/, 12],
  ]
  return order.find(([re]) => re.test(name))?.[1] ?? null
}

/**
 * Années d'expérience : celles que l'en-tête du CV écrit (« 12 ans d'expérience » — ailleurs, c'est souvent celles d'un
 * outil : « 2 ans d'expérience sur Jira »), sinon la durée réunie des périodes du parcours (« janv. 2019 –
 * aujourd'hui », « 2013 - 2016 », « depuis 2022 »), chevauchements comptés une fois ; null sans période. Une année
 * seule va de janvier à janvier (« 2013 - 2016 » : 3 ans) ; un mois de fin est compris.
 */
function yearsOf(lines: Line[], now: Date): number | null {
  const text = zoneOf(lines, isCareer).toLowerCase()
  const explicit = zoneOf(lines, l => l.inHeader).toLowerCase().match(EXPLICIT_YEARS)
  if (explicit) {
    const years = Number(explicit[1] ?? explicit[2])
    if (years <= 60) return years
  }
  const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const intervals: [number, number][] = []
  const add = (startYear: number, startMonth: number | null, end: number) => {
    const start = startYear * 12 + (startMonth ?? 1) - 1
    if (startYear < 1960 || start > nowMonth) return
    const bounded = Math.min(end, nowMonth + 1)
    if (bounded > start && bounded - start <= 45 * 12) intervals.push([start, bounded])
  }
  const rest = text.replace(RANGE, (match, m1, d1, y1, m2, d2, y2, ongoing) => {
    const startMonth = monthOf(m1, d1)
    const endMonth = monthOf(m2, d2)
    if (ongoing) add(Number(y1), startMonth, nowMonth + 1)
    else if (endMonth) add(Number(y1), startMonth, Number(y2) * 12 + endMonth)
    // Même année sans mois (« 2019 - 2019 ») : six mois plutôt que rien.
    else if (!startMonth && y1 === y2) add(Number(y1), null, Number(y1) * 12 + 6)
    else add(Number(y1), startMonth, Number(y2) * 12)
    return ' '.repeat(match.length)
  })
  for (const m of rest.matchAll(SINCE)) add(Number(m[3]), monthOf(m[1], m[2]), nowMonth + 1)
  if (!intervals.length) return null
  intervals.sort((a, b) => a[0] - b[0])
  let months = 0
  let [start, end] = intervals[0]
  for (const [s, e] of intervals.slice(1)) {
    if (s <= end) {
      end = Math.max(end, e)
    } else {
      months += end - start
      start = s
      end = e
    }
  }
  months += end - start
  return Math.round(months / 12)
}

// ---------- Études, langues, certifications ----------

// Du plus haut au plus bas : le premier niveau trouvé l'emporte.
const EDUCATION_LADDER: readonly [Education, RegExp][] = [
  ['doctorat', /\b(?:doctorat|ph\.?\s?d|docteur en|these de doctorat)\b/],
  ['bac+5', /\b(?:master|mastere|msc|m\.sc|mba|m2|dea|dess|diplome d'?\s?ingenieurs?|ecoles? d'?\s?ingenieurs?|ingenieur diplome|titre d'?\s?ingenieur|cycle (?:d'?\s?)?ingenieur|grande ecole|bac\s*\+\s*5)\b/],
  ['bac+3', /\b(?:licence|bachelor|l3|bac\s*\+\s*3)\b/],
  ['bac+2', /\b(?:bts|dut|deug|deust|bac\s*\+\s*2)\b/],
  ['bac', /\b(?:baccalaureat|bac)\b/],
]
// « Scrum Master » n'est pas un diplôme.
const NOT_A_DEGREE = /\b(?:scrum\s?master|master data|master ?class|master plan|web ?master)\b/g

// Sans rubrique Formation, seules les lignes qui parlent d'un diplôme ou d'un établissement sont lues : « support
// applicatif niveau L3 », « licence Oracle » ne sont pas des diplômes.
const ABOUT_A_DEGREE = /\b(?:universite|university|ecoles?|school|institut|institute|iut|faculte|college|lycee|diplome|diplomee|degree|obtention)\b/

function educationOf(lines: Line[]): Education {
  const inSection = lines.some(l => l.section === 'education')
  const text = zoneOf(lines, l => (inSection ? l.section === 'education' : ABOUT_A_DEGREE.test(l.folded.toLowerCase())))
    .toLowerCase().replace(NOT_A_DEGREE, ' ')
  return EDUCATION_LADDER.find(([, re]) => re.test(text))?.[0] ?? 'non_precise'
}

const LEVELS: readonly [Exclude<Level, 'non_precise'>, RegExp][] = [
  ['natif', /\b(?:natif|native|maternelle|mother tongue|langue natale)\b/],
  ['bilingue', /\b(?:bilingue|bilingual|c2)\b/],
  ['courant', /\b(?:courante?|fluent(?:ly)?|c1|avance|advanced|professionnel|professional)\b/],
  ['intermediaire', /\b(?:intermediaire|intermediate|b1|b2|bon niveau)\b/],
  ['notions', /\b(?:notions?|debutant|beginner|basic|basique|scolaire|elementaire|elementary|a1|a2)\b/],
]

/** Niveau écrit le plus tôt après le nom de la langue ; un score TOEIC compte aussi. */
function levelIn(window: string): Level {
  const hits: [number, Level][] = []
  for (const [level, re] of LEVELS) {
    const m = re.exec(window)
    if (m) hits.push([m.index, level])
  }
  const toeic = /\btoeic\s*:?\s*(\d{3})\b/.exec(window)
  if (toeic) {
    const score = Number(toeic[1])
    hits.push([toeic.index, score >= 785 ? 'courant' : score >= 550 ? 'intermediaire' : 'notions'])
  }
  return hits.sort((a, b) => a[0] - b[0])[0]?.[1] ?? 'non_precise'
}

/** « Nom|variante » → nom et toutes ses écritures. */
const entriesOf = (list: readonly string[]) => list.map(entry => {
  const [name, ...others] = entry.split('|')
  return { item: name, variants: [name, ...others] }
})
const languageMatcher = lazy(() => matcherOf(entriesOf(LANGUAGE_NAMES), () => false))

/**
 * Langues de la rubrique « Langues » (avec ou sans niveau) ; sans rubrique, seulement celles suivies d'un niveau
 * (« French bank » n'est pas une langue parlée).
 */
function languagesOf(lines: Line[]): CvClassification['languages'] {
  const section = zoneOf(lines, l => l.section === 'languages')
  const inSection = section.trim() !== ''
  const text = (inSection ? section : zoneOf(lines, () => true)).toLowerCase()
  const firsts = findTerms(text, languageMatcher()).sort(byPosition)
  return firsts.flatMap((lang, i) => {
    const lineEnd = text.indexOf('\n', lang.end)
    const stop = Math.min(lang.end + 50, firsts[i + 1]?.index ?? Infinity, lineEnd === -1 ? Infinity : lineEnd)
    const level = levelIn(text.slice(lang.end, stop))
    return inSection || level !== 'non_precise' ? [{ name: lang.item, level }] : []
  }).slice(0, CLASSIFICATION_LIMITS.languages)
}

const GLOBAL_CERTIFICATIONS = CERTIFICATION_PATTERNS.map(c => ({ name: c.name, pattern: new RegExp(c.pattern.source, `${c.pattern.flags}g`) }))

/** Certifications de la rubrique « Certifications » et des lignes qui parlent de certification, dans l'ordre du CV. */
function certificationsOf(lines: Line[]): string[] {
  const text = zoneOf(lines, l => l.section === 'certifications' || /certif/i.test(l.folded))
  const hits = GLOBAL_CERTIFICATIONS.flatMap(({ name, pattern }) =>
    [...text.matchAll(pattern)].map(m => ({ name: (name ?? m[0]).trim().slice(0, 100), index: m.index })))
  const seen = new Set<string>()
  return hits.sort((a, b) => a.index - b.index).filter(h => {
    const k = keyOf(h.name)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).map(h => h.name).slice(0, CLASSIFICATION_LIMITS.certifications)
}

// ---------- Lieu, disponibilité, TJM ----------

const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'sur', 'sous', 'en', "l'", "d'"])
/** « issy-les-moulineaux » → « Issy-les-Moulineaux » (listes de regions.ts en minuscules). */
const titleCase = (s: string) => s.split(/([ -])/).map((part, i) =>
  (i > 0 && SMALL_WORDS.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('')

const cityMatcher = lazy(() => matcherOf([
  ...Object.values(FRANCE_REGIONS).flatMap(cities => cities.map(city => ({ city, country: 'France' }))),
  ...Object.entries(INTERNATIONAL_LOCATIONS).flatMap(([country, cities]) => cities.map(city => ({ city, country: titleCase(country) }))),
].filter(({ city }) => city.length >= 3 && !(AMBIGUOUS_CITIES as readonly string[]).includes(city))
  .map(place => ({ item: place, variants: [place.city] })), () => false))
const countryMatcher = lazy(() => matcherOf(entriesOf(COUNTRY_NAMES), () => false))
// Code postal français suivi de la ville, sur la même ligne : un mot (« Lyon », « Boulogne-Billancourt »,
// « Aix-en-Provence »), deux après un article ou « Saint » (« La Rochelle », « Saint Étienne ») — pas la suite de la
// ligne (« 69003 Lyon Chef de projet »).
const POSTCODE_CITY = /(?<!\d)(\d{5})[ \t]+((?:(?:Le|La|Les|Saint|Sainte|St|Ste)[ -])?\p{Lu}[\p{L}'-]*)/u

/** Ville et pays de résidence, cherchés dans l'en-tête : code postal, sinon grande ville connue, sinon pays seul. */
function placeOf(header: string): { city: string; country: string } {
  const postcode = POSTCODE_CITY.exec(header)
  if (postcode && Number(postcode[1]) >= 1000 && Number(postcode[1]) <= 98999) {
    const city = postcode[2].replace(/\s+(?:France|Cedex.*)$/i, '').trim()
    if (city) return { city: city.slice(0, 80), country: 'France' }
  }
  const text = fold(header)
  const place = findTerms(text, cityMatcher()).sort(byPosition)[0]?.item
  if (place) return { city: titleCase(place.city), country: place.country }
  const country = findTerms(text, countryMatcher()).sort(byPosition)[0]?.item
  return { city: '', country: country ?? '' }
}

// Mention de disponibilité dans l'en-tête ; « disponibilité des applications » (mission) n'en est pas une.
const AVAILABILITY = /\b(?:disponible\b[^\n.;·|,]{0,40}|disponibilit[ée]\s*:[^\n.;·|,]{0,40}|available\b[^\n.;·|]{0,40}|availability\s*:[^\n.;·|]{0,40}|pr[ée]avis\b[^\n.;·|,]{0,30}|notice period\b[^\n.;·|]{0,30})/iu
const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/**
 * Disponibilité sous une forme fermée — « Immédiate », « Préavis de 3 mois », « À partir de janvier 2027 » —, jamais le
 * texte qui suit la mention (« Disponible immédiatement – né le … » recopiait une date de naissance) ; '' sinon.
 */
function availabilityOf(header: string): string {
  const mention = AVAILABILITY.exec(header)?.[0]
  if (!mention) return ''
  const t = keyOf(mention)
  if (/\b(?:immediat\w*|immediately|asap|de suite|tout de suite|des maintenant|now)\b/.test(t)) return 'Immédiate'
  const notice = /\b(\d{1,2}) ?(mois|months?|semaines?|weeks?)\b/.exec(t)
  if (notice) return `Préavis de ${Number(notice[1])} ${/^(?:mois|month)/.test(notice[2]) ? 'mois' : Number(notice[1]) > 1 ? 'semaines' : 'semaine'}`
  const month = new RegExp(String.raw`\b${MONTH}\.?\s+(20\d{2})\b`).exec(t)
  const monthNumber = month ? monthOf(month[1], undefined) : null
  if (month && monthNumber) return `À partir de ${MONTH_NAMES[monthNumber - 1]} ${month[2]}`
  const date = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(t)
  if (date && Number(date[2]) >= 1 && Number(date[2]) <= 12) return `À partir du ${date[1].padStart(2, '0')}/${date[2].padStart(2, '0')}/${date[3]}`
  return ''
}

// Montant entier de 3 ou 4 chiffres (« 15 000 € », un salaire annuel, ne se lit pas 1500).
const DAILY_RATE = [
  /\btjm\b[^\d\n]{0,25}(\d{3,4})(?!\d)/,
  /\btaux journalier\b[^\d\n]{0,25}(\d{3,4})(?!\d)/,
  /\b(\d{3,4})\s*(?:€|eur(?:os?)?)\s*(?:ht\s*)?(?:\/|par)\s*(?:j|jour|day)\b/,
]

function dailyRateOf(text: string): number | null {
  // Séparateur des milliers retiré : « 1 200 €/jour » se lit 1200, pas 200.
  const joined = text.replace(/(\d)[ .](?=\d{3}\b)/g, '$1')
  for (const re of DAILY_RATE) {
    const rate = Number(re.exec(joined)?.[1])
    if (rate >= 150 && rate <= 3000) return rate
  }
  return null
}

// ---------- Secteurs ----------

// Sigle de 4 caractères au plus (« AXA », « BRED », « CIC ») : casse exacte ; les autres noms sans tenir compte de la
// casse (« BNP PARIBAS » écrit en capitales) ; « =Orange » : casse exacte (pas la couleur).
const sectorMatcher = lazy(() => matcherOf(
  (Object.entries(SECTOR_KEYWORDS) as [Exclude<Sector, 'autre'>, readonly string[]][]).map(([sector, words]) => ({ item: sector, variants: words })),
  written => written.length <= 4 && /\p{Lu}/u.test(written),
))
const falseFriends = lazy(() => matcherOf([{ item: true, variants: SECTOR_FALSE_FRIENDS }], () => false).insensitive)

/** Secteurs cités (mots du secteur, grandes entreprises), les plus cités d'abord ; expressions trompeuses effacées. */
function sectorsOf(text: string): Sector[] {
  const blank = falseFriends()
  const cleaned = blank ? text.replace(blank, m => ' '.repeat(m.length)) : text
  return findTerms(cleaned, sectorMatcher()).sort(byFrequency).map(f => f.item).slice(0, CLASSIFICATION_LIMITS.sectors)
}

// ---------- Classement ----------

/** Classification d'un CV par les règles, mêmes champs et mêmes bornes que celle de l'IA (parseClassification). */
export function classifyCvByRules(raw: string, vocabulary: RuleVocabulary, now: Date): CvClassification {
  const text = cleanText(raw)
  const lines = linesOf(text)
  const all = lines.map(l => l.folded).join('\n')
  const header = lines.filter(l => l.inHeader).map(l => l.text).join('\n')

  const roles = rolesOf(lines, vocabulary)
  const skillsFound = findTerms(all, vocabularyMatcher(vocabulary.skills))
  const years = yearsOf(lines, now)
  const place = placeOf(header)

  return {
    version: CLASSIFICATION_VERSION,
    roles: roles.map(r => r.name),
    // Famille du premier métier qui en a une ; sinon celle des compétences ; sinon « autre ».
    jobFamily: roles.find(r => r.family)?.family ?? familyOfSkills(skillsFound) ?? 'autre',
    yearsOfExperience: years,
    seniority: seniorityOf(years),
    skills: skillsFound.sort(byFrequency).map(f => f.item.name).slice(0, CLASSIFICATION_LIMITS.skills),
    sectors: sectorsOf(all),
    clients: [],
    languages: languagesOf(lines),
    city: place.city,
    country: place.country,
    dailyRate: dailyRateOf(all.toLowerCase()),
    availability: availabilityOf(header),
    educationLevel: educationOf(lines),
    certifications: certificationsOf(lines),
    summary: '',
  }
}
