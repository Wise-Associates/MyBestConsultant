import Anthropic from '@anthropic-ai/sdk'
import type { LLMMessage, LLMResponse } from '@/types'
import { fallbackOrder, pickPrimary, requestedModel, sanitizeOpenSourceModels, type AIModule, type OpenSourceModel } from './models'
import { builtinPrice, openSourcePrice, type Price, type TokenCounts } from './prices'
import { claudeTokens, openAiTokens, outcomeOf, promptTokens, usageRecord, type LlmUsageRecord, type UsageContext } from './usage'
import { recordLlmUsage } from './usage-store'

export interface RuntimeConfig {
  // Modèle par défaut : 'claude' | 'gpt4o' | 'teckia' ou l'id d'un modèle open source (os-…).
  provider: string
  claudeModel: string
  claudeApiKey: string
  gpt4oModel: string
  openaiApiKey: string
  teckiaModel: string
  teckiaApiUrl: string
  teckiaApiKey: string
  openSourceModels: OpenSourceModel[]
  // Modèle dédié à un module IA (screening, entretien, matching) ; absent = modèle par défaut.
  moduleRouting: Partial<Record<AIModule, string>>
  // false : Config IA n'a pas pu être lue, ce sont les valeurs par défaut (refusées en mode strict).
  loaded: boolean
}

const DEFAULTS: RuntimeConfig = {
  provider: 'teckia',
  claudeModel: 'claude-sonnet-4-6',
  claudeApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  gpt4oModel: 'gpt-4o',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  teckiaModel: process.env.TECKIA_MODEL ?? 'qwen3:14b',
  teckiaApiUrl: process.env.TECKIA_API_URL ?? '',
  teckiaApiKey: process.env.TECKIA_API_KEY ?? '',
  openSourceModels: [],
  moduleRouting: {},
  loaded: true,
}

// La config est relue à chaque appel (un changement admin est donc actif tout de suite, sans
// redéploiement ni coupure) ; ce petit cache évite seulement une lecture base par appel IA
// pendant une rafale (ex. screening de 50 CV). Invalidé à l'enregistrement de la config.
const CONFIG_TTL_MS = 10_000
let cached: { at: number; cfg: RuntimeConfig } | null = null

export function invalidateLLMConfigCache() {
  cached = null
}

async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.cfg
  const cfg = await loadRuntimeConfig()
  cached = { at: Date.now(), cfg }
  return cfg
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const { createAdminClient } = await import('@/lib/appwrite/client')
    const { databases } = createAdminClient()
    const { DB_ID, COLLECTIONS } = await import('@/lib/appwrite/config')
    const { Query } = await import('node-appwrite')
    // /admin/llm-config saves the full config (incl. API keys) into TEMPLATES_CONFIG's
    // customColors.__llm — not AI_CONFIG, which only mirrors activeProvider for
    // backwards compat. Reading AI_CONFIG here meant a saved key was never actually used.
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return DEFAULTS
    const doc = result.documents[0]
    const customColors = doc.customColors as string | undefined
    const llmRaw = customColors ? JSON.parse(customColors).__llm : undefined
    const cfg = llmRaw ? JSON.parse(llmRaw) : {}
    return {
      provider: (cfg.activeProvider as string) || DEFAULTS.provider,
      claudeModel: cfg.claudeModel ?? DEFAULTS.claudeModel,
      // DB key takes priority over env var (empty string falls back to env)
      claudeApiKey: cfg.claudeApiKey || DEFAULTS.claudeApiKey,
      gpt4oModel: cfg.gpt4oModel ?? DEFAULTS.gpt4oModel,
      openaiApiKey: cfg.openaiApiKey || DEFAULTS.openaiApiKey,
      teckiaModel: cfg.teckiaModel ?? DEFAULTS.teckiaModel,
      teckiaApiUrl: cfg.teckiaApiUrl || DEFAULTS.teckiaApiUrl,
      teckiaApiKey: cfg.teckiaApiKey || DEFAULTS.teckiaApiKey,
      openSourceModels: sanitizeOpenSourceModels(cfg.openSourceModels),
      moduleRouting: (cfg.moduleRouting && typeof cfg.moduleRouting === 'object' ? cfg.moduleRouting : {}) as RuntimeConfig['moduleRouting'],
      loaded: true,
    }
  } catch (err) {
    console.error('[llm] Config IA illisible, valeurs par défaut utilisées (appels stricts refusés)', err instanceof Error ? err.message : String(err))
    return { ...DEFAULTS, loaded: false }
  }
}

