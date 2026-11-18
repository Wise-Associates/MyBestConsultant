import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ActiveScale, MatchJudgements, ScoringNotes } from './match-scoring'

// Cache des notations d'un CV pour une offre (ADR 0044, phase 1) : une notation déjà faite pour exactement le même texte
// (consignes, offre, CV) et le même modèle n'est pas refaite. Règles pures, testées dans score-cache.test.ts ; lecture et
// écriture : src/lib/appwrite/score-cache.ts.

/** À changer quand la forme d'une notation gardée change : les anciennes ne sont plus lues. */
export const SCORE_CACHE_VERSION = 1
/** Durée de vie d'une notation gardée : elle contient des citations du CV (données personnelles). */
export const SCORE_CACHE_TTL_DAYS = 30
/** Taille de l'attribut `result` (appwrite.config.json) ; une notation plus longue n'est pas gardée. */
export const SCORE_CACHE_MAX_CHARS = 60_000

/** Ce qui détermine une notation : le modèle (fournisseur:modèle), le barème, et les textes envoyés tels quels. */
export interface ScoreCacheInput { model: string; scale: ActiveScale; system: string; user: string }

/** Identifiant du document (36 caractères au plus) : empreinte de tout ce qui détermine la notation. */
export function scoreCacheId(input: ScoreCacheInput): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([SCORE_CACHE_VERSION, input.model, input.scale, input.system, input.user]))
    .digest('hex')
  return `sc${digest.slice(0, 34)}`
}

/** Notation gardée : ce que cvScorer renvoie, sans les listes de l'offre (recalculées, identiques par construction). */
export interface CachedScore {
  score: number
  reason: string
  judgements: MatchJudgements
  notes: ScoringNotes
  provider: string
  answer: unknown
}

const judgement = z.enum(['oui', 'partiel', 'non'])
// Données écrites par le serveur lui-même ; relues avec les seules vérifications qui évitent de planter un appelant.
const cachedSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string(),
  judgements: z.looseObject({
    scale: z.enum(['matching', 'final']),
    roles: z.array(z.looseObject({ title: z.string() })),
    requirements: z.array(judgement),
    skills: z.array(judgement),
    fits: z.record(z.string(), z.unknown()),
  }),
  notes: z.object({
    reason: z.string(), summary: z.string(), strengths: z.array(z.string()), concerns: z.array(z.string()),
    namedSkills: z.array(z.object({ name: z.string(), match: judgement })),
  }),
  provider: z.string(),
  answer: z.unknown(),
})

/** Texte à enregistrer ; null si la notation est trop longue pour l'attribut. */
export function serializeCachedScore(entry: CachedScore): string | null {
  const text = JSON.stringify(entry)
  return text.length <= SCORE_CACHE_MAX_CHARS ? text : null
}

/** Notation relue pour ce barème ; null si elle est illisible ou d'un autre barème (traitée comme absente). */
export function parseCachedScore(raw: unknown, scale: ActiveScale): CachedScore | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = cachedSchema.safeParse(JSON.parse(raw))
    if (!parsed.success || parsed.data.judgements.scale !== scale) return null
    return parsed.data as unknown as CachedScore
  } catch {
    return null // valeur abîmée : la notation est refaite
  }
}

/** Notation gardée depuis moins de SCORE_CACHE_TTL_DAYS jours. */
export function isFreshScore(createdAt: string, now: Date): boolean {
  const at = Date.parse(createdAt)
  return Number.isFinite(at) && now.getTime() - at < SCORE_CACHE_TTL_DAYS * 86_400_000
}

/** Date avant laquelle une notation gardée est à effacer. */
export const scoreCacheCutoff = (now: Date) => new Date(now.getTime() - SCORE_CACHE_TTL_DAYS * 86_400_000).toISOString()
