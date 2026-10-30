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

export interface ScoredProfile extends MbcProfile {
  score: number
  reasons: string[]
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
  if (Number.isFinite(refreshed) && now.getTime() - refreshed <= FRESH_DAYS * 86_400_000) {
    score += SCORE_WEIGHTS.fresh
    reasons.push('Profil mis à jour il y a moins de 6 mois')
  }

  return { ...profile, score: Math.min(100, score), reasons }
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