/**
 * Bornes d'un appel : longueur de la réponse et délai (défauts : 4096 jetons ; 55 s, ou le délai du SDK pour Claude), et
 * début du premier message à mettre en cache chez Claude (`cachePrefix`, voir CallLLMOptions).
 */
export interface CallLimits {
  maxTokens?: number
  timeoutMs?: number
  cachePrefix?: string
  /** Modèle précis du fournisseur, à la place de celui de Config IA (voir CallLLMOptions.model). */
  model?: string
  /** Effort de réflexion de Claude (voir CallLLMOptions.effort). */
  effort?: 'low' | 'medium' | 'high'
}

/** Réponse d'un essai : texte, jetons (null si le fournisseur ne les donne pas) et réponse coupée à la longueur maximale. */
export interface AttemptOutput {
  content: string
  tokens: TokenCounts | null
  truncated: boolean
}

async function callClaude(messages: LLMMessage[], systemPrompt: string | undefined, model: string, apiKey: string, limits: CallLimits): Promise<AttemptOutput> {
  // Claude est le dernier recours de pickPrimary, même sans clé : échec explicite plutôt qu'une erreur du SDK.
  if (!apiKey) throw new LLMNotConfiguredError('Claude non configuré (clé manquante dans /admin/llm-config)')
  const client = new Anthropic({ apiKey })
  // Délai imposé par l'appelant : pas de nouvel essai automatique, qui le dépasserait.
  const requestOptions = limits.timeoutMs ? { timeout: limits.timeoutMs, maxRetries: 0 } : undefined
  const prefix = limits.cachePrefix
  const response = await client.messages.create({
    model,
    max_tokens: limits.maxTokens ?? 4096,
    ...(limits.effort ? { output_config: { effort: limits.effort } } : {}),
    system: systemPrompt,
    messages: messages.map((m, i): Anthropic.MessageParam => {
      const role = m.role === 'system' ? 'user' : m.role
      // Premier message qui commence par le préfixe partagé : deux blocs de texte, le premier marqué pour le cache de
      // prompt (consignes + préfixe lus à ~10 % du prix par les appels suivants, 5 minutes). Texte envoyé identique.
      if (i === 0 && prefix && m.content.startsWith(prefix) && m.content.length > prefix.length) {
        return { role, content: [
          { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: m.content.slice(prefix.length) },
        ] }
      }
      return { role, content: m.content }
    }),
  }, requestOptions)
  // Tous les blocs de texte, dans l'ordre ; une réponse sans texte (refus, contenu vide) donne une chaîne vide.
  const content = response.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
  return { content, tokens: claudeTokens(response.usage), truncated: response.stop_reason === 'max_tokens' }
}

/**
 * Réponse d'erreur HTTP d'une API compatible OpenAI. Le statut et le corps permettent aux appelants de
 * distinguer des crédits épuisés ou une clé refusée d'une saturation passagère (src/lib/ao/ai-failures.ts).
 */
export class LLMHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`LLM API error ${status}: ${body}`)
  }
}

/**
 * Modèle injoignable (réseau) ou sans réponse dans le délai. `timedOut` distingue les deux : une requête
 * restée sans réponse a pu être traitée, donc facturée ; une requête qui n'a pas pu partir, non.
 */
