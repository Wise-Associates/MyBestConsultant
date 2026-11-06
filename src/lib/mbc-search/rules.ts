import { z } from 'zod'

// MBC Search (/recruiter/mbc-search, ADR 0018) : le recruteur décrit le profil recherché, l'IA en tire des critères
// qu'il peut corriger, la base de personnes d'Apollo.io renvoie des profils, classés ici avec les raisons du classement.
// Règles pures, testées dans rules.test.ts : critères, requête Apollo, lecture de sa réponse et score. Sans import
// serveur : la page les utilise aussi dans le navigateur (access.ts porte l'accès, qui dépend de node:crypto).

/** Niveaux de séniorité acceptés par Apollo (`person_seniorities`), avec leur libellé pour le recruteur. */
export const SENIORITIES = {
  intern: 'Stagiaire', entry: 'Junior', senior: 'Confirmé / senior', manager: 'Manager', head: 'Responsable',
  director: 'Directeur', vp: 'VP', c_suite: 'Direction générale', partner: 'Associé', founder: 'Fondateur', owner: 'Dirigeant',
} as const
export type Seniority = keyof typeof SENIORITIES
const SENIORITY_IDS = Object.keys(SENIORITIES) as [Seniority, ...Seniority[]]

export const CRITERIA_LIMITS = { brief: 4000, items: 8, item: 80, keywords: 200 } as const

const item = z.string().trim().min(1).max(CRITERIA_LIMITS.item)

/** Critères d'une recherche, validés à chaque Server Action : ils viennent du navigateur. */
export const criteriaSchema = z.object({
  titles: z.array(item).max(CRITERIA_LIMITS.items),
  locations: z.array(item).max(CRITERIA_LIMITS.items),
  seniorities: z.array(z.enum(SENIORITY_IDS)).max(SENIORITY_IDS.length),
  skills: z.array(item).max(CRITERIA_LIMITS.items),
})
export type MbcCriteria = z.infer<typeof criteriaSchema>

export const EMPTY_CRITERIA: MbcCriteria = { titles: [], locations: [], seniorities: [], skills: [] }

export const PAGE_SIZE = 25
/** Apollo n'affiche pas plus de 500 pages ; au-delà de 40 pages de 25, un recruteur affine plutôt sa recherche. */
export const MAX_PAGE = 40

/** Une recherche sans intitulé de poste ni compétence renverrait n'importe qui : refusée avant d'appeler Apollo. */
export function criteriaProblem(criteria: MbcCriteria): string | null {
  if (criteria.titles.length === 0 && criteria.skills.length === 0) return 'Indiquez au moins un intitulé de poste ou une compétence.'
  return null
}

/** Corps de la requête `POST /api/v1/mixed_people/api_search` d'Apollo (recherche sans crédit, sans e-mail ni téléphone). */
export function toApolloQuery(criteria: MbcCriteria, page: number) {
  return {
    person_titles: criteria.titles,
    person_locations: criteria.locations,
    person_seniorities: criteria.seniorities,
    // Apollo cherche ces mots dans le nom, l'intitulé et l'employeur : les compétences y sont un filtre large.
    q_keywords: criteria.skills.join(' ').slice(0, CRITERIA_LIMITS.keywords),
    include_similar_titles: true,
    page,
    per_page: PAGE_SIZE,
  }
}

/** Profil tel qu'Apollo le montre avant enrichissement : nom de famille masqué, ni e-mail ni téléphone. */
export interface MbcProfile {
  id: string
  firstName: string
  lastNameMasked: string
  title: string
  company: string
  hasEmail: boolean
  hasPhone: boolean
  /** Date ISO de la dernière mise à jour du profil chez Apollo ; '' si inconnue. */
  refreshedAt: string
}

const apolloPersonSchema = z.object({
  id: z.string().min(1),
  first_name: z.string().nullish(),
  last_name_obfuscated: z.string().nullish(),
  title: z.string().nullish(),
  last_refreshed_at: z.string().nullish(),
  has_email: z.boolean().nullish(),
  has_direct_phone: z.union([z.string(), z.boolean()]).nullish(),
  organization: z.object({ name: z.string().nullish() }).nullish(),
})

const apolloResponseSchema = z.object({
  total_entries: z.number().int().nonnegative().optional(),
  people: z.array(z.unknown()).default([]),
})

/**
 * Lit la réponse d'Apollo. Une réponse d'une autre forme est une erreur (null) ; une personne illisible est seulement
 * écartée, pour ne pas perdre toute la page à cause d'un seul profil.
 */
