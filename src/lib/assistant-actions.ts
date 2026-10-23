'use server'

import { revalidatePath } from 'next/cache'
import {
  handoffToSupport, loadLatest, runTurn,
  type AssistantError, type HandoffOutcome, type LatestResult, type TurnResult,
} from '@/assistant/core/turn'
import { createAssistantHost, isAssistantEnabled } from '@/lib/assistant/host'

// Actions de l'assistant IA (espaces candidat et recruteur). Utilisateur, rôle, saisie et propriété de la
// conversation sont vérifiés par le module (src/assistant/core/turn.ts) à chaque appel ; ici : assistant désactivé,
// et pannes de la base traduites en erreur affichable propre à l'étape (la cause va dans les journaux).

const NOT_ENABLED: AssistantError = { ok: false, code: 'unavailable', error: 'L’assistant n’est pas disponible.' }

async function guard<T>(stage: string, failure: string, fn: () => Promise<T>): Promise<T | AssistantError> {
  if (!isAssistantEnabled()) return NOT_ENABLED
  try {
    return await fn()
  } catch (err) {
    console.error(`[assistant] ${stage} en échec`, err instanceof Error ? (err.stack ?? err.message).slice(0, 1500) : String(err))
    return { ok: false, code: 'unavailable', error: failure }
  }
}

export async function sendAssistantMessage(conversationId: string | null, text: string): Promise<TurnResult> {
  return guard('envoi', 'Votre message n’a pas pu être traité. Réessayez dans quelques minutes.',
    () => runTurn(createAssistantHost(), { conversationId, text }, new Date()))
}

export async function loadAssistantConversation(): Promise<LatestResult> {
  return guard('lecture', 'Impossible de charger la conversation. Réessayez dans quelques minutes.',
    () => loadLatest(createAssistantHost()))
}

export async function sendAssistantConversationToSupport(conversationId: string): Promise<HandoffOutcome> {
  return guard('transmission au support', 'La conversation n’a pas pu être transmise au support. Réessayez, ou écrivez-nous depuis la page Aide & support.', async () => {
    const res = await handoffToSupport(createAssistantHost(), conversationId)
    if (res.ok) { revalidatePath('/recruiter/support'); revalidatePath('/candidate/support'); revalidatePath('/admin/support') }
    return res
  })
}