export class LLMUnreachableError extends Error {
  constructor(readonly timedOut: boolean, reason: string) {
    super(`Modèle IA injoignable (${reason})`)
  }
}

/** Modèle choisi mais pas configuré (clé ou URL manquante, modèle désactivé) : aucun appel n'a été fait. */
export class LLMNotConfiguredError extends Error {
  // Lu par outcomeOf (usage.ts) : le nom de la classe ne survit pas à la minification du serveur.
  readonly notConfigured = true
}

/**
 * Le modèle choisi et tous ses replis ont échoué. Le message reste celui du premier modèle (ce que les
 * appelants affichaient déjà) ; `failures` garde l'erreur de chacun, pour savoir si tous ont échoué sans
 * frais (crédits épuisés, service en panne) ou si l'un d'eux a pu être facturé (src/lib/ao/ai-failures.ts).
 */
export class LLMChainError extends Error {
  constructor(readonly failures: { provider: string; error: unknown }[]) {
    const first = failures[0]?.error
    super(first instanceof Error ? first.message : String(first), { cause: first })
  }
}

async function callOpenAICompat(
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  model: string,
  apiUrl: string,
  apiKey: string,
  limits: CallLimits,
  // Température du modèle open source dans Config IA ; absente : aucune envoyée, le serveur applique la sienne (GPT,
  // TeckiA, modèle sans réglage — comportement d'avant l'ADR 0057).
  temperature?: number | null,
): Promise<AttemptOutput> {
  const timeoutMs = limits.timeoutMs ?? 55_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        // 800 truncated long responses mid-JSON (e.g. multi-offer imports with full,
        // untruncated descriptions) — the model output cut off mid-property, so
        // JSON.parse threw a confusing "Expected ',' or '}'" error on the client.
        max_tokens: limits.maxTokens ?? 4096,
        // "think" désactive le mode raisonnement de Qwen3 (TeckiA) — propriété non standard que
        // les autres API compatibles OpenAI (Groq, GPT-4o, autres modèles open source) refusent.
        ...(model.toLowerCase().includes('qwen') ? { think: false } : {}),
        ...(typeof temperature === 'number' ? { temperature } : {}),
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...messages,
        ],
      }),
    })
  } catch (err) {
    // Le message de fetch peut recopier l'en-tête refusé, donc la clé (valeur avec un retour à la ligne) :
    // seule la nature de l'échec est gardée.
    const code = (err as { cause?: { code?: string } })?.cause?.code
    const reason = controller.signal.aborted ? `pas de réponse après ${Math.round(timeoutMs / 1000)} s` : code ?? (err instanceof Error ? err.name : 'réseau')
    throw new LLMUnreachableError(controller.signal.aborted, reason)
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new LLMHttpError(res.status, await res.text())
  const data = await res.json()
  const choice = data.choices?.[0]
  const msg = choice?.message
  // qwen3 thinking mode returns content="" with answer in reasoning — accept either
  return { content: msg?.content || msg?.reasoning || '', tokens: openAiTokens(data.usage), truncated: choice?.finish_reason === 'length' }
}

/** Nature d'un échec, pour les journaux : jamais le message d'erreur, qui peut citer la demande ou la réponse. */
function failureKind(err: unknown): string {
  if (err instanceof LLMHttpError) return `HTTP ${err.status}`
  if (err instanceof LLMUnreachableError) return err.timedOut ? 'délai dépassé' : 'injoignable'
  if (err instanceof LLMNotConfiguredError) return 'non configuré'
  return err instanceof Error ? err.name : 'erreur'
}

const isCustomId = (id: string) => id.startsWith('os-')
const findCustom = (cfg: RuntimeConfig, id: string) => cfg.openSourceModels.find(m => m.id === id && m.enabled)

