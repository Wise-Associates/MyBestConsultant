import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { nextScraperStatus, SCRAPER_SITES, type ScraperSite, type ScraperStatus, type ScraperStatusReport } from './scraper-status'

// État de session des sites du scraper d'appels d'offres (collection scraper_status, aucune permission client ;
// ADR 0048) : un document par site connu (SCRAPER_SITES), identifié par sa clé. Un état et deux dates : rien d'autre.

export function isScraperStatusStorageConfigured(): boolean {
  return Boolean(COLLECTIONS.SCRAPER_STATUS)
}

const codeOf = (err: unknown) => (err as { code?: number }).code

/** Document relu : un document écrit à la main ou par une autre version est écarté (et journalisé), pas affiché faux. */
const StoredDocument = z.object({
  $id: z.enum(Object.keys(SCRAPER_SITES) as [ScraperSite, ...ScraperSite[]]),
  state: z.enum(['ok', 'session_expired']),
  since: z.string(),
  checkedAt: z.string(),
})

function toStatus(doc: Models.Document): ScraperStatus | null {
  const parsed = StoredDocument.safeParse(doc)
  if (!parsed.success) {
    console.error('[scraper] état de session illisible, ignoré', doc.$id)
    return null
  }
  const { $id, ...status } = parsed.data
  return { site: $id, ...status }
}

/**
 * Enregistre l'état reçu ; `false` s'il n'apporte rien (pas plus récent que l'état gardé). Le scraper n'envoie qu'un
 * état à la fois (un passage à la fois) : pas de course entre la lecture et l'écriture.
 */
export async function saveScraperStatus(report: ScraperStatusReport): Promise<boolean> {
  const { databases } = createAdminClient()
  let exists = true
  let stored: ScraperStatus | null = null
  try {
    stored = toStatus(await databases.getDocument(DB_ID, COLLECTIONS.SCRAPER_STATUS, report.site))
  } catch (err) {
    if (codeOf(err) !== 404) throw err
    exists = false
  }
  const next = nextScraperStatus(stored, report)
  if (!next) return false
  const data = { state: next.state, since: next.since, checkedAt: next.checkedAt }
  // Un document illisible existe : il est remplacé par la mise à jour.
  if (exists) {
    await databases.updateDocument(DB_ID, COLLECTIONS.SCRAPER_STATUS, report.site, data)
    return true
  }
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.SCRAPER_STATUS, report.site, data)
  } catch (err) {
    // Créé entre la lecture et l'écriture : mis à jour.
    if (codeOf(err) !== 409) throw err
    await databases.updateDocument(DB_ID, COLLECTIONS.SCRAPER_STATUS, report.site, data)
  }
  return true
}

/** États gardés (un par site du scraper : une poignée). */
export async function listScraperStatuses(): Promise<ScraperStatus[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.SCRAPER_STATUS, [Query.limit(50)])
  return res.documents.map(toStatus).filter((status): status is ScraperStatus => status !== null)
}
