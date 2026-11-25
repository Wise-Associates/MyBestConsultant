import { createHash } from 'node:crypto'
import { LLMChainError, callLLM } from '@/lib/ai/llm-router'
import { CLASSIFICATION_AI, CLASSIFIER_MODELS } from '@/lib/ai/models'
import { llmFailureDetail } from '@/lib/ao/ai-failures'
import { JOB_CLASSIFICATION_SYSTEM, jobClassificationRequest, parseJobClassification, type JobClassification } from '@/lib/job-classification'

// Classement d'une offre au moment du matching (ADR 0061) : même modèle que la classification des CV (ligne
// « Classification des CV » de Config IA, Claude Haiku, effort bas, repli habituel). Rien n'est enregistré : le
// classement est gardé en mémoire du processus, par texte de l'offre, une heure (« Rafraîchir » fait deux passages de
// matching de suite ; une offre modifiée a un autre texte, donc un nouveau classement).

const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_MAX = 500
const cache = new Map<string, { until: number; value: JobClassification }>()

type OfferToClassify = Parameters<typeof jobClassificationRequest>[0]

/**
 * Famille, secteurs et métiers de l'offre ; null si le modèle ne répond pas ou mal (journalisé) : le préfiltre fait alors
 * comme avant, sans eux. Ne lève jamais.
 */
export async function classifyOffer(offer: OfferToClassify): Promise<JobClassification | null> {
  const request = jobClassificationRequest(offer)
  const key = createHash('sha256').update(request).digest('hex')
  const hit = cache.get(key)
  if (hit && Date.now() < hit.until) return hit.value
  try {
    const { content } = await callLLM([{ role: 'user', content: request }], JOB_CLASSIFICATION_SYSTEM, {
      ...CLASSIFICATION_AI, providerModels: CLASSIFIER_MODELS, maxTokens: 2000, timeoutMs: 30_000, effort: 'low',
    })
    const value = parseJobClassification(content)
    if (!value) {
      console.error('[classification] réponse illisible pour une offre : préfiltre sans famille ni secteur')
      return null
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string) // le plus ancien
    cache.set(key, { until: Date.now() + CACHE_TTL_MS, value })
    return value
  } catch (err) {
    console.error('[classification] offre non classée : préfiltre sans famille ni secteur', (err instanceof LLMChainError ? llmFailureDetail(err) : err instanceof Error ? err.message : String(err)).slice(0, 400))
    return null
  }
}