/** Un modèle est « utilisable » si sa config minimale est présente (sert au choix du repli). */
function isAvailable(id: string, cfg: RuntimeConfig): boolean {
  if (id === 'teckia') return !!cfg.teckiaApiUrl
  if (id === 'gpt4o') return !!cfg.openaiApiKey
  if (id === 'claude') return !!cfg.claudeApiKey
  const m = findCustom(cfg, id)
  return !!m && !!m.apiUrl && !!m.model
}

/** Modèle qu'un essai de `provider` demandera (`forced` : celui imposé par l'appelant) ; vide pour un modèle open source retiré. */
function modelOf(provider: string, cfg: RuntimeConfig, forced?: string): string {
  if (forced) return forced
  if (isCustomId(provider)) return findCustom(cfg, provider)?.model ?? ''
  if (provider === 'gpt4o') return cfg.gpt4oModel
  if (provider === 'teckia') return cfg.teckiaModel
  return cfg.claudeModel
}

/** Prix de l'essai (prices.ts) : tarif public pour Claude et OpenAI, prix de Config IA pour un modèle open source. */
function priceOf(provider: string, model: string, cfg: RuntimeConfig, tokens: TokenCounts | null): Price | null {
  if (isCustomId(provider)) {
    const m = findCustom(cfg, provider)
    return m ? openSourcePrice(m.priceInput, m.priceOutput) : null
  }
  // Tout autre id est servi par Claude (`default` de tryCall).
  return builtinPrice(provider === 'gpt4o' || provider === 'teckia' ? provider : 'claude', model, promptTokens(tokens))
}

async function tryCall(
  provider: string,
  cfg: RuntimeConfig,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  limits: CallLimits,
): Promise<AttemptOutput> {
  if (isCustomId(provider)) {
    const m = findCustom(cfg, provider)
    if (!m) throw new LLMNotConfiguredError(`Modèle ${provider} introuvable ou désactivé (voir /admin/llm-config)`)
    if (!m.apiUrl) throw new LLMNotConfiguredError(`Modèle « ${m.label} » : URL de l'API manquante (voir /admin/llm-config)`)
    return callOpenAICompat(messages, systemPrompt, limits.model || m.model, m.apiUrl, m.apiKey, limits, m.temperature)
  }
  switch (provider) {
    case 'gpt4o':
      return callOpenAICompat(messages, systemPrompt, limits.model || cfg.gpt4oModel, 'https://api.openai.com/v1', cfg.openaiApiKey, limits)
    case 'teckia':
      // An empty apiUrl becomes a relative URL server-side ("fetch failed", not a
      // real HTTP error) — fail fast with a message that actually explains why.
      if (!cfg.teckiaApiUrl) throw new LLMNotConfiguredError('TeckiA non configuré (URL manquante dans /admin/llm-config)')
      return callOpenAICompat(messages, systemPrompt, limits.model || cfg.teckiaModel, cfg.teckiaApiUrl, cfg.teckiaApiKey, limits)
    case 'claude':
    default:
      return callClaude(messages, systemPrompt, limits.model || cfg.claudeModel, cfg.claudeApiKey, limits)
  }
}

