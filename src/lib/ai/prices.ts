// Prix des modèles appelés par MyBestConsultant, pour estimer le coût de chaque appel d'IA (journal « Consommation IA »,
// ADR 0064). Dollars US par million de jetons, tarifs publics relevés le 2026-11-26 (Anthropic : référence des modèles ;
// OpenAI : page des prix). Les prix changent : un modèle absent d'ici n'a **pas** de coût (null), jamais un coût deviné.
// Modèles open source de Config IA : leurs prix saisis dans Config IA (`openSourcePrice`).

/** Prix d'un appel, en dollars par million de jetons. */
export interface Price {
  input: number
  output: number
  /** Jetons d'entrée lus dans le cache du fournisseur. */
  cacheRead: number
  /** Jetons d'entrée écrits dans le cache (Claude : 1,25 × l'entrée, cache de 5 minutes). */
  cacheWrite: number
}

interface PriceEntry {
  /** Identifiant du modèle ; une version datée (« claude-haiku-4-5-20251001 », « gpt-4o-2024-08-06 ») compte aussi. */
  id: string
  input: number
  output: number
  cacheRead: number
  /** Claude Haiku 5.5 : prix plus élevés au-delà de 100 000 jetons d'entrée dans la demande. */
  above100k?: { input: number; output: number; cacheRead: number }
}

// Écriture dans le cache de Claude : 1,25 × le prix d'entrée (cache de 5 minutes, le seul que l'application demande).
const CLAUDE_CACHE_WRITE = 1.25

const CLAUDE: PriceEntry[] = [
  { id: 'claude-fable-5-2', input: 8, output: 40, cacheRead: 0.2 },
  { id: 'claude-fable-5-1', input: 10, output: 50, cacheRead: 0.25 },
  { id: 'claude-opus-5-5', input: 4, output: 20, cacheRead: 0.2 },
  { id: 'claude-opus-5', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-8', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-7', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-6', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-opus-4-5', input: 5, output: 25, cacheRead: 0.5 },
  { id: 'claude-sonnet-5-5', input: 2, output: 10, cacheRead: 0.1 },
  { id: 'claude-sonnet-5', input: 2, output: 10, cacheRead: 0.2 },
  { id: 'claude-sonnet-4-6', input: 3, output: 15, cacheRead: 0.3 },
  { id: 'claude-sonnet-4-5', input: 3, output: 15, cacheRead: 0.3 },
  { id: 'claude-haiku-5-5', input: 0.1, output: 0.5, cacheRead: 0.01, above100k: { input: 0.5, output: 2.5, cacheRead: 0.05 } },
  { id: 'claude-haiku-4-5', input: 1, output: 5, cacheRead: 0.1 },
]

// OpenAI : pas de prix d'écriture dans le cache (automatique et gratuit) ; lecture = « cached input ».
const OPENAI: PriceEntry[] = [
  { id: 'gpt-4o', input: 2.5, output: 10, cacheRead: 1.25 },
  { id: 'gpt-4o-mini', input: 0.15, output: 0.6, cacheRead: 0.075 },
]

// Suffixe de date des versions figées : « -20251001 » (Anthropic) ou « -2024-08-06 » (OpenAI).
const DATED_SUFFIX = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/

function findEntry(entries: PriceEntry[], model: string): PriceEntry | undefined {
  const id = model.trim().toLowerCase()
  // Égalité ou version datée seulement : « claude-opus-5 » ne doit pas prendre le prix de « claude-opus-5-5 ».
  return entries.find(e => id === e.id || (id.startsWith(e.id) && DATED_SUFFIX.test(id.slice(e.id.length))))
}

/**
 * Prix d'un modèle de Claude ou d'OpenAI (fournisseurs `claude` et `gpt4o` de Config IA) ; null si le modèle est inconnu
 * ou le fournisseur sans tarif connu (TeckiA). `promptTokens` : jetons d'entrée de la demande, cache compris (palier de
 * Claude Haiku 5.5).
 */
export function builtinPrice(provider: string, model: string, promptTokens: number): Price | null {
  if (provider === 'claude') {
    const e = findEntry(CLAUDE, model)
    if (!e) return null
    const tier = e.above100k && promptTokens > 100_000 ? e.above100k : e
    return { input: tier.input, output: tier.output, cacheRead: tier.cacheRead, cacheWrite: tier.input * CLAUDE_CACHE_WRITE }
  }
  if (provider === 'gpt4o') {
    const e = findEntry(OPENAI, model)
    return e ? { input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.input } : null
  }
  return null
}

/**
 * Prix d'un modèle open source d'après Config IA (« Coût base facturation », 0 si hébergé en interne). Le cache de vLLM
 * n'est pas facturé à part : lecture et écriture au prix de l'entrée.
 */
export function openSourcePrice(priceInput: number, priceOutput: number): Price {
  return { input: priceInput, output: priceOutput, cacheRead: priceInput, cacheWrite: priceInput }
}

/** Jetons d'un appel. `inputTokens` : entrée hors cache (lue ou écrite), comptée à part. */
export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Coût estimé d'un appel en dollars (6 décimales) ; null sans prix connu. */
export function costUsd(tokens: TokenCounts, price: Price | null): number | null {
  if (!price) return null
  const usd = (tokens.inputTokens * price.input + tokens.outputTokens * price.output
    + tokens.cacheReadTokens * price.cacheRead + tokens.cacheWriteTokens * price.cacheWrite) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}
