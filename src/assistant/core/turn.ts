// Points d'entrée du module assistant, appelés par les actions serveur du site. Chacun vérifie lui-même
// l'utilisateur auprès du site (AssistantHost.getUser) : un site ne peut pas oublier ce contrôle.

import { z } from 'zod'
import {
  DISPLAY_TURNS, HISTORY_TURNS, buildSystemPrompt, cleanAnswer, isConversationId, parseUserMessage, transcriptForSupport, trimHistory,
} from './rules'
import type { AssistantHost, ChatMessage } from './types'

export type AssistantErrorCode = 'unauthorized' | 'invalid' | 'not_found' | 'quota' | 'unavailable' | 'refused'
export type AssistantError = { ok: false; code: AssistantErrorCode; error: string }

/**
 * `saved: false` : la réponse n'a pas pu être enregistrée. Elle s'affiche quand même (le modèle a déjà répondu, donc
 * facturé), sans pouvoir être reprise ni transmise ; `conversationId` est alors null pour une nouvelle conversation.
 */
export type TurnResult = { ok: true; conversationId: string | null; answer: string; saved: boolean } | AssistantError
export type LatestResult = { ok: true; conversation: { conversationId: string; messages: ChatMessage[] } | null } | AssistantError
export type HandoffOutcome = { ok: true; url: string } | AssistantError

const fail = (code: AssistantErrorCode, error: string): AssistantError => ({ ok: false, code, error })

export const ASSISTANT_ERRORS = {
  unauthorized: fail('unauthorized', 'Connectez-vous pour utiliser l’assistant.'),
  notFound: fail('not_found', 'Cette conversation est introuvable. Commencez-en une nouvelle.'),
  userQuota: fail('quota', 'Vous avez atteint le nombre de messages autorisés aujourd’hui. Réessayez demain, ou contactez le support.'),
  siteQuota: fail('quota', 'L’assistant a atteint sa limite de messages pour aujourd’hui. Réessayez demain, ou contactez le support.'),
  unavailable: fail('unavailable', 'L’assistant ne peut pas répondre pour le moment. Réessayez plus tard, ou contactez le support.'),
  noAnswer: fail('unavailable', 'L’assistant n’a pas su répondre à cette question. Reformulez-la, ou contactez le support.'),
} as const

// conversationId : null pour une nouvelle conversation (absent = saisie invalide). Le texte est vérifié par
// parseUserMessage ; la borne ici évite seulement de traiter un envoi démesuré.
const TurnInput = z.object({
  conversationId: z.string().refine(isConversationId).nullable(),
  text: z.string().max(20_000),
})

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 500)

/** Envoie un message : vérifie l'utilisateur, la saisie, la conversation et le quota, appelle le modèle, enregistre l'échange. */
export async function runTurn(host: AssistantHost, rawInput: unknown, now: Date): Promise<TurnResult> {
  const user = await host.getUser()
  if (!user) return ASSISTANT_ERRORS.unauthorized
  const input = TurnInput.safeParse(rawInput)
  if (!input.success) return fail('invalid', 'Message invalide.')
  const message = parseUserMessage(input.data.text)
  if (!message.ok) return fail('invalid', message.error)

  // Une conversation est toujours relue avec l'identifiant de l'utilisateur : celle d'un autre est « introuvable ».
  let conversationId = input.data.conversationId
  let history: ChatMessage[] = []
  if (conversationId) {
    history = await host.store.list(user.id, conversationId, HISTORY_TURNS)
    if (history.length === 0) return ASSISTANT_ERRORS.notFound
  } else {
    conversationId = host.store.newId()
  }
  const quota = await host.takeQuota(user, now)
  if (quota !== 'ok') return quota === 'site-limit' ? ASSISTANT_ERRORS.siteQuota : ASSISTANT_ERRORS.userQuota

  const system = buildSystemPrompt(host.siteName, host.knowledge(user))
  let reply: { text: string; provider: string }
  try {
    reply = await host.complete(system, [...trimHistory(history), { role: 'user', content: message.text }])
  } catch (err) {
    // Panne, crédits épuisés, délai dépassé… : la cause va dans les journaux, jamais le texte de l'utilisateur.
    // Le quota pris n'est pas rendu (limite connue, ADR 0007) : il borne aussi les essais répétés pendant une panne.
    console.error('[assistant] appel au modèle en échec', errorText(err))
    return ASSISTANT_ERRORS.unavailable
  }
  const answer = cleanAnswer(reply.text)
  if (!answer) {
    // Refus du modèle ou réponse vide : la même question donnerait le même résultat, d'où « reformulez ».
    console.error('[assistant] réponse vide du modèle', reply.provider)
    return ASSISTANT_ERRORS.noAnswer
  }
  // Enregistré seulement après la réponse : une question sans réponse ne reste jamais en base.
  try {
    await host.store.append(user, conversationId, message.text, answer, reply.provider)
  } catch (err) {
    console.error('[assistant] réponse du modèle non enregistrée', reply.provider, errorText(err))
    return { ok: true, conversationId: input.data.conversationId, answer, saved: false }
  }
  return { ok: true, conversationId, answer, saved: true }
}

/** Dernière conversation de l'utilisateur, pour la réafficher à l'ouverture de l'assistant. */
export async function loadLatest(host: AssistantHost): Promise<LatestResult> {
  const user = await host.getUser()
  if (!user) return ASSISTANT_ERRORS.unauthorized
  return { ok: true, conversation: await host.store.latest(user.id, DISPLAY_TURNS) }
}

/** Transmet une conversation de l'utilisateur à une personne (ticket de support…), à sa demande. */
export async function handoffToSupport(host: AssistantHost, rawConversationId: unknown): Promise<HandoffOutcome> {
  const user = await host.getUser()
  if (!user) return ASSISTANT_ERRORS.unauthorized
  if (!isConversationId(rawConversationId)) return fail('invalid', 'Conversation invalide.')
  const messages = await host.store.list(user.id, rawConversationId, DISPLAY_TURNS)
  if (messages.length === 0) return ASSISTANT_ERRORS.notFound
  const result = await host.handoff(user, transcriptForSupport(messages, host.siteName))
  return result.ok ? result : fail('refused', result.error)
}
