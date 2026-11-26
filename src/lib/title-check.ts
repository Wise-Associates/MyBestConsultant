import { callLLM } from '@/lib/ai/llm-router'
import { SCORING_AI } from '@/lib/ai/models'
import type { UsageContext } from '@/lib/ai/usage'
import {
  parseTitleRelations, rolePairs, titleCheckPrompt, withTitleRelations, type MatchJudgements, type TitleRelation,
} from '@/lib/match-scoring'

// Comparaison des intitulés (match-scoring.ts, ADR 0028) : une seule question à l'IA pour toutes les paires « métier du
// titre de l'offre / intitulé du CV » d'une notation (un CV, ou un CV et plusieurs offres du vivier général).

/**
 * Jugements dont les métiers du titre sont confirmés par la comparaison des intitulés, dans l'ordre de `judged` (barème
 * ou critères d'une offre, criteria-scoring.ts : seuls les métiers comptent).
 * Comparaison impossible (IA indisponible, réponse illisible) : journalisée, métiers gardés à « partiel » au plus.
 * `usage` : fonction et organisation de la notation, pour le journal de consommation de l'IA (ADR 0064).
 */
export async function withCheckedTitles<J extends Pick<MatchJudgements, 'roles'>>(judged: J[], usage: UsageContext): Promise<J[]> {
  const pairsPerJudgement = judged.map(rolePairs)
  const pairs = pairsPerJudgement.flat()
  let relations: (TitleRelation | null)[] = pairs.map(() => null)
  if (pairs.length > 0) {
    try {
      const { system, user } = titleCheckPrompt(pairs)
      const { content } = await callLLM([{ role: 'user', content: user }], system, { ...SCORING_AI, maxTokens: 2000, timeoutMs: 120_000, usage })
      relations = parseTitleRelations(content, pairs.length)
      if (relations.some(r => r === null)) console.warn('[matching] comparaison des intitulés incomplète : métiers concernés à « partiel » au plus')
    } catch (e) {
      console.error('[matching] comparaison des intitulés en échec : métiers à « partiel » au plus', e instanceof Error ? e.message : e)
    }
  }
  let offset = 0
  return judged.map((j, i) => {
    const count = pairsPerJudgement[i].length
    const own = relations.slice(offset, offset + count)
    offset += count
    return withTitleRelations(j, own)
  })
}