export function parseApolloPeople(json: unknown): { total: number; profiles: MbcProfile[] } | null {
  const parsed = apolloResponseSchema.safeParse(json)
  if (!parsed.success) return null
  const profiles: MbcProfile[] = []
  for (const raw of parsed.data.people) {
    const person = apolloPersonSchema.safeParse(raw)
    if (!person.success) continue
    const p = person.data
    profiles.push({
      id: p.id,
      firstName: p.first_name?.trim() ?? '',
      lastNameMasked: p.last_name_obfuscated?.trim() ?? '',
      title: p.title?.trim() ?? '',
      company: p.organization?.name?.trim() ?? '',
      hasEmail: p.has_email === true,
      // Apollo écrit « Yes », « Maybe: … » ou « No » ; seul « Yes » annonce un numéro direct connu.
      hasPhone: p.has_direct_phone === true || p.has_direct_phone === 'Yes',
      refreshedAt: p.last_refreshed_at ?? '',
    })
  }
  return { total: parsed.data.total_entries ?? profiles.length, profiles }
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => normalize(s).split(/[^a-z0-9+#.]+/).filter(w => w.length > 1)

/** Points de chaque critère (total 100). L'intitulé compte le plus : c'est le seul texte du profil avant enrichissement. */
export const SCORE_WEIGHTS = { title: 55, skills: 25, reachable: 10, fresh: 10 } as const
const FRESH_DAYS = 180

/** Ce que le profil remplit de chaque critère : la grille de la liste de résultats (une colonne par critère). */
export interface CriteriaMatch {
  /** 'any' : aucun intitulé demandé, le critère ne départage personne. */
  title: 'full' | 'partial' | 'none' | 'any'
  /** Compétences demandées visibles dans l'intitulé ou l'employeur. */
  skills: string[]
  reachable: boolean
  fresh: boolean
}

export interface ScoredProfile extends MbcProfile {
  score: number
  reasons: string[]
  match: CriteriaMatch
}

/**
 * Score d'un profil (0-100) et raisons lisibles par le recruteur. Apollo a déjà filtré lieu et séniorité : le score
 * départage les profils sur ce qu'on voit d'eux. `now` est injecté pour des tests déterministes.
 */
export function scoreProfile(profile: MbcProfile, criteria: MbcCriteria, now: Date): ScoredProfile {
  const reasons: string[] = []
  const titleWords = new Set(words(profile.title))
  let score = 0

  // Intitulé : meilleur recouvrement avec l'un des intitulés demandés (« Data Engineer » ↔ « Senior Data Engineer » = 100 %).
  let bestTitle = 0
  let bestTitleLabel = ''
  for (const wanted of criteria.titles) {
    const wantedWords = words(wanted)
    if (wantedWords.length === 0) continue
    const ratio = wantedWords.filter(w => titleWords.has(w)).length / wantedWords.length
    if (ratio > bestTitle) { bestTitle = ratio; bestTitleLabel = wanted }
  }
  if (criteria.titles.length === 0) {
    // Sans intitulé demandé, ce critère ne départage personne : ses points sont acquis à tous.
    score += SCORE_WEIGHTS.title
  } else if (bestTitle > 0) {
    score += Math.round(SCORE_WEIGHTS.title * bestTitle)
    reasons.push(bestTitle === 1 ? `Intitulé conforme : « ${bestTitleLabel} »` : `Intitulé proche de « ${bestTitleLabel} »`)
  }

  // Compétences : celles qu'on lit dans l'intitulé ou l'employeur (seuls textes visibles avant enrichissement).
  const visible = normalize(`${profile.title} ${profile.company}`)
  const found = criteria.skills.filter(s => visible.includes(normalize(s)))
  if (criteria.skills.length === 0) score += SCORE_WEIGHTS.skills
  else if (found.length > 0) {
    score += Math.round(SCORE_WEIGHTS.skills * found.length / criteria.skills.length)
    reasons.push(`Compétence${found.length > 1 ? 's' : ''} visible${found.length > 1 ? 's' : ''} : ${found.join(', ')}`)
  }

  if (profile.hasEmail || profile.hasPhone) {
    score += SCORE_WEIGHTS.reachable
    reasons.push(profile.hasEmail && profile.hasPhone ? 'E-mail et téléphone disponibles' : profile.hasEmail ? 'E-mail disponible' : 'Téléphone disponible')
  }

  const refreshed = Date.parse(profile.refreshedAt)
  const fresh = Number.isFinite(refreshed) && now.getTime() - refreshed <= FRESH_DAYS * 86_400_000
  if (fresh) {
    score += SCORE_WEIGHTS.fresh
    reasons.push('Profil mis à jour il y a moins de 6 mois')
  }

  const match: CriteriaMatch = {
    title: criteria.titles.length === 0 ? 'any' : bestTitle === 1 ? 'full' : bestTitle > 0 ? 'partial' : 'none',
    skills: found,
    reachable: profile.hasEmail || profile.hasPhone,
    fresh,
  }
  return { ...profile, score: Math.min(100, score), reasons, match }
}

/** Profils du meilleur au moins bon score ; à score égal, l'ordre d'Apollo est gardé. */
export function rankProfiles(profiles: MbcProfile[], criteria: MbcCriteria, now: Date): ScoredProfile[] {
  return profiles
    .map((p, i) => ({ scored: scoreProfile(p, criteria, now), i }))
    .sort((a, b) => b.scored.score - a.scored.score || a.i - b.i)
    .map(x => x.scored)
}

/**
 * Lit les critères rendus par l'IA à partir du brief (JSON, éventuellement entouré de texte ou d'un bloc ```json).
 * Fail closed : null si rien d'exploitable. Les valeurs inconnues (séniorité hors liste) et les doublons sont écartés,
 * les listes tronquées aux limites du formulaire.
 */
export function parseBriefCriteria(text: string): MbcCriteria | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const list = (v: unknown) => {
    if (!Array.isArray(v)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of v) {
      if (typeof x !== 'string') continue
      const s = x.trim().slice(0, CRITERIA_LIMITS.item)
      if (!s || seen.has(normalize(s))) continue
      seen.add(normalize(s))
      out.push(s)
    }
    return out.slice(0, CRITERIA_LIMITS.items)
  }
  const criteria: MbcCriteria = {
    titles: list(obj.titles),
    locations: list(obj.locations),
    seniorities: list(obj.seniorities).filter((s): s is Seniority => s in SENIORITIES),
    skills: list(obj.skills),
  }
  return criteriaProblem(criteria) ? null : criteria
}

/** Identifiant d'une personne chez Apollo (24 caractères hexadécimaux), seul élément envoyé pour l'enrichir. */
export const APOLLO_PERSON_ID = /^[a-f0-9]{24}$/
/** Personnes par appel d'enrichissement : la limite d'Apollo (`people/bulk_match`). */
export const REVEAL_BATCH = 10

export interface MbcExperience {
  title: string
  company: string
  /** « 2021-03 » ou '' ; fin vide et `current` : poste actuel. */
  start: string
  end: string
  current: boolean
}

/** Profil complet après enrichissement (payant) : nom entier, LinkedIn, e-mail professionnel, lieu, parcours. */
export interface MbcRevealed {
  id: string
  name: string
  title: string
  headline: string
  company: string
  companyWebsite: string
  location: string
  linkedinUrl: string
  email: string
  /** « verified », « guessed »… tel que donné par Apollo ; '' sans e-mail. */
  emailStatus: string
  photoUrl: string
  experiences: MbcExperience[]
}

/** Corps de `POST /api/v1/people/bulk_match` : seulement les identifiants Apollo, jamais un nom ni un e-mail. */
export function toRevealRequest(ids: string[]) {
  return { details: ids.map(id => ({ id })) }
}

const httpsUrl = (v: string | null | undefined) => {
  if (!v) return ''
  // Lien affiché tel quel dans la page : https seulement (pas de javascript: venu d'un tiers).
  const url = v.startsWith('http://') ? `https://${v.slice(7)}` : v
  return /^https:\/\/[^\s"'<>]+$/.test(url) ? url : ''
}
const PLAIN_EMAIL = /^[^\s@<>"?&]+@[^\s@<>"?&]+\.[a-z]{2,}$/i

const apolloMatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  title: z.string().nullish(),
  headline: z.string().nullish(),
  linkedin_url: z.string().nullish(),
  email: z.string().nullish(),
  email_status: z.string().nullish(),
  photo_url: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  organization: z.object({ name: z.string().nullish(), website_url: z.string().nullish() }).nullish(),
  employment_history: z.array(z.object({
    title: z.string().nullish(),
    organization_name: z.string().nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    current: z.boolean().nullish(),
  })).nullish(),
})

const monthOf = (d: string | null | undefined) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '')

