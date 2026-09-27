// Catalogue et règles de sélection des modèles IA (Module 10) — pur, sans accès base ni clé :
// partagé par le routeur serveur (llm-router.ts) et l'écran admin /admin/llm-config.

export type AIModule = 'screening' | 'interview' | 'matching'

export const AI_MODULES: { id: AIModule; label: string; description: string }[] = [
  { id: 'screening', label: 'Screening CV', description: 'Score et analyse des candidatures' },
  { id: 'interview', label: 'Entretiens IA', description: 'Questions, relances et analyse des entretiens' },
  { id: 'matching', label: 'Matching IA', description: 'Correspondance offres / profils et sourcing' },
]

export const BUILTIN_MODEL_IDS = ['claude', 'gpt4o', 'teckia'] as const

/** Modèle open source ajouté par l'admin, joignable via une API compatible OpenAI (/chat/completions). */
export interface OpenSourceModel {
  id: string
  label: string
  family: string
  model: string
  apiUrl: string
  apiKey: string
  priceInput: number
  priceOutput: number
  enabled: boolean
}

/** Hébergeurs d'inférence proposés (tous exposent une API compatible OpenAI). */
export const OS_HOSTS: { id: string; label: string; apiUrl: string; keyRequired: boolean; hint: string }[] = [
  { id: 'ollama', label: 'Ollama / serveur privé', apiUrl: 'http://localhost:11434/v1', keyRequired: false, hint: 'Données 100 % privées — vLLM, Ollama, TeckiA…' },
  { id: 'together', label: 'Together AI', apiUrl: 'https://api.together.xyz/v1', keyRequired: true, hint: 'Large catalogue open source, facturation à l’usage' },
  { id: 'groq', label: 'Groq', apiUrl: 'https://api.groq.com/openai/v1', keyRequired: true, hint: 'Inférence très rapide' },
  { id: 'openrouter', label: 'OpenRouter', apiUrl: 'https://openrouter.ai/api/v1', keyRequired: true, hint: 'Un seul compte pour de nombreux modèles' },
  { id: 'mistral', label: 'Mistral (La Plateforme)', apiUrl: 'https://api.mistral.ai/v1', keyRequired: true, hint: 'Hébergeur européen' },
  { id: 'custom', label: 'Autre (URL personnalisée)', apiUrl: '', keyRequired: false, hint: 'Toute API compatible OpenAI' },
]

/** Modèles open source suggérés. Les noms exacts varient selon l'hébergeur : ils restent modifiables. */
export const OS_PRESETS: { id: string; family: string; label: string; models: Record<string, string> }[] = [
  { id: 'llama-3-3-70b', family: 'Meta Llama', label: 'Llama 3.3 70B', models: { ollama: 'llama3.3:70b', together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', groq: 'llama-3.3-70b-versatile', openrouter: 'meta-llama/llama-3.3-70b-instruct' } },
  { id: 'mistral-small', family: 'Mistral', label: 'Mistral Small', models: { ollama: 'mistral-small', together: 'mistralai/Mistral-Small-24B-Instruct-2501', mistral: 'mistral-small-latest', openrouter: 'mistralai/mistral-small-24b-instruct-2501' } },
  { id: 'qwen-2-5-72b', family: 'Alibaba Qwen', label: 'Qwen 2.5 72B', models: { ollama: 'qwen2.5:72b', together: 'Qwen/Qwen2.5-72B-Instruct-Turbo', openrouter: 'qwen/qwen-2.5-72b-instruct' } },
  { id: 'deepseek-v3', family: 'DeepSeek', label: 'DeepSeek V3', models: { together: 'deepseek-ai/DeepSeek-V3', openrouter: 'deepseek/deepseek-chat' } },
  { id: 'gemma-3-27b', family: 'Google Gemma', label: 'Gemma 3 27B', models: { ollama: 'gemma3:27b', together: 'google/gemma-3-27b-it', openrouter: 'google/gemma-3-27b-it' } },
]

export const MODEL_LIMITS = { label: 60, model: 120, url: 300, key: 400, maxModels: 12 } as const

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(v, 1000) : 0)

/** Identifiant stable d'un modèle personnalisé (≤ 24 car. : stocké dans screenings.provider, 50 max). */
export function makeModelId(label: string): string {
  const slug = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14) || 'model'
  return `os-${slug}-${Math.random().toString(36).slice(2, 5)}`
}

/** Valide la liste reçue du client. Les clés API sont conservées telles quelles (jamais retouchées). */
export function sanitizeOpenSourceModels(input: unknown): OpenSourceModel[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: OpenSourceModel[] = []
  for (const raw of input.slice(0, MODEL_LIMITS.maxModels)) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const label = clip(r.label, MODEL_LIMITS.label)
    const model = clip(r.model, MODEL_LIMITS.model)
    let id = clip(r.id, 24)
    if (!label || !model) continue
    if (!/^os-[a-z0-9-]+$/.test(id) || seen.has(id)) id = makeModelId(label)
    seen.add(id)
    out.push({
      id, label, model, family: clip(r.family, 40),
      apiUrl: clip(r.apiUrl, MODEL_LIMITS.url).replace(/\/+$/, ''),
      apiKey: typeof r.apiKey === 'string' ? r.apiKey.trim().slice(0, MODEL_LIMITS.key) : '',
      priceInput: num(r.priceInput), priceOutput: num(r.priceOutput), enabled: r.enabled !== false,
    })
  }
  return out
}

// ── Choix du modèle (pur — testable sans base ni clé) ─────────────────────────

export interface RoutingView {
  provider: string
  moduleRouting: Partial<Record<AIModule, string>>
  openSourceModels: OpenSourceModel[]
}

/** Modèle utilisable : intégré, ou open source ajouté ET activé. */
export function isKnownModel(cfg: RoutingView, id: string | undefined): id is string {
  return !!id && ((BUILTIN_MODEL_IDS as readonly string[]).includes(id) || cfg.openSourceModels.some(m => m.id === id && m.enabled))
}

/**
 * Modèle à appeler en premier : forcé > affecté au module > modèle par défaut > Claude.
 * Un modèle affecté puis supprimé/désactivé ne bloque jamais le module : retour au modèle par défaut.
 */
export function pickPrimary(cfg: RoutingView, opts: { provider?: string; module?: AIModule }): string {
  const routed = opts.provider ?? (opts.module ? cfg.moduleRouting[opts.module] : undefined)
  if (isKnownModel(cfg, routed)) return routed
  return isKnownModel(cfg, cfg.provider) ? cfg.provider : 'claude'
}

/** Ordre de repli si le premier modèle échoue : modèle par défaut d'abord, puis les autres disponibles. */
export function fallbackOrder(cfg: RoutingView, primary: string, isAvailable: (id: string) => boolean): string[] {
  const order = [cfg.provider, 'teckia', 'gpt4o', 'claude', ...cfg.openSourceModels.map(m => m.id)]
  return order.filter((id, i) => order.indexOf(id) === i && id !== primary && isAvailable(id))
}

/** Ne garde que les affectations pointant vers un modèle connu ('default' = modèle global). */
export function sanitizeRouting(input: unknown, validIds: Set<string>): Partial<Record<AIModule, string>> {
  const out: Partial<Record<AIModule, string>> = {}
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  for (const m of AI_MODULES) {
    const v = r[m.id]
    if (typeof v === 'string' && v !== 'default' && validIds.has(v)) out[m.id] = v
  }
  return out
}
