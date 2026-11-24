import { z } from 'zod'
import { CRITERION_LABELS, MAX_ROLES, SCALES, offerRequirements, requiredSkills, type CriterionKey } from './match-scoring'
import { cleanTitle } from './search/cv-search'

// Critères de matching d'une offre (demande du 2026-11-24, ADR 0061) : avant de publier un appel d'offres, la personne
// qui publie règle les critères sur lesquels les CV seront notés. Les dix critères du barème « matching » (ADR 0036) en
// sont le point de départ ; on peut en retirer et en ajouter (« Expérience bancaire »). Chaque critère a un poids (total
// exactement 100) et des libellés, chacun avec son poids dans le critère (total exactement 100) : pour un poste « Java
// Angular », Java 70 et Angular 30. Un libellé marqué « requis » (★) plafonne le score sous 65 quand il manque, et sert
// de filtre avant l'IA. Ces critères sont la pondération générale de l'offre, avant celle de chaque recruteur.
// Seuls les libellés sont envoyés à l'IA, jamais les poids ni « requis » : changer un poids ou un ★ recalcule les scores
// d'après les jugements enregistrés, sans nouvel appel d'IA ; changer un libellé demande de nouveaux jugements
// (empreinte `criteriaFingerprint`). Pur, testé (offer-criteria.test.ts).

/** Format des critères enregistrés (`version`) : toute évolution incompatible en ajoute un. */
export const CRITERIA_SET_VERSION = 1

export const CRITERIA_LIMITS = {
  /** Critères d'une offre : les dix du barème plus quelques critères ajoutés. */
  criteria: 14,
  /** Libellés d'un critère (comme les compétences jugées une à une, MAX_REQUIRED_SKILLS). */
  labels: 12,
  /** Une exigence de la description tient en 160 caractères (offerRequirements) : gardée entière. */
  label: 160,
  name: 60,
  /** Autres intitulés du poste, pour la recherche des CV (pas jugés). */
  alternatives: 6,
} as const

/** Critères du barème « matching » qu'une offre peut garder, dans leur ordre. */
export const STANDARD_KEYS = Object.keys(SCALES.matching.weights) as CriterionKey[]
export type StandardKey = (typeof STANDARD_KEYS)[number]

/**
 * Critères « rouges » du barème à une seule valeur (lieu, séniorité, formation, secteur, langue) : sans libellé, leur
 * absence plafonne sous 65 (SCALES.matching.caps) ; avec des libellés, seul un libellé ★ plafonne. Leurs libellés sont
 * donc requis par défaut (critères par défaut et proposés par l'IA) : un lieu ajouté comme libellé ne doit pas lever le
 * plafond sans que la personne qui publie retire ★ (revue de code du 2026-11-24).
 */
export const REQUIRED_BY_DEFAULT = new Set<string>(['localisation', 'niveau', 'formation', 'domaine', 'langue'])

/** Taille de l'attribut qui garde les critères (`criteria`, `matchingCriteria` : appwrite.config.json). */
export const CRITERIA_MAX_CHARS = 20_000

export interface CriterionLabel {
  label: string
  /** Part du libellé dans son critère : entier de 1 à 100, total 100 dans le critère. */
  weight: number
  /** Indispensable : absent du parcours, il plafonne le score sous 65 ; filtre les CV avant l'IA. */
  required: boolean
}

export interface OfferCriterion {
  /** Clé du critère du barème (`poste`, `competences`…), ou `x1`… pour un critère ajouté. */
  id: string
  /** Nom affiché : celui du barème (CRITERION_LABELS), ou celui saisi pour un critère ajouté. */
  name: string
  /** Poids du critère : entier de 1 à 100, total 100 pour l'offre. */
  weight: number
  /** Ce que l'IA juge, un par un ; aucun : un jugement d'ensemble sur l'offre, comme avant. */
  labels: CriterionLabel[]
}

export interface OfferCriteriaSet {
  version: typeof CRITERIA_SET_VERSION
  criteria: OfferCriterion[]
  /** Autres intitulés du même métier (« Ingénieur Java » pour « Développeur Java ») : recherche des CV seulement. */
  alternativeTitles: string[]
}

