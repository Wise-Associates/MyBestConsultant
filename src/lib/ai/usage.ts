import { builtinPrice, costUsd, type Price, type TokenCounts } from './prices'

// Journal de consommation de l'IA (ADR 0064) : une ligne par essai d'un modèle (le modèle choisi, puis chaque repli),
// écrite dans les journaux du serveur et dans la collection `llm_usage`. Règles pures, testées : jamais le texte de la
// demande ou de la réponse, ni un identifiant de personne, ni un message d'erreur (il peut citer la demande).

/** Pour qui et pour quoi un appel est fait ; passé par chaque appelant de l'IA (`usage` de callLLM). */
export interface UsageContext {
  /** Fonction de l'application, en kebab-case (« cv-export-extract », « ao-extract », « scoring-matching »…). */
  feature?: string
  /**
   * Organisation pour laquelle l'appel est fait : celle du recruteur qui le déclenche, sinon celle de l'offre, de la boîte
   * ou du CV ; « admin » pour la plateforme ; absente (vide) pour un appel fait pour un candidat ou un visiteur.
   */
  tenantId?: string | null
}

export interface LlmUsageRecord {
  feature: string
  /** Ligne de Config IA (« matching », « cvExport »…) ; vide sans module. */
  module: string
  tenantId: string
  /** Fournisseur de Config IA : « claude », « gpt4o », « teckia » ou l'id d'un modèle open source (« os-… »). */
  provider: string
  model: string
  /** « ok », « http-<statut> », « timeout », « unreachable », « not-configured » ou « error ». */
  outcome: string
  /** 0 : le modèle choisi ; 1, 2… : les replis essayés ensuite. */
  attempt: number
  /** Jetons ; null quand le fournisseur ne les a pas donnés (échec, serveur qui ne les renvoie pas). */
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  durationMs: number
  /** Coût estimé en dollars ; null sans jetons ou sans prix connu (prices.ts). */
  costUsd: number | null
  /** Réponse coupée à la longueur maximale demandée. */
  truncated: boolean
}

const FEATURE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const clip = (value: string, max: number) => value.trim().slice(0, max)

/** Organisation d'une offre ou d'un document : vide = plateforme (« admin »), comme ailleurs dans l'application. */
export const organisationOf = (tenantId: string | null | undefined) => (tenantId?.trim() ? tenantId.trim() : 'admin')

/** Faits d'un essai, mesurés par l'appelant. */
export interface AttemptFacts {
  provider: string
  model: string
  attempt: number
  durationMs: number
  /** null : jetons inconnus. */
  tokens: TokenCounts | null
  truncated: boolean
  outcome: string
  price: Price | null
}

export function usageRecord(ctx: UsageContext | undefined, module: string | undefined, facts: AttemptFacts): LlmUsageRecord {
  const feature = ctx?.feature && ctx.feature.length <= 64 && FEATURE.test(ctx.feature) ? ctx.feature : module || 'unlabelled'
  const t = facts.tokens
  return {
    feature,
    module: module ?? '',
    tenantId: clip(ctx?.tenantId ?? '', 36),
    provider: clip(facts.provider, 64),
    model: clip(facts.model, 128),
    outcome: facts.outcome,
    attempt: facts.attempt,
    inputTokens: t ? t.inputTokens : null,
    outputTokens: t ? t.outputTokens : null,
    cacheReadTokens: t ? t.cacheReadTokens : null,
    cacheWriteTokens: t ? t.cacheWriteTokens : null,
    durationMs: Math.max(0, Math.round(facts.durationMs)),
    costUsd: t ? costUsd(t, facts.price) : null,
    truncated: facts.truncated,
  }
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'

/** Jetons d'une réponse de Claude (`usage`) : l'entrée y est déjà hors cache. */
export function claudeTokens(usage: unknown): TokenCounts | null {
  if (!isObject(usage) || typeof usage.input_tokens !== 'number') return null
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheReadTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: count(usage.cache_creation_input_tokens),
  }
}

/** Jetons d'une réponse compatible OpenAI (`usage`) : `prompt_tokens` compte les jetons lus dans le cache, retirés ici. */
export function openAiTokens(usage: unknown): TokenCounts | null {
  if (!isObject(usage) || typeof usage.prompt_tokens !== 'number') return null
  const details = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  const cached = count(details.cached_tokens)
  return {
    inputTokens: Math.max(0, count(usage.prompt_tokens) - cached),
    outputTokens: count(usage.completion_tokens),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
}

/** Jetons d'entrée de la demande, cache compris (palier de prix de Claude Haiku 5.5). */
export const promptTokens = (t: TokenCounts | null) => (t ? t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens : 0)

/**
 * Nature d'un échec, sans son message : statut HTTP (erreurs du routeur et du SDK d'Anthropic), délai dépassé, modèle
 * injoignable ou non configuré (erreurs du routeur, llm-router.ts), sinon « error ».
 */
export function outcomeOf(err: unknown): string {
  if (!isObject(err)) return 'error'
  if (typeof err.status === 'number' && err.status >= 100 && err.status <= 599) return `http-${err.status}`
  if (typeof err.timedOut === 'boolean') return err.timedOut ? 'timeout' : 'unreachable'
  if (err.notConfigured === true) return 'not-configured'
  // Erreurs du SDK d'Anthropic et de fetch reconnues à leur nom (« APIConnectionTimeoutError », « AbortError »…).
  const names = `${typeof err.name === 'string' ? err.name : ''} ${typeof err.constructor === 'function' ? err.constructor.name : ''}`
  if (/timeout|abort/i.test(names)) return 'timeout'
  if (/connection/i.test(names)) return 'unreachable'
  return 'error'
}

/**
 * Ligne d'un appel fait sans callLLM (SDK ou fetch direct : lecture des scans, test de Config IA…) : un seul essai, prix
 * public du modèle (prices.ts) sauf `price` donné.
 */
export function directCallRecord(ctx: UsageContext, facts: {
  provider: string
  model: string
  durationMs: number
  tokens: TokenCounts | null
  outcome: string
  truncated?: boolean
  price?: Price | null
}): LlmUsageRecord {
  const price = facts.price !== undefined ? facts.price : builtinPrice(facts.provider, facts.model, promptTokens(facts.tokens))
  return usageRecord(ctx, undefined, { ...facts, attempt: 0, truncated: facts.truncated ?? false, price })
}

/** Ligne du journal du serveur : un objet JSON sur une ligne, repérable par « [llm-usage] ». */
export const usageLogLine = (record: LlmUsageRecord) => `[llm-usage] ${JSON.stringify(record)}`
