import { ID, Query, type Databases } from 'node-appwrite'
import { mapLimit } from '@/lib/concurrency'
import { usageLogLine, type LlmUsageRecord } from './usage'
import { rowFromDocument, usageDocument, type UsageRow } from './usage-stats'

// Enregistrement de la consommation de l'IA (ADR 0064) : une ligne « [llm-usage] » dans les journaux du serveur, puis un
// document dans `llm_usage` si la collection est configurée. Jamais attendu par l'appel d'IA, qui ne doit ni ralentir ni
// échouer à cause de ce journal : une écriture impossible est seulement journalisée. Pas de marqueur « server-only » :
// chargé avec llm-router.ts par les scripts lancés par tsx hors de Next.js. Client Appwrite chargé à la première
// écriture, comme la lecture de Config IA dans llm-router.ts.

/** Durée de conservation des lignes de `llm_usage`, en jours (purge au fil des écritures). */
export const LLM_USAGE_RETENTION_DAYS = 90

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function recordLlmUsage(record: LlmUsageRecord, now = new Date()): void {
  console.info(usageLogLine(record))
  void store(record, now)
}

async function store(record: LlmUsageRecord, now: Date): Promise<void> {
  try {
    const { COLLECTIONS, DB_ID } = await import('@/lib/appwrite/config')
    if (!COLLECTIONS.LLM_USAGE) return
    const { createAdminClient } = await import('@/lib/appwrite/client')
    await createAdminClient().databases.createDocument(DB_ID, COLLECTIONS.LLM_USAGE, ID.unique(), usageDocument(record))
    await purgeExpired(now)
  } catch (err) {
    console.error('[llm-usage] enregistrement impossible', record.feature, errorText(err))
  }
}

// Purge des lignes de plus de LLM_USAGE_RETENTION_DAYS jours : un peu au fil des écritures (au plus une fois par heure et
// par serveur, 500 lignes), et en entier chaque jour par la route de purge (/api/cron/assistant-purge), qui la fait même
// sans écriture (variable retirée, collection gardée) ou quand les écritures dépassent la purge au fil de l'eau.
const PURGE_EVERY_MS = 60 * 60 * 1000
const PURGE_BATCH = 100
const DELETE_CONCURRENCY = 10
let lastPurgeAt = 0

export const usageCutoff = (now: Date) => new Date(now.getTime() - LLM_USAGE_RETENTION_DAYS * 86_400_000).toISOString()

/**
 * Supprime les lignes écrites avant `cutoff`, par lots de 100 (10 suppressions à la fois), jusqu'à n'en plus trouver, ou
 * `maxBatches` lots, ou l'heure `deadline` passée ; nombre de lignes supprimées. Lève si Appwrite refuse (l'appelant
 * journalise) ; un passage interrompu reprend au suivant.
 */
export async function deleteRowsBefore(
  databases: Pick<Databases, 'listDocuments' | 'deleteDocument'>, dbId: string, collectionId: string, cutoff: string,
  { maxBatches = Infinity, deadline = Infinity }: { maxBatches?: number; deadline?: number } = {}, now: () => number = Date.now,
): Promise<number> {
  let deleted = 0
  for (let batch = 0; batch < maxBatches && now() < deadline; batch++) {
    const old = await databases.listDocuments(dbId, collectionId, [
      Query.lessThan('$createdAt', cutoff), Query.select(['$id']), Query.limit(PURGE_BATCH),
    ])
    await mapLimit(old.documents, DELETE_CONCURRENCY, d => databases.deleteDocument(dbId, collectionId, d.$id))
    deleted += old.documents.length
    if (old.documents.length < PURGE_BATCH) break
  }
  return deleted
}

async function purgeExpired(now: Date): Promise<void> {
  if (now.getTime() - lastPurgeAt < PURGE_EVERY_MS) return
  lastPurgeAt = now.getTime()
  const { COLLECTIONS, DB_ID } = await import('@/lib/appwrite/config')
  const { createAdminClient } = await import('@/lib/appwrite/client')
  try {
    await deleteRowsBefore(createAdminClient().databases, DB_ID, COLLECTIONS.LLM_USAGE, usageCutoff(now), { maxBatches: 5 })
  } catch (err) {
    console.error('[llm-usage] purge impossible', errorText(err))
  }
}

/** Purge quotidienne (route de purge) : toutes les lignes périmées, jusqu'à `deadline`. Lève si Appwrite refuse. */
export async function purgeExpiredLlmUsage(now: Date, deadline: number): Promise<number> {
  const { COLLECTIONS, DB_ID } = await import('@/lib/appwrite/config')
  const { createAdminClient } = await import('@/lib/appwrite/client')
  return deleteRowsBefore(createAdminClient().databases, DB_ID, COLLECTIONS.LLM_USAGE, usageCutoff(now), { deadline })
}

/** Lignes lues au plus par la page « Consommation IA » ; au-delà, la période n'est lue qu'en partie et la page le dit. */
export const USAGE_READ_CAP = 50_000
const READ_PAGE = 1000
const READ_FIELDS = ['$id', '$createdAt', 'feature', 'module', 'tenantId', 'provider', 'model', 'outcome', 'attempt', 'inputTokens',
  'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'durationMs', 'costMicroUsd', 'truncated']

export const isLlmUsageConfigured = async () => !!(await import('@/lib/appwrite/config')).COLLECTIONS.LLM_USAGE

/**
 * Lignes écrites depuis `since`, les plus récentes d'abord, USAGE_READ_CAP au plus (`capped` : il y en a davantage).
 * Lève si la collection est illisible (la page affiche l'erreur).
 */
export async function loadUsageRows(since: Date): Promise<{ rows: UsageRow[]; capped: boolean }> {
  const { COLLECTIONS, DB_ID } = await import('@/lib/appwrite/config')
  const { createAdminClient } = await import('@/lib/appwrite/client')
  const { databases } = createAdminClient()
  const rows: UsageRow[] = []
  let cursor: string | undefined
  while (rows.length < USAGE_READ_CAP) {
    const { documents } = await databases.listDocuments(DB_ID, COLLECTIONS.LLM_USAGE, [
      Query.greaterThanEqual('$createdAt', since.toISOString()), Query.orderDesc('$createdAt'), Query.select(READ_FIELDS),
      Query.limit(READ_PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    rows.push(...documents.map(d => rowFromDocument(d)))
    if (documents.length < READ_PAGE) return { rows, capped: false }
    cursor = documents[documents.length - 1].$id
  }
  return { rows, capped: true }
}
