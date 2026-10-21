import Anthropic from '@anthropic-ai/sdk'
import { LLMChainError, LLMHttpError, LLMNotConfiguredError, LLMUnreachableError } from '@/lib/ai/llm-router'

// Échecs des services d'IA « gratuits à réessayer » : la requête a été refusée avant tout traitement, donc
// rien n'a été facturé. Deux familles :
// - le compte ou la configuration (crédits épuisés, clé refusée, modèle inconnu, non configuré) : il faut un
//   autre service (repli) ou l'action d'un admin ;
// - une panne du service (saturé 429/529, erreur 5xx, injoignable) : il suffit d'attendre.
// Un e-mail qui échoue ainsi est repris à chaque synchronisation sans user sa reprise. Un délai dépassé ou une
// réponse illisible, eux, ont pu être facturés : ils suivent la règle normale (une seule reprise), pour qu'un
// e-mail qui fait toujours échouer l'IA ne soit pas refacturé indéfiniment. Règles pures, testées dans ao.test.ts.

export type AiProblem = 'credits' | 'access' | 'model' | 'config' | 'outage'

export const AI_PROBLEM_LABEL: Record<AiProblem, string> = {
  credits: 'crédits épuisés',
  access: 'clé refusée',
  model: 'modèle introuvable ou non autorisé',
  config: 'non configuré dans Config IA',
  outage: 'service saturé ou indisponible',
}

/** Échec gratuit d'un appel au SDK Anthropic ; null pour toute autre erreur. */
export function claudeProblem(err: unknown): AiProblem | null {
  if (!(err instanceof Anthropic.APIError)) return null
  // Délai dépassé (SDK ou notre signal d'abandon) : la requête a pu être traitée, donc facturée.
  if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError) return null
  // Connexion impossible : la requête n'est pas arrivée.
  if (err instanceof Anthropic.APIConnectionError) return 'outage'
  if (err.status === 402 || err.type === 'billing_error') return 'credits'
  // Crédits épuisés signalés par l'API sous la forme d'une erreur 400 ordinaire (invalid_request_error).
  if (err.status === 400 && /credit balance/i.test(err.message)) return 'credits'
  if (err.status === 401 || err.status === 403) return 'access'
  if (err.status === 404) return 'model'
  // 504 : délai dépassé d'une passerelle, la requête a pu aboutir.
  if (err.status === 429 || (err.status !== undefined && err.status >= 500 && err.status !== 504)) return 'outage'
  return null
}

/** Code d'erreur d'une réponse JSON d'API compatible OpenAI (`{"error":{"code"|"type": …}}`) ; null si ce n'en est pas une. */
function openAiErrorCode(body: string): string | null {
  try {
    const error = (JSON.parse(body) as { error?: { code?: unknown; type?: unknown } } | null)?.error
    if (!error || typeof error !== 'object') return null
    return typeof error.code === 'string' ? error.code : typeof error.type === 'string' ? error.type : ''
  } catch {
    return null // page HTML d'un proxy ou d'un pare-feu : pas une réponse de l'API
  }
}

/**
 * Échec gratuit d'une API compatible OpenAI (OpenAI, OpenRouter, TeckiA…) ; null sinon. Un refus du compte
 * (401/403/404) ne compte que dans une réponse d'erreur JSON de l'API : un pare-feu qui bloque un contenu
 * (page HTML) ne doit pas faire réessayer un e-mail indéfiniment.
 */
export function openAiProblem(status: number, body: string): AiProblem | null {
  if (status === 402) return 'credits'
  const code = openAiErrorCode(body)
  // OpenAI répond 429 aussi bien pour un quota épuisé que pour un débit trop élevé : seul le code les distingue.
  if (status === 429) return code === 'insufficient_quota' ? 'credits' : 'outage'
  // 504 : délai dépassé d'une passerelle, la requête a pu aboutir.
  if (status === 500 || status === 502 || status === 503 || status === 529) return 'outage'
  if (code === null) return null
  if (status === 401 || status === 403) return 'access'
  if (status === 404) return 'model'
  return null
}

/** Échec gratuit d'un modèle appelé par callLLM (llm-router.ts) ; null sinon. */
function llmProblem(err: unknown): AiProblem | null {
  if (err instanceof LLMHttpError) return openAiProblem(err.status, err.body)
  if (err instanceof LLMUnreachableError) return err.timedOut ? null : 'outage'
  if (err instanceof LLMNotConfiguredError) return 'config'
  return claudeProblem(err)
}

/** Libellé d'un échec gratuit, avec le statut HTTP d'une panne (« service saturé ou indisponible (529) »). */
export function describeAiProblem(problem: AiProblem, err: unknown): string {
  const status = err instanceof Anthropic.APIError ? err.status : err instanceof LLMHttpError ? err.status : undefined
  return problem === 'outage' && status ? `${AI_PROBLEM_LABEL[problem]} (${status})` : AI_PROBLEM_LABEL[problem]
}

/**
 * Cause d'attente quand callLLM a échoué et que TOUS les modèles essayés ont échoué gratuitement
 * (« claude : crédits épuisés ; gpt4o : service saturé ou indisponible (503) ») ; null si au moins un échec a
 * pu être facturé (délai dépassé, réponse illisible…) : l'e-mail suit alors la règle normale des essais.
 */
export function llmUnavailableReason(err: unknown): string | null {
  const failures = err instanceof LLMChainError ? err.failures : [{ provider: 'modèle de Config IA', error: err }]
  const problems = failures.map(f => llmProblem(f.error))
  if (!problems.length || problems.some(p => p === null)) return null
  return failures.map((f, i) => `${f.provider} : ${describeAiProblem(problems[i] as AiProblem, f.error)}`).join(' ; ')
}
