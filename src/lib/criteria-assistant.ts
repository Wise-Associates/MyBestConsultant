import { callLLM } from '@/lib/ai/llm-router'
import { SCORING_AI } from '@/lib/ai/models'
import { llmUnavailableReason } from '@/lib/ao/ai-failures'
import type { AoForCriteria } from '@/lib/ao/criteria-proposal'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { CRITERIA_REVISION_PROMPT, RevisionInputSchema, criteriaRevisionRequest, parseCriteriaRevision, type RevisionInput, type RevisionResult } from '@/lib/criteria-revision'
import { statsFilter } from '@/lib/search/cv-stats'
import { isSearchConfigured, roleCounts } from '@/lib/search/meili'
import { TitleSuggestionInputSchema, titleSuggestions, type TitleSuggestionsResult } from '@/lib/search/related-titles'
import { cleanTitle } from '@/lib/search/cv-search'

// Serveur de l'assistant des critères et des autres intitulés proposés (ADR 0062), appelé par les Server Actions des
// pages qui montrent les critères (AO avant publication, Matching IA d'une offre) après leurs propres contrôles d'accès.
// Règles pures : criteria-revision.ts, search/related-titles.ts.

/** Demandes à l'assistant par jour (UTC) : par organisation, pour toutes. Une demande = un appel à l'IA de la notation. */
export const CRITERIA_CHAT_DAILY_LIMITS = { perOrganisation: 60, allOrganisations: 600 } as const

export type { RevisionResult }

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Place du quota du jour pour une demande d'un recruteur (adresse e-mail vérifiée exigée : l'inscription est libre) ;
 * le message du refus, null si la place est prise. Une demande dont l'IA échoue compte quand même (elle a pu être
 * facturée), comme les messages de l'assistant IA.
 */
export async function takeCriteriaChatSlot(emailVerified: boolean, tenantId: string, now = new Date()): Promise<string | null> {
  if (!emailVerified) return 'Vérifiez votre adresse e-mail (lien reçu à l’inscription) pour utiliser l’assistant des critères.'
  const own = await takeDailySlotId('criteriaChatOrg', tenantId, now, CRITERIA_CHAT_DAILY_LIMITS.perOrganisation)
  if (!own) return `Limite de ${CRITERIA_CHAT_DAILY_LIMITS.perOrganisation} demandes à l’assistant des critères par jour atteinte pour votre organisation : modifiez les critères à la main, ou réessayez demain.`
  if (!(await takeDailySlotId('criteriaChatAll', 'platform', now, CRITERIA_CHAT_DAILY_LIMITS.allOrganisations))) {
    console.warn('[critères] plafond quotidien des demandes à l\'assistant des critères atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return 'Trop de demandes à l’assistant des critères aujourd’hui sur la plateforme : modifiez les critères à la main, ou réessayez demain.'
  }
  return null
}

/** Demande du navigateur validée (critères, texte, échange), avant toute place de quota ; sinon le message à montrer. */
export function readRevisionInput(input: unknown): { input: RevisionInput } | { error: string } {
  const parsed = RevisionInputSchema.safeParse(input)
  return parsed.success ? { input: parsed.data } : { error: parsed.error.issues[0]?.message ?? 'Demande invalide.' }
}

/**
 * Critères modifiés par l'IA de la notation (« Matching IA » de Config IA) selon la demande du recruteur, pour `offer`
 * (texte que voient ceux qui ouvrent l'offre : AO aux noms du client remplacés). Rien n'est enregistré.
 */
export async function reviseCriteria(offer: AoForCriteria, input: RevisionInput, offerId: string): Promise<RevisionResult> {
  try {
    // 6 000 jetons : la réflexion de Claude (adaptative) compte dans la limite ; des critères complets en font 1 500 environ.
    const { content } = await callLLM([{ role: 'user', content: criteriaRevisionRequest(offer, input) }], CRITERIA_REVISION_PROMPT, {
      ...SCORING_AI, maxTokens: 6000, timeoutMs: 60_000,
    })
    const revised = parseCriteriaRevision(content, input.criteria)
    if (!revised) {
      console.error('[critères] réponse de l\'assistant illisible', offerId)
      return { error: 'L’assistant n’a pas su modifier les critères : reformulez votre demande, ou modifiez-les à la main.' }
    }
    return revised
  } catch (err) {
    // Le détail (réponse brute du fournisseur) reste dans les journaux ; ni la demande ni l'offre n'y sont écrites.
    console.error('[critères] assistant des critères indisponible', offerId, message(err))
    return { error: `Assistant indisponible (${llmUnavailableReason(err) ?? 'service d’IA indisponible pour le moment'}) : modifiez les critères à la main, ou réessayez.` }
  }
}

/** Périmètre des CV comptés : toute la plateforme (admin), ou la base candidats et le vivier personnel du recruteur. */
export type TitleScope = { kind: 'platform' } | { kind: 'recruiter'; tenantId: string; ownerId: string }

function scopeFilter(scope: TitleScope): string {
  // Sans identifiant à vérifier, statsFilter rend toujours un filtre.
  if (scope.kind === 'platform') return statsFilter({ kind: 'platform' }) as string
  const pool = statsFilter({ kind: 'pool' }) as string
  const vivier = statsFilter({ kind: 'vivier', tenantId: scope.tenantId, ownerId: scope.ownerId })
  return vivier ? `(${pool}) OR (${vivier})` : pool
}

/**
 * Autres intitulés proposés pour le métier de l'offre (sans IA ni quota) : dictionnaire, puis métiers des CV de
 * `scope` ; sans index joignable, le dictionnaire seul et une note.
 */
export async function suggestTitles(input: unknown, scope: TitleScope): Promise<TitleSuggestionsResult> {
  const parsed = TitleSuggestionInputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Intitulé invalide.' }
  const { title, exclude } = parsed.data
  if (!isSearchConfigured()) return { titles: titleSuggestions(title, null, exclude) }
  try {
    return { titles: titleSuggestions(title, await roleCounts(cleanTitle(title), scopeFilter(scope)), exclude) }
  } catch (err) {
    console.error('[critères] métiers des CV non lus pour les autres intitulés', message(err))
    return { titles: titleSuggestions(title, null, exclude), note: 'Intitulés des CV indisponibles pour le moment : seuls ceux du dictionnaire sont proposés.' }
  }
}
