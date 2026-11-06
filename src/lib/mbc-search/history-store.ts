import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { savedSearchName, type MbcCriteria } from './rules'
import { SAVED_SEARCHES_MAX, SEARCH_HISTORY_MAX, historyOverflow, parseSearchDoc, searchDocId, type MbcSearchEntry } from './history'

// Historique des recherches de MBC Search dans Appwrite (collection mbc_searches, sans permission client : seul le
// serveur la lit). Toute lecture et toute écriture portent sur le compte du recruteur de la session (`userId`, compte
// Auth comme les conversations de l'assistant), vérifié sur le document : celui d'un autre est « introuvable ».

export const isMbcHistoryConfigured = () => !!COLLECTIONS.MBC_SEARCHES

export class MbcHistoryError extends Error {}

function collection(): string {
  if (!COLLECTIONS.MBC_SEARCHES) throw new MbcHistoryError('Historique indisponible : APPWRITE_COLLECTION_MBC_SEARCHES non définie.')
  return COLLECTIONS.MBC_SEARCHES
}

const codeOf = (err: unknown) => (err as { code?: number }).code
const typeOf = (err: unknown) => (err as { type?: string }).type

/** Historique du recruteur, plus récente d'abord (enregistrées comprises). */
export async function listMbcSearches(userId: string): Promise<MbcSearchEntry[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [
    Query.equal('userId', userId),
    Query.orderDesc('lastRunAt'),
    // Au plus SEARCH_HISTORY_MAX non enregistrées + SAVED_SEARCHES_MAX enregistrées ; marge pour une écriture concurrente.
    Query.limit(SEARCH_HISTORY_MAX + SAVED_SEARCHES_MAX + 10),
  ])
  return res.documents.flatMap(d => parseSearchDoc(d as unknown as Record<string, unknown>) ?? [])
}

async function ownDoc(userId: string, id: string): Promise<Models.Document | null> {
  const { databases } = createAdminClient()
  try {
    const doc = await databases.getDocument(DB_ID, collection(), id)
    return doc.userId === userId ? doc : null
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
}

/**
 * Note une recherche lancée (première page) : crée sa ligne ou met à jour la ligne des mêmes critères (brief, nombre de
 * résultats, date), sans toucher à son nom ni à son épinglage. Puis supprime les lignes non enregistrées les plus anciennes
 * au-delà de SEARCH_HISTORY_MAX.
 */
export async function recordMbcSearch(input: {
  userId: string; tenantId: string; brief: string; criteria: MbcCriteria; total: number; now: Date
}): Promise<MbcSearchEntry> {
  const { databases } = createAdminClient()
  const id = searchDocId(input.userId, input.criteria)
  const data = {
    brief: input.brief,
    criteriaJson: JSON.stringify(input.criteria),
    total: Math.max(0, Math.min(input.total, 2_000_000_000)),
    lastRunAt: input.now.toISOString(),
  }
  let doc: Models.Document
  try {
    doc = await databases.updateDocument(DB_ID, collection(), id, data)
  } catch (err) {
    if (codeOf(err) !== 404) throw err
    try {
      doc = await databases.createDocument(DB_ID, collection(), id, {
        ...data, userId: input.userId, tenantId: input.tenantId, name: savedSearchName(input.criteria), pinned: false,
      })
    } catch (e) {
      // Même recherche lancée deux fois en même temps : l'autre l'a créée, on la met à jour.
      if (codeOf(e) !== 409) throw e
      doc = await databases.updateDocument(DB_ID, collection(), id, data)
    }
  }
  const entry = parseSearchDoc(doc as unknown as Record<string, unknown>)
  if (!entry) throw new MbcHistoryError('Recherche enregistrée illisible.')
  try {
    for (const old of historyOverflow(await listMbcSearches(input.userId))) {
      await databases.deleteDocument(DB_ID, collection(), old).catch(e => { if (codeOf(e) !== 404) throw e })
    }
  } catch (err) {
    // La recherche est notée ; l'historique dépasse seulement la limite jusqu'à la prochaine recherche.
    console.error('[mbc-search] nettoyage de l\'historique impossible', err instanceof Error ? err.message : String(err))
  }
  return entry
}

/** Enregistre (avec un nom) ou retire des recherches enregistrées ; 20 enregistrées au plus. Null : introuvable. */
export async function setMbcSearchPinned(userId: string, id: string, pinned: boolean, name?: string): Promise<MbcSearchEntry | 'full' | null> {
  const doc = await ownDoc(userId, id)
  if (!doc) return null
  if (pinned && doc.pinned !== true) {
    const { databases } = createAdminClient()
    const count = await databases.listDocuments(DB_ID, collection(), [
      Query.equal('userId', userId), Query.equal('pinned', true), Query.select(['$id']), Query.limit(SAVED_SEARCHES_MAX),
    ])
    if (count.total >= SAVED_SEARCHES_MAX) return 'full'
  }
  const { databases } = createAdminClient()
  const updated = await databases.updateDocument(DB_ID, collection(), id, { pinned, ...(name ? { name } : {}) })
  return parseSearchDoc(updated as unknown as Record<string, unknown>)
}

/** Supprime une ligne de l'historique du recruteur ; false : introuvable. */
export async function deleteMbcSearch(userId: string, id: string): Promise<boolean> {
  if (!(await ownDoc(userId, id))) return false
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, collection(), id).catch(e => { if (codeOf(e) !== 404) throw e })
  return true
}

/**
 * Supprime tout l'historique d'un compte (suppression du compte, retrait d'un membre : RGPD). Collection absente
 * (variable définie avant sa création) : rien n'est stocké, donc rien à supprimer.
 */
export async function deleteMbcSearchesForUser(userId: string): Promise<void> {
  if (!isMbcHistoryConfigured()) return
  const { databases } = createAdminClient()
  for (;;) {
    let page: Models.DocumentList<Models.Document>
    try {
      page = await databases.listDocuments(DB_ID, collection(), [Query.equal('userId', userId), Query.select(['$id']), Query.limit(100)])
    } catch (err) {
      if (typeOf(err) !== 'collection_not_found') throw err
      console.warn('[mbc-search] collection de l\'historique absente : rien à supprimer')
      return
    }
    for (const doc of page.documents) {
      await databases.deleteDocument(DB_ID, collection(), doc.$id).catch(e => { if (codeOf(e) !== 404) throw e })
    }
    if (page.documents.length < 100) return
  }
}