export interface CallLLMOptions {
  /** Force un modèle précis (id builtin ou os-…), sans regarder la config par module. */
  provider?: string
  /** Module appelant : utilise le modèle qui lui est affecté dans /admin/llm-config, sinon le modèle par défaut. */
  module?: AIModule
  /** Modèle à utiliser quand Config IA n'en affecte aucun au module, au lieu du modèle par défaut (repli inchangé). */
  moduleDefault?: string
  /** Pas de repli automatique — pour tester réellement un modèle sans qu'un autre réponde à sa place. */
  strict?: boolean
  /** Longueur maximale de la réponse (jetons), 4096 par défaut. */
  maxTokens?: number
  /** Délai de chaque modèle essayé (ms) ; défaut : 55 s pour les API compatibles OpenAI, délai du SDK pour Claude. */
  timeoutMs?: number
  /**
   * Début du premier message, identique d'un appel à l'autre (ex. l'offre, avant le CV) : mis en cache chez Claude avec
   * les consignes (ADR 0044). Sans effet sur les autres fournisseurs, ni si le message ne commence pas par lui.
   */
  cachePrefix?: string
  /**
   * Modèle précis du fournisseur `provider` (ex. « claude-haiku-5-5 », « gpt-4o-mini ») à la place de celui de Config IA ;
   * clé et adresse restent celles de Config IA. À utiliser avec `provider` et `strict` : sans repli vers un autre modèle.
   */
  model?: string
  /**
   * Modèle précis par fournisseur, au premier essai comme en repli (ex. `{ claude: 'claude-haiku-5-5', gpt4o:
   * 'gpt-4o-mini' }` pour la classification des CV) ; les fournisseurs absents gardent le modèle de Config IA.
   * L'emporte sur `model`.
   */
  providerModels?: Partial<Record<string, string>>
  /** Effort de réflexion de Claude (`output_config.effort`) ; ignoré par les autres fournisseurs. */
  effort?: 'low' | 'medium' | 'high'
  /** Fonction de l'application et organisation de l'appel, pour le journal de consommation de l'IA (ADR 0064). */
  usage?: UsageContext
}

/**
 * Modèle qu'un appel avec ces options utilisera d'abord (« fournisseur:modèle », ex. « claude:claude-sonnet-4-6 ») : sert
 * à ne pas reprendre une notation gardée faite par un autre modèle (ADR 0044). `provider` : celui que callLLM renverra.
 */
export async function primaryModel(opts: Pick<CallLLMOptions, 'provider' | 'module' | 'moduleDefault'>): Promise<{ provider: string; signature: string }> {
  const cfg = await getRuntimeConfig()
  const provider = pickPrimary(cfg, opts)
  const custom = isCustomId(provider) ? findCustom(cfg, provider) : undefined
  const model = modelOf(provider, cfg)
  // Température d'un modèle open source comprise (ADR 0057) : la changer refait ses notations au lieu de reprendre
  // celles du cache. Sans température, signature d'avant : les notations gardées restent valables.
  const temperature = typeof custom?.temperature === 'number' ? `@t${custom.temperature}` : ''
  return { provider, signature: `${provider}:${model}${temperature}` }
}

/**
 * callLLM lié à un module : `const callLLM = callLLMForModule('interview')` suffit à router tout un fichier ; chaque appel
 * donne sa fonction et son organisation (`usage`).
 */
export function callLLMForModule(module: AIModule) {
  return (messages: LLMMessage[], systemPrompt?: string, usage?: UsageContext) => callLLM(messages, systemPrompt, { module, usage })
}

export async function callLLM(
  messages: LLMMessage[],
  systemPrompt?: string,
  // Ancienne forme (id de modèle) conservée pour les appelants existants.
  options?: string | CallLLMOptions,
): Promise<LLMResponse> {
  const opts: CallLLMOptions = typeof options === 'string' ? { provider: options } : options ?? {}
  const cfg = await getRuntimeConfig()
  return callWithConfig(cfg, opts, {
    attempt: (provider, limits) => tryCall(provider, cfg, messages, systemPrompt, limits),
    record: recordLlmUsage,
    now: Date.now,
  })
}

/** Ce que callWithConfig fait faire au-dehors : un essai de modèle, l'écriture du journal et l'heure (remplacés en test). */
export interface CallDeps {
  attempt: (provider: string, limits: CallLimits) => Promise<AttemptOutput>
  record: (record: LlmUsageRecord) => void
  now: () => number
}

/**
 * Choix du modèle, replis et journal de consommation d'un appel, la configuration déjà lue. Une ligne de journal par essai
 * (le modèle choisi, puis chaque repli), réussi ou non, et pour un appel strict refusé avant tout essai.
 */
