import Anthropic from '@anthropic-ai/sdk'
import type { LLMMessage, LLMResponse } from '@/types'
import { fallbackOrder, pickPrimary, sanitizeOpenSourceModels, type AIModule, type OpenSourceModel } from './models'

interface RuntimeConfig {
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
    }
  } catch {
    return DEFAULTS
  }
}

async function callClaude(messages: LLMMessage[], systemPrompt: string | undefined, model: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
  })
  const block = response.content[0]
  return block.type === 'text' ? block.text : ''
}

async function callOpenAICompat(
  messages: LLMMessage[],
  systemPrompt: string | undefined,
  model: string,
  apiUrl: string,
  apiKey: string,
): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 55_000)
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
        max_tokens: 4096,
        // "think" désactive le mode raisonnement de Qwen3 (TeckiA) — propriété non standard que
        // les autres API compatibles OpenAI (Groq, GPT-4o, autres modèles open source) refusent.
        ...(model.toLowerCase().includes('qwen') ? { think: false } : {}),
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          ...messages,
        ],
      }),
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`LLM API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  // qwen3 thinking mode returns content="" with answer in reasoning — accept either
  return msg?.content || msg?.reasoning || ''
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

async function tryCall(
  provider: string,
  cfg: RuntimeConfig,
  messages: LLMMessage[],
  systemPrompt: string | undefined,
): Promise<string> {
  if (isCustomId(provider)) {
    const m = findCustom(cfg, provider)
    if (!m) throw new Error(`Modèle ${provider} introuvable ou désactivé (voir /admin/llm-config)`)
    if (!m.apiUrl) throw new Error(`Modèle « ${m.label} » : URL de l'API manquante (voir /admin/llm-config)`)
    return callOpenAICompat(messages, systemPrompt, m.model, m.apiUrl, m.apiKey)
  }
  switch (provider) {
    case 'gpt4o':
      return callOpenAICompat(messages, systemPrompt, cfg.gpt4oModel, 'https://api.openai.com/v1', cfg.openaiApiKey)
    case 'teckia':
      // An empty apiUrl becomes a relative URL server-side ("fetch failed", not a
      // real HTTP error) — fail fast with a message that actually explains why.
      if (!cfg.teckiaApiUrl) throw new Error('TeckiA non configuré (URL manquante dans /admin/llm-config)')
      return callOpenAICompat(messages, systemPrompt, cfg.teckiaModel, cfg.teckiaApiUrl, cfg.teckiaApiKey)
    case 'claude':
    default:
      return callClaude(messages, systemPrompt, cfg.claudeModel, cfg.claudeApiKey)
  }
}

export interface CallLLMOptions {
  /** Force un modèle précis (id builtin ou os-…), sans regarder la config par module. */
  provider?: string
  /** Module appelant : utilise le modèle qui lui est affecté dans /admin/llm-config, sinon le modèle par défaut. */
  module?: AIModule
  /** Pas de repli automatique — pour tester réellement un modèle sans qu'un autre réponde à sa place. */
  strict?: boolean
}

/** callLLM lié à un module : `const callLLM = callLLMForModule('interview')` suffit à router tout un fichier. */
export function callLLMForModule(module: AIModule) {
  return (messages: LLMMessage[], systemPrompt?: string) => callLLM(messages, systemPrompt, { module })
}

export async function callLLM(
  messages: LLMMessage[],
  systemPrompt?: string,
  // Ancienne forme (id de modèle) conservée pour les appelants existants.
  options?: string | CallLLMOptions,
): Promise<LLMResponse> {
  const opts: CallLLMOptions = typeof options === 'string' ? { provider: options } : options ?? {}
  const cfg = await getRuntimeConfig()

  const primary = pickPrimary(cfg, opts)

  // Try primary provider first
  try {
    const content = await tryCall(primary, cfg, messages, systemPrompt)
    return { content, provider: primary }
  } catch (primaryErr) {
    if (opts.strict) throw primaryErr

    // Auto-fallback chain : d'abord le modèle par défaut (si le module avait son propre modèle),
    // puis les autres modèles configurés — un modèle indisponible ne coupe pas le service.
    const fallbacks = fallbackOrder(cfg, primary, id => isAvailable(id, cfg))

    for (const fallback of fallbacks) {
      try {
        const content = await tryCall(fallback, cfg, messages, systemPrompt)
        return { content, provider: fallback }
      } catch { continue }
    }

    // All providers failed — throw the original error
    throw primaryErr
  }
}
