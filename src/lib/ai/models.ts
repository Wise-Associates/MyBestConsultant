// Catalogue et règles de sélection des modèles IA (Module 10) — pur, sans accès base ni clé :
// partagé par le routeur serveur (llm-router.ts) et l'écran admin /admin/llm-config.

export type AIModule = 'interview' | 'matching' | 'assistant' | 'cvExport' | 'classification' | 'aoPublication'

/**
 * Modèle de toute notation d'un candidat pour une offre : ligne « Matching IA » de Config IA, Claude si elle est sur
 * « Modèle par défaut » (ADR 0029 : une seule ligne, « Screening CV » retirée ; repli habituel si le modèle échoue).
 */
export const SCORING_AI = { module: 'matching', moduleDefault: 'claude' } as const

/**
 * Classification des CV (ADR 0044) : ligne « Classification des CV » de Config IA, Claude si elle est sur « Modèle par
 * défaut », puis le repli habituel ; modèles précis de Claude et de GPT dans CLASSIFIER_MODELS.
 */
export const CLASSIFICATION_AI = { module: 'classification', moduleDefault: 'claude' } as const

/** Modèle précis de Claude et de GPT pour la classification ; TeckiA et les modèles open source gardent celui de Config IA. */
export const CLASSIFIER_MODELS: Partial<Record<string, string>> = { claude: 'claude-haiku-5-5', gpt4o: 'gpt-4o-mini' }

/**
 * Version publiée d'un appel d'offres (« Préparer la publication », ADR 0060) : ligne « Publication des AO » de Config IA,
 * Claude si elle est sur « Modèle par défaut », toujours en Sonnet 5.5 (mesure du 2026-11-24 sur 12 AO : seul à garder
 * toutes les directions génériques en anonymisant ; Haiku 5.5 10/12, GPT-4o mini 3/12), effort bas ; repli habituel.
 */
export const PUBLICATION_AI = { module: 'aoPublication', moduleDefault: 'claude', providerModels: { claude: 'claude-sonnet-5-5' }, effort: 'low' } as const

/**
 * Modèle précis demandé pour un fournisseur de la chaîne : celui de `providerModels` (ex. Claude Haiku pour la
 * classification, au premier essai comme en repli), sinon `model` pour le premier essai seulement ; undefined : le
 * modèle de Config IA.
 */
export function requestedModel(provider: string, primary: string, opts: { model?: string; providerModels?: Partial<Record<string, string>> }): string | undefined {
  return opts.providerModels?.[provider] ?? (provider === primary ? opts.model : undefined)
}

/** `moduleDefault` : modèle du module quand Config IA n'en choisit aucun (affiché par l'écran admin, comme pickPrimary). */
export const AI_MODULES: { id: AIModule; label: string; description: string; moduleDefault?: string }[] = [
  { id: 'interview', label: 'Entretiens IA', description: 'Questions, relances et analyse des entretiens' },
  // Toute notation d'un candidat pour une offre et MBC Search (SCORING_AI ; ADR 0029, qui a retiré la ligne « Screening CV »).
  { id: 'matching', label: 'Matching IA', description: 'Score des candidats pour une offre : candidatures (screening), base candidats, viviers ; MBC Search (critères, questions, message d’approche) — Claude si « Modèle par défaut »', moduleDefault: SCORING_AI.moduleDefault },
  // Sans repli (callLLM strict, src/lib/assistant/host.ts) : les conversations ne partent que chez le modèle choisi ici.
  { id: 'assistant', label: 'Assistant IA', description: 'Questions d’aide des candidats et recruteurs — sans repli : en cas de panne, l’assistant affiche une erreur' },
  // Sans repli (callLLM strict, src/lib/cv-export/export.ts) : le CV complet du candidat ne part que chez le modèle choisi ici.
  // Modèle CV déposé (template-upload.ts) : cartographié par Claude quand aucun modèle n'est choisi ici (moduleDefault).
  { id: 'cvExport', label: 'Export CV (format cabinet)', description: 'Dossier de compétences anonymisé FR / EN (contenu du CV recopié tel quel) depuis la CV Thèque et le vivier — sans repli : en cas de panne, l’export affiche une erreur. Analyse des modèles CV déposés : Claude si « Modèle par défaut »' },
  // ADR 0044 : Claude Haiku et GPT-4o mini plutôt que les modèles de leur ligne (CLASSIFIER_MODELS).
  { id: 'classification', label: 'Classification des CV', description: 'Métiers, compétences, séniorité… de chaque CV déposé, pour le préfiltre du matching et les statistiques — Claude (Haiku) si « Modèle par défaut », puis le repli habituel (GPT : GPT-4o mini) ; aucun modèle disponible : classement par règles, refait par l’IA ensuite', moduleDefault: CLASSIFICATION_AI.moduleDefault },
  // ADR 0060 : Claude Sonnet 5.5 plutôt que le modèle Claude de la ligne (PUBLICATION_AI), choisi par la mesure.
  { id: 'aoPublication', label: 'Publication des AO', description: 'Version anonymisée d’un appel d’offres à relire avant publication (« Préparer la publication ») — Claude (Sonnet 5.5) si « Modèle par défaut », puis le repli habituel ; aucun modèle disponible : version préparée par les règles', moduleDefault: PUBLICATION_AI.moduleDefault },
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
  /**
   * Température envoyée au serveur (0 à 2) ; null : aucune, le serveur applique la sienne. vLLM prend alors celle du
   * modèle, ou 1,0 si le modèle n'en donne pas (Ministral 3) : réponses JSON abîmées (ADR 0057).
   */
  temperature: number | null
}

/**
 * Température d'un modèle ajouté dans Config IA. 0,15 : réponses JSON stables pour Ministral 3 sur vLLM (banc d'essai du
 * 2026-11-23, ADR 0057) ; les tâches de MBC sont surtout de l'extraction et de la notation, pas de la création.
 */
export const DEFAULT_OPEN_SOURCE_TEMPERATURE = 0.15

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

/**
 * Saisie du champ « Température » de Config IA : vide → null (celle du serveur) ; nombre de 0 à 2, avec une virgule ou
 * un point → ce nombre ; autre chose → 'invalide', pour que le formulaire le signale au lieu de l'enregistrer comme vide.
 */
export function parseTemperatureInput(text: string): number | null | 'invalide' {
  const t = text.trim()
  if (!t) return null
  if (!/^\d+([.,]\d*)?$/.test(t)) return 'invalide'
  const n = Number(t.replace(',', '.'))
  return n <= 2 ? n : 'invalide'
}

/** Température ramenée entre 0 et 2, au centième ; autre chose qu'un nombre : null (celle du serveur). */
export function sanitizeTemperature(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.round(Math.min(Math.max(v, 0), 2) * 100) / 100
}

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
      temperature: sanitizeTemperature(r.temperature),
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
 * Modèle à appeler en premier : forcé > affecté au module > modèle de l'appelant quand le module n'en a pas
 * (`moduleDefault`) > modèle par défaut > Claude.
 * Un modèle affecté puis supprimé/désactivé ne bloque jamais le module : retour au modèle par défaut.
 */
export function pickPrimary(cfg: RoutingView, opts: { provider?: string; module?: AIModule; moduleDefault?: string }): string {
  const routed = opts.provider ?? (opts.module ? cfg.moduleRouting[opts.module] : undefined)
  if (isKnownModel(cfg, routed)) return routed
  if (!opts.provider && isKnownModel(cfg, opts.moduleDefault)) return opts.moduleDefault
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