export async function callWithConfig(cfg: RuntimeConfig, opts: CallLLMOptions, deps: CallDeps): Promise<LLMResponse> {
  const log = (provider: string, model: string, attempt: number, startedAt: number, out: AttemptOutput | null, outcome: string) => {
    try {
      deps.record(usageRecord(opts.usage, opts.module, {
        provider, model, attempt, durationMs: deps.now() - startedAt, tokens: out?.tokens ?? null, truncated: out?.truncated ?? false,
        outcome, price: out ? priceOf(provider, model, cfg, out.tokens) : null,
      }))
    } catch (err) {
      // Le journal ne doit jamais faire échouer l'appel d'IA.
      console.error('[llm-usage] ligne non écrite', err instanceof Error ? err.message : String(err))
    }
  }
  const run = async (provider: string, attempt: number, limits: CallLimits): Promise<string> => {
    const model = modelOf(provider, cfg, limits.model)
    const startedAt = deps.now()
    try {
      const out = await deps.attempt(provider, limits)
      log(provider, model, attempt, startedAt, out, 'ok')
      return out.content
    } catch (err) {
      log(provider, model, attempt, startedAt, null, outcomeOf(err))
      throw err
    }
  }

  const primary = pickPrimary(cfg, opts)
  if (opts.strict) {
    // Strict (assistant IA, test d'un modèle) : jamais un autre modèle que celui demandé — ni celui des valeurs par
    // défaut quand Config IA est illisible, ni le modèle par défaut quand celui demandé a été retiré ou désactivé.
    const requested = opts.provider ?? (opts.module ? cfg.moduleRouting[opts.module] : undefined)
    const refusal = !cfg.loaded ? new LLMNotConfiguredError('Config IA illisible : appel refusé (mode sans repli)')
      : requested && requested !== primary ? new LLMNotConfiguredError(`Modèle ${requested} introuvable ou désactivé (voir /admin/llm-config)`)
      : null
    if (refusal) {
      log(requested ?? primary, '', 0, deps.now(), null, outcomeOf(refusal))
      throw refusal
    }
  }

  const limits: CallLimits = { maxTokens: opts.maxTokens, timeoutMs: opts.timeoutMs, cachePrefix: opts.cachePrefix, model: requestedModel(primary, primary, opts), effort: opts.effort }
  // Try primary provider first
  try {
    const content = await run(primary, 0, limits)
    return { content, provider: primary }
  } catch (primaryErr) {
    if (opts.strict) throw primaryErr

    // Auto-fallback chain : d'abord le modèle par défaut (si le module avait son propre modèle),
    // puis les autres modèles configurés — un modèle indisponible ne coupe pas le service.
    const fallbacks = fallbackOrder(cfg, primary, id => isAvailable(id, cfg))
    const failures: { provider: string; error: unknown }[] = [{ provider: primary, error: primaryErr }]

    for (const [i, fallback] of fallbacks.entries()) {
      try {
        // Le modèle forcé (`model`) est celui du fournisseur demandé : un modèle de repli garde le sien, sauf s'il est
        // précisé dans `providerModels` (GPT-4o mini pour la classification des CV).
        const content = await run(fallback, i + 1, { ...limits, model: requestedModel(fallback, primary, opts) })
        // Un repli réussi ne doit pas cacher que le modèle choisi ne répond pas (hébergeur qui refuse un paramètre, clé
        // expirée…) : la nature de chaque échec seulement, jamais le message, qui peut citer la demande.
        console.warn('[llm] repli :', failures.map(f => `${f.provider} (${failureKind(f.error)})`).join(', '), '→ réponse de', fallback)
        return { content, provider: fallback }
      } catch (fallbackErr) {
        failures.push({ provider: fallback, error: fallbackErr })
      }
    }

    // Tous en échec : message du modèle choisi, détail de chaque modèle dans `failures`.
    throw new LLMChainError(failures)
  }
}
