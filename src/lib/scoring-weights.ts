import { z } from 'zod'
import { SCALES, scaleKeys, withBonus, type ActiveScale, type CriterionKey } from './match-scoring'
import { scoreBreakdown } from './score-breakdown'

// Poids personnels (demande du 2026-11-16) : chaque recruteur règle, depuis le pipeline d'une offre, les poids des
// critères des deux barèmes (matching et score final, ADR 0036) ; ce sont les siens, pas ceux de l'organisation. Ses
// scores sont recalculés à l'affichage d'après les jugements enregistrés (résumé en tête de la raison), sans nouvel
// appel d'IA. Plafonds des critères essentiels inchangés ; les traitements sans recruteur (e-mails automatiques, seuil
// de 65 du vivier général, sourcing des AO) gardent les poids par défaut. Pur, testé (scoring-weights.test.ts).

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
 * enregistré (recommandations, même règle de seuil : withBonus). Sans résumé lisible ou barème d'avant le 2026-11-15 :
 * le score enregistré. Avec les poids par défaut, le score enregistré.
 */
export function personalScore(stored: number, reason: string, weights: RecruiterWeights): number {
  const own = scoreBreakdown(reason, weights)
  const base = scoreBreakdown(reason)
  if (!own || !base || own.scale === 'legacy') return stored
  return withBonus(own.score, stored - base.score)
}
