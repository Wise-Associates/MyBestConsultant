import type { LlmUsageRecord } from './usage'

// Totaux de la page admin « Consommation IA » (ADR 0064), calculés sur les lignes de `llm_usage` de la période. Règles
// pures, testées : une ligne = un essai d'un modèle ; une requête de l'application = son essai 0 (les replis en plus).

/** Document de `llm_usage` : la ligne du journal, coût en millionièmes de dollar (entier exact, pas de nombre flottant). */
export type UsageDocument = Omit<LlmUsageRecord, 'costUsd'> & { costMicroUsd: number | null }

export function usageDocument(record: LlmUsageRecord): UsageDocument {
  const { costUsd, ...rest } = record
  return { ...rest, costMicroUsd: costUsd === null ? null : Math.round(costUsd * 1e6) }
}

/** Ligne relue de `llm_usage`, avec sa date d'écriture. */
export interface UsageRow extends UsageDocument {
  createdAt: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

/** Ligne lue dans Appwrite, valeurs manquantes ou d'un autre type remplacées (jamais une ligne qui fait échouer la page). */
export function rowFromDocument(doc: Record<string, unknown>): UsageRow {
  return {
    createdAt: str(doc.$createdAt),
    feature: str(doc.feature) || 'unlabelled',
    module: str(doc.module),
    tenantId: str(doc.tenantId),
    provider: str(doc.provider),
    model: str(doc.model),
    outcome: str(doc.outcome) || 'error',
    attempt: intOrNull(doc.attempt) ?? 0,
    inputTokens: intOrNull(doc.inputTokens),
    outputTokens: intOrNull(doc.outputTokens),
    cacheReadTokens: intOrNull(doc.cacheReadTokens),
    cacheWriteTokens: intOrNull(doc.cacheWriteTokens),
    durationMs: intOrNull(doc.durationMs) ?? 0,
    costMicroUsd: intOrNull(doc.costMicroUsd),
    truncated: doc.truncated === true,
  }
}

/** Périodes proposées par la page, en jours ; 30 par défaut. */
export const USAGE_PERIODS = [7, 30, 90] as const
export type UsagePeriod = (typeof USAGE_PERIODS)[number]

export function usagePeriodOf(value: unknown): UsagePeriod {
  const n = Number(Array.isArray(value) ? value[0] : value)
  return (USAGE_PERIODS as readonly number[]).includes(n) ? n as UsagePeriod : 30
}

/** Début de la période : minuit UTC il y a `days - 1` jours (le jour en cours compte). */
export function periodStart(days: UsagePeriod, now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return start
}

export interface UsageTotals {
  /** Essais (lignes) : requêtes de l'application plus replis. */
  attempts: number
  /** Requêtes de l'application (essai 0). */
  requests: number
  /** Essais d'un modèle de repli (essai 1 et plus). */
  fallbacks: number
  failures: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  /** Essais réussis sans jetons connus (serveur qui ne les renvoie pas) : ni jetons ni coût comptés. */
  withoutTokens: number
  /** Essais réussis aux jetons connus mais sans prix (modèle absent de prices.ts) : coût non compté. */
  withoutPrice: number
  truncated: number
  /** Durée médiane d'un essai réussi, en millisecondes ; 0 sans essai réussi. */
  medianDurationMs: number
}

export interface UsageGroup extends UsageTotals {
  key: string
}

export interface UsageDay {
  day: string
  requests: number
  failures: number
  costUsd: number
}

export interface UsageSummary {
  totals: UsageTotals
  byFeature: UsageGroup[]
  byModel: UsageGroup[]
  byTenant: UsageGroup[]
  byDay: UsageDay[]
  /** 20 derniers échecs, les plus récents d'abord. */
  recentFailures: UsageRow[]
}

const isOk = (r: UsageRow) => r.outcome === 'ok'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function totalsOf(rows: UsageRow[]): UsageTotals {
  const sum = (pick: (r: UsageRow) => number | null) => rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0)
  const ok = rows.filter(isOk)
  return {
    attempts: rows.length,
    requests: rows.filter(r => r.attempt === 0).length,
    fallbacks: rows.filter(r => r.attempt > 0).length,
    failures: rows.length - ok.length,
    inputTokens: sum(r => r.inputTokens),
    outputTokens: sum(r => r.outputTokens),
    cacheReadTokens: sum(r => r.cacheReadTokens),
    cacheWriteTokens: sum(r => r.cacheWriteTokens),
    costUsd: sum(r => r.costMicroUsd) / 1e6,
    withoutTokens: ok.filter(r => r.inputTokens === null).length,
    withoutPrice: ok.filter(r => r.inputTokens !== null && r.costMicroUsd === null).length,
    truncated: rows.filter(r => r.truncated).length,
    medianDurationMs: median(ok.map(r => r.durationMs)),
  }
}

function groupRows(rows: UsageRow[], keyOf: (r: UsageRow) => string): Map<string, UsageRow[]> {
  const groups = new Map<string, UsageRow[]>()
  for (const r of rows) {
    const key = keyOf(r)
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  return groups
}

function groupBy(rows: UsageRow[], keyOf: (r: UsageRow) => string): UsageGroup[] {
  const groups = groupRows(rows, keyOf)
  // Les plus coûteux d'abord, puis les plus appelés.
  return [...groups].map(([key, list]) => ({ key, ...totalsOf(list) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.attempts - a.attempts || a.key.localeCompare(b.key))
}

/** Clé d'un modèle dans les tableaux : « fournisseur · modèle » (« claude · claude-sonnet-5-5 »). */
export const modelKey = (r: Pick<UsageRow, 'provider' | 'model'>) => (r.model ? `${r.provider} · ${r.model}` : r.provider)

/** Totaux de la période `[start, now]`, jour par jour en UTC (jours sans appel compris). */
export function summarizeUsage(rows: UsageRow[], start: Date, now: Date): UsageSummary {
  const inPeriod = rows.filter(r => r.createdAt >= start.toISOString() && r.createdAt <= now.toISOString())
  const perDay = groupRows(inPeriod, r => r.createdAt.slice(0, 10))
  const days: UsageDay[] = []
  for (const d = new Date(start); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10)
    const list = perDay.get(day) ?? []
    days.push({ day, requests: list.filter(r => r.attempt === 0).length, failures: list.filter(r => !isOk(r)).length, costUsd: list.reduce((a, r) => a + (r.costMicroUsd ?? 0), 0) / 1e6 })
  }
  return {
    totals: totalsOf(inPeriod),
    byFeature: groupBy(inPeriod, r => r.feature),
    byModel: groupBy(inPeriod, modelKey),
    // Vide : appel fait pour un candidat ou un visiteur, sans organisation.
    byTenant: groupBy(inPeriod, r => r.tenantId),
    byDay: days,
    recentFailures: inPeriod.filter(r => !isOk(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
  }
}
