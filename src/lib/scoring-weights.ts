import { z } from 'zod'
import { SCALES, recommendationFor, scaleKeys, withBonus, type ActiveScale, type CriterionKey } from './match-scoring'
import { scoreBreakdown } from './score-breakdown'

// Poids personnels (demande du 2026-11-16) : chaque recruteur règle, depuis le pipeline d'une offre, les poids des
// critères des deux barèmes (matching et score final, ADR 0036) ; ce sont les siens, pas ceux de l'organisation. Ses
// scores sont recalculés à l'affichage d'après les jugements enregistrés (résumé en tête de la raison), sans nouvel
// appel d'IA. Plafonds des critères essentiels inchangés ; les traitements sans recruteur (e-mails automatiques, seuil
// de 65 du vivier général, sourcing des AO) gardent les poids par défaut. Pur, testé (scoring-weights.test.ts).
// 2026-11-19 (ADR 0049) : ces poids sont ses poids globaux ; il peut aussi régler ceux du matching d'une offre (colonne
// de droite de son Matching IA), puis ceux d'un candidat pour cette offre (Matching IA et pipeline) : poids du candidat,
// sinon de l'offre, sinon globaux, sinon par défaut (withOverride).

export type ScaleWeights = Partial<Record<CriterionKey, number>>
export type RecruiterWeights = Record<ActiveScale, ScaleWeights>

export const DEFAULT_WEIGHTS: RecruiterWeights = { matching: { ...SCALES.matching.weights }, final: { ...SCALES.final.weights } }

/** Poids d'un barème : un entier de 0 à 100 pour chacun de ses critères, rien d'autre, total 100. */
const scaleSchema = (scale: ActiveScale) => z.strictObject(
  Object.fromEntries(scaleKeys(scale).map(key => [key, z.number().int().min(0).max(100)])),
).refine(w => Object.values(w).reduce((sum, v) => sum + v, 0) === 100, 'Le total doit faire 100 points.')

/** Poids d'un barème envoyés par le navigateur à l'enregistrement (un barème par page) : refusés s'ils ne sont pas valides. */
export const ScaleWeightsSchemas = { matching: scaleSchema('matching'), final: scaleSchema('final') }

/** Poids lus dans les préférences du compte (que l'utilisateur peut écrire) : un barème absent ou invalide garde ses poids par défaut. */
export function parseRecruiterWeights(raw: unknown): RecruiterWeights {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const read = (scale: ActiveScale): ScaleWeights => {
    const parsed = scaleSchema(scale).safeParse(obj[scale])
    return parsed.success ? parsed.data : DEFAULT_WEIGHTS[scale]
  }
  return { matching: read('matching'), final: read('final') }
}

/**
 * Score affiché à un recruteur : recalculé avec ses poids d'après le résumé des jugements, plus l'écart du score
 * enregistré (recommandations, même règle de seuil : withBonus), l'écart étant mesuré aux poids qui ont donné le score
 * enregistré (version notée dans le résumé, ADR 0049). Sans résumé lisible ou barème d'avant le 2026-11-15 : le score
 * enregistré. Aux poids de sa version : le score enregistré ; un score enregistré aux poids v1 est donc affiché aux poids
 * actuels, alors que les seuils qui lisent les scores enregistrés (65, e-mails à 70) le comparent tel quel jusqu'à son
 * prochain calcul.
 */
export function personalScore(stored: number, reason: string, weights: RecruiterWeights): number {
  const own = scoreBreakdown(reason, weights)
  const base = scoreBreakdown(reason)
  if (!own || !base || own.scale === 'legacy') return stored
  return withBonus(own.score, stored - base.score)
}

/**
 * Poids qui remplacent ceux du niveau au-dessus, barème par barème (ADR 0049) : ceux d'une offre (matching seulement)
 * ou d'un candidat pour une offre (le barème de son score : matching au Matching IA, score final au pipeline).
 */
export type WeightsOverride = Partial<RecruiterWeights>

/**
 * Poids remplaçants enregistrés (JSON gardé par le serveur, déjà validé) ; un barème qui n'est plus valide (critère
 * ajouté ou retiré depuis) est ignoré : le niveau au-dessus s'applique. null si aucun barème n'est lisible.
 */
export function parseWeightsOverride(raw: unknown): WeightsOverride | null {
  if (typeof raw !== 'string') return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null // JSON illisible : traité comme des poids invalides (l'appelant le journalise)
  }
  if (!obj || typeof obj !== 'object') return null
  const out: WeightsOverride = {}
  for (const scale of ['matching', 'final'] as const) {
    const parsed = ScaleWeightsSchemas[scale].safeParse((obj as Record<string, unknown>)[scale])
    if (parsed.success) out[scale] = parsed.data
  }
  return out.matching || out.final ? out : null
}

/** Poids `base` où `override` en donne d'autres, barème par barème : offre, sinon globaux ; candidat, sinon offre. */
export const withOverride = (base: RecruiterWeights, override?: WeightsOverride | null): RecruiterWeights =>
  ({ matching: override?.matching ?? base.matching, final: override?.final ?? base.final })

/** Poids remplaçants après l'enregistrement d'un barème (`weights` null : le retire) ; null s'il n'en reste aucun. */
export function mergeOverride(current: WeightsOverride | null | undefined, scale: ActiveScale, weights: ScaleWeights | null): WeightsOverride | null {
  const next: WeightsOverride = { ...current }
  if (weights) next[scale] = weights
  else delete next[scale]
  return next.matching || next.final ? next : null
}

/** Candidat tel que le Matching IA et le pipeline le désignent. */
export interface WeightedCandidate { source: 'pool' | 'vivier' | 'application'; id: string; candidateId?: string }

/**
 * Clé des poids d'un candidat pour une offre : sa candidature (`a:`, la même au Matching IA et au pipeline), le candidat
 * de la base (`p:`, son profil : la ligne du matching change d'identifiant à chaque calcul) ou le CV du vivier (`v:`).
 */
export function candidateWeightsKey(c: WeightedCandidate): string {
  if (c.source === 'application') return `a:${c.id}`
  if (c.source === 'pool') return `p:${c.candidateId ?? c.id}`
  return `v:${c.id}`
}

const CANDIDATE_KEY = /^[apv]:[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
/** Clé reçue du navigateur : une des formes de candidateWeightsKey, identifiant Appwrite compris. */
export const isCandidateWeightsKey = (key: unknown): key is string => typeof key === 'string' && CANDIDATE_KEY.test(key)

/**
 * Score et avis de l'IA affichés pour une candidature : le score aux poids qui s'appliquent pour ce recruteur (personalScore),
 * l'avis enregistré tant que le score est celui enregistré, sinon l'avis qui correspond au nouveau score.
 */
export function displayedScreening(stored: number, summary: string, storedRecommendation: string | undefined, weights: RecruiterWeights): { score: number; recommendation?: string } {
  const score = personalScore(stored, summary, weights)
  return { score, recommendation: score !== stored ? recommendationFor(score) : storedRecommendation }
}

/**
 * Scores d'une liste (Matching IA) aux poids du recruteur : ceux de chaque candidat s'il en a (clé candidateWeightsKey),
 * sinon `weights` (offre, globaux, défaut). Ordre inchangé ; un score absent le reste.
 */
export function rescoreForRecruiter<M extends WeightedCandidate & { score: number | null; reason: string }>(
  rows: M[], weights: RecruiterWeights, candidates: Record<string, WeightsOverride>,
): M[] {
  return rows.map(m => (m.score === null ? m : { ...m, score: personalScore(m.score, m.reason, withOverride(weights, candidates[candidateWeightsKey(m)])) }))
}
