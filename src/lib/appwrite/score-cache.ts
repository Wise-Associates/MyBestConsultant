import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import {
  isFreshScore, parseCachedCriteriaScore, parseCachedScore, scoreCacheCutoff, serializeCachedScore, type CachedCriteriaScore, type CachedScore,
} from '@/lib/score-cache'
import type { ActiveScale } from '@/lib/match-scoring'

// Notations gardées (collection `score_cache`, ADR 0044). Simple économie : une panne est journalisée et la notation se
// fait normalement ; elle ne bloque jamais le matching. Serveur seulement, aucune permission client (pas de marqueur
// « server-only » : le module est aussi chargé par scripts/matching-explain.mts, lancé par tsx hors de Next.js).

export const isScoreCacheConfigured = () => !!COLLECTIONS.SCORE_CACHE

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Texte gardé sous `id` s'il est encore frais ; null sinon (absent, périmé ou cache en panne, journalisé). */
async function readFreshResult(id: string, now: Date): Promise<unknown> {
  if (!isScoreCacheConfigured()) return null
  try {
    const doc = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.SCORE_CACHE, id)
    return isFreshScore(doc.$createdAt, now) ? doc.result : null
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 404)) console.error('[score-cache] lecture impossible', id, errorText(err))
    return null
  }
}

/** Notation gardée `id` encore valable pour ce barème ; null sinon (absente, périmée, illisible ou cache en panne). */
export async function readCachedScore(id: string, scale: ActiveScale, now = new Date()): Promise<CachedScore | null> {
  return parseCachedScore(await readFreshResult(id, now), scale)
}

/** Notation sur les critères d'une offre (v3) gardée `id`, pour ces libellés (empreinte) ; null sinon. */
export async function readCachedCriteriaScore(id: string, fingerprint: string, now = new Date()): Promise<CachedCriteriaScore | null> {
  return parseCachedCriteriaScore(await readFreshResult(id, now), fingerprint)
}

/** Garde une notation ; une notation périmée au même identifiant est remplacée (nouvelle date de création). */
export async function writeCachedScore(id: string, entry: CachedScore | CachedCriteriaScore, now = new Date()): Promise<void> {
  if (!isScoreCacheConfigured()) return
  const result = serializeCachedScore(entry)
  if (!result) return
  const { databases } = createAdminClient()
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.SCORE_CACHE, id, { result })
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 409)) {
      console.error('[score-cache] écriture impossible', id, errorText(err))
      return
    }
    // Déjà là : gardée par une notation simultanée (on la laisse), ou périmée (remplacée, pour repartir à zéro).
    try {
      const doc = await databases.getDocument(DB_ID, COLLECTIONS.SCORE_CACHE, id)
      if (!isFreshScore(doc.$createdAt, now)) {
        await databases.deleteDocument(DB_ID, COLLECTIONS.SCORE_CACHE, id)
        await databases.createDocument(DB_ID, COLLECTIONS.SCORE_CACHE, id, { result })
      }
    } catch (replaceErr) {
      console.error('[score-cache] remplacement impossible', id, errorText(replaceErr))
    }
  }
  // Sans attendre : la notation est déjà faite, la purge ne doit pas la retarder (erreurs journalisées dedans).
  void purgeExpired(now)
}

// Purge des notations périmées au fil des écritures : au plus une fois par heure et par serveur, 100 à la fois (sans
// tâche planifiée à mettre en place). Elles contiennent des citations des CV : pas plus de SCORE_CACHE_TTL_DAYS jours.
const PURGE_EVERY_MS = 60 * 60 * 1000
let lastPurgeAt = 0

async function purgeExpired(now: Date): Promise<void> {
  if (now.getTime() - lastPurgeAt < PURGE_EVERY_MS) return
  lastPurgeAt = now.getTime()
  try {
    const { databases } = createAdminClient()
    const old = await databases.listDocuments(DB_ID, COLLECTIONS.SCORE_CACHE, [
      Query.lessThan('$createdAt', scoreCacheCutoff(now)), Query.select(['$id']), Query.limit(100),
    ])
    await Promise.all(old.documents.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.SCORE_CACHE, d.$id)))
  } catch (err) {
    console.error('[score-cache] purge des notations périmées impossible', errorText(err))
  }
}