const CUSTOM_ID = /^x\d{1,2}$/
export const isStandardKey = (id: string): id is StandardKey => (STANDARD_KEYS as string[]).includes(id)
export const isCustomId = (id: string) => CUSTOM_ID.test(id)

/**
 * Libellé ou nom tel qu'il est gardé : sans les séparateurs du résumé des jugements (« · », « : », « , », « — », retours
 * à la ligne), qui doit rester lisible et relu dans l'ordre (criteria-scoring.ts), espaces réduits, borné.
 */
export function cleanLabel(text: string, max: number = CRITERIA_LIMITS.label): string {
  return text.replace(/[·:,;—–|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)

const labelSchema = z.strictObject({
  label: z.string().transform(v => cleanLabel(v)).pipe(z.string().min(1, 'Un libellé est vide.')),
  weight: z.number().int().min(1).max(100),
  required: z.boolean(),
})

const criterionSchema = z.strictObject({
  id: z.string().refine(id => isStandardKey(id) || isCustomId(id), 'Critère inconnu.'),
  name: z.string().transform(v => cleanLabel(v, CRITERIA_LIMITS.name)),
  weight: z.number().int().min(1).max(100),
  labels: z.array(labelSchema).max(CRITERIA_LIMITS.labels),
}).transform(c => ({ ...c, name: isStandardKey(c.id) ? CRITERION_LABELS[c.id] : c.name }))
  .superRefine((c, ctx) => {
    if (!c.name) ctx.addIssue({ code: 'custom', message: 'Un critère ajouté doit avoir un nom.' })
    if (c.labels.length > 0 && sum(c.labels.map(l => l.weight)) !== 100) ctx.addIssue({ code: 'custom', message: `Les libellés de « ${c.name} » doivent totaliser 100.` })
    if (new Set(c.labels.map(l => l.label.toLowerCase())).size !== c.labels.length) ctx.addIssue({ code: 'custom', message: `« ${c.name} » a deux fois le même libellé.` })
    // Les métiers d'un poste sont jugés un par un avec leur intitulé dans le CV (parseRoles) : MAX_ROLES au plus.
    if (c.id === 'poste' && c.labels.length > MAX_ROLES) ctx.addIssue({ code: 'custom', message: `« Poste » : ${MAX_ROLES} métiers au plus.` })
  })

/**
 * Critères d'une offre, envoyés par le navigateur ou relus en base (donnée non fiable) : refusés s'ils ne sont pas
 * valides — jamais complétés ni corrigés en silence, un total faux ne doit pas devenir une autre pondération.
 */
export const CriteriaSetSchema = z.strictObject({
  version: z.literal(CRITERIA_SET_VERSION),
  criteria: z.array(criterionSchema).min(1, 'Gardez au moins un critère.').max(CRITERIA_LIMITS.criteria),
  alternativeTitles: z.array(z.string().transform(v => cleanLabel(v)).pipe(z.string().min(1))).max(CRITERIA_LIMITS.alternatives),
})
  .refine(s => sum(s.criteria.map(c => c.weight)) === 100, 'Les poids des critères doivent totaliser 100.')
  .refine(s => new Set(s.criteria.map(c => c.id)).size === s.criteria.length, 'Un critère figure deux fois.')
  .refine(s => JSON.stringify(s).length <= CRITERIA_MAX_CHARS, 'Critères trop longs : retirez des libellés ou raccourcissez-les.')

/** Premier message d'erreur d'une validation, pour l'utilisateur. */
export function criteriaSetProblem(raw: unknown): string | null {
  const parsed = CriteriaSetSchema.safeParse(raw)
  return parsed.success ? null : parsed.error.issues[0]?.message ?? 'Critères invalides.'
}

/** Critères enregistrés (JSON) relus : null si absents, illisibles ou invalides (l'appelant le journalise). */
export function parseCriteriaSet(raw: unknown): OfferCriteriaSet | null {
  if (typeof raw !== 'string' || !raw) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null // JSON illisible : comme des critères invalides
  }
  const parsed = CriteriaSetSchema.safeParse(obj)
  return parsed.success ? parsed.data : null
}

/**
 * `count` poids entiers dont le total fait `total`, proportionnels à `shares` (tous égaux sans `shares`) : la méthode
 * des plus forts restes, chaque poids valant au moins 1. Vide si `count` est 0.
 */
export function weightsSummingTo(count: number, total = 100, shares?: number[]): number[] {
  if (count <= 0) return []
  const raw = Array.from({ length: count }, (_, i) => Math.max(shares?.[i] ?? 1, 0))
  const parts = sum(raw) > 0 ? raw : raw.map(() => 1)
  // Chaque poids vaut au moins 1 : seul le reste est réparti selon les parts.
  const spare = total - count
  const exact = parts.map(v => (v / sum(parts)) * spare)
  const floors = exact.map(v => Math.floor(v))
  let left = spare - sum(floors)
  const order = exact.map((v, i) => ({ i, rest: v - floors[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return floors.map(v => v + 1)
}

/** Libellés de même poids (total 100), sans doublon ni vide, CRITERIA_LIMITS.labels au plus. */
export function evenLabels(texts: string[], required = false): CriterionLabel[] {
  const seen = new Set<string>()
  const labels = texts.map(t => cleanLabel(t)).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, CRITERIA_LIMITS.labels)
  const weights = weightsSummingTo(labels.length)
  return labels.map((label, i) => ({ label, weight: weights[i], required }))
}

/** Offre telle que les critères par défaut la lisent : publiée, ou appel d'offres pas encore publié. */
export interface OfferForCriteria {
  title: string
  description: string
  skills: string[]
  location?: string
}

/**
 * Critères par défaut d'une offre, sans IA : les dix critères du barème « matching » à leurs poids par défaut, le métier
 * du titre (requis), les compétences demandées et les exigences de la description comme libellés de même poids.
 */
export function defaultCriteriaSet(offer: OfferForCriteria): OfferCriteriaSet {
  const title = cleanTitle(offer.title)
  const labelsOf: Partial<Record<StandardKey, CriterionLabel[]>> = {
    poste: title ? evenLabels([title], true) : [],
    competences: evenLabels(requiredSkills(offer.skills)),
    exigences: evenLabels(offerRequirements(offer.description)),
    localisation: offer.location ? evenLabels([offer.location], true) : [],
  }
  return {
    version: CRITERIA_SET_VERSION,
    criteria: STANDARD_KEYS.map(key => ({
      id: key, name: CRITERION_LABELS[key], weight: SCALES.matching.weights[key] ?? 0, labels: labelsOf[key] ?? [],
    })),
    alternativeTitles: [],
  }
}

/** Identifiant libre pour un critère ajouté (`x1`, `x2`…). */
export function nextCustomId(set: Pick<OfferCriteriaSet, 'criteria'>): string {
  const used = new Set(set.criteria.map(c => c.id))
  for (let n = 1; n < 100; n++) if (!used.has(`x${n}`)) return `x${n}`
  return 'x99'
}

/**
 * Empreinte de ce que l'IA juge (critères, noms des critères ajoutés et libellés, dans l'ordre) : notée dans le résumé
 * de chaque score, elle dit si ses jugements valent pour les critères en vigueur (même empreinte : poids et ★ appliqués
 * sans IA) ou s'il faut noter de nouveau. FNV-1a 32 bits : un repère, pas une sécurité.
 */
export function criteriaFingerprint(set: Pick<OfferCriteriaSet, 'criteria'>): string {
  const text = set.criteria.map(c => [c.id, isCustomId(c.id) ? c.name.toLowerCase() : '', ...c.labels.map(l => l.label.toLowerCase())].join('\u0001')).join('\u0002')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Libellés requis (★) de toute l'offre : ceux qui filtrent les CV avant l'IA. */
export const requiredLabels = (set: OfferCriteriaSet, id?: string) =>
  set.criteria.filter(c => !id || c.id === id).flatMap(c => c.labels.filter(l => l.required).map(l => l.label))