/**
 * Lit la réponse de l'enrichissement. Une réponse d'une autre forme est une erreur (null) ; une personne non trouvée
 * (null chez Apollo) ou illisible est seulement absente du résultat.
 */
export function parseApolloMatches(json: unknown): MbcRevealed[] | null {
  const parsed = z.object({ matches: z.array(z.unknown()) }).safeParse(json)
  if (!parsed.success) return null
  const out: MbcRevealed[] = []
  for (const raw of parsed.data.matches) {
    const m = apolloMatchSchema.safeParse(raw)
    if (!m.success) continue
    const p = m.data
    const name = p.name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
    const email = p.email?.trim() ?? ''
    out.push({
      id: p.id,
      name,
      title: p.title?.trim() ?? '',
      headline: p.headline?.trim() ?? '',
      company: p.organization?.name?.trim() ?? '',
      companyWebsite: httpsUrl(p.organization?.website_url),
      location: [p.city, p.state, p.country].map(s => s?.trim()).filter(Boolean).filter((s, i, all) => all.indexOf(s) === i).join(', '),
      linkedinUrl: httpsUrl(p.linkedin_url),
      email: PLAIN_EMAIL.test(email) ? email : '',
      emailStatus: PLAIN_EMAIL.test(email) ? p.email_status?.trim() ?? '' : '',
      photoUrl: httpsUrl(p.photo_url),
      experiences: (p.employment_history ?? []).slice(0, 8).map(e => ({
        title: e.title?.trim() ?? '',
        company: e.organization_name?.trim() ?? '',
        start: monthOf(e.start_date),
        end: monthOf(e.end_date),
        current: e.current === true,
      })).filter(e => e.title || e.company),
    })
  }
  return out
}
