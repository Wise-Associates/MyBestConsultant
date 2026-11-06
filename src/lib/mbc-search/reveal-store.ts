import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { MbcRevealed } from './rules'
import { parseRevealDoc, revealCutoff, revealDocId, revealJson } from './reveals'

// Profils complets révélés par une organisation (collection mbc_reveals, sans permission client) : relus pour ne pas
// payer deux fois la même personne, supprimés après MBC_REVEAL_RETENTION_DAYS jours. Toute lecture filtre sur
// l'organisation de la session. Personnes déjà dans le vivier du recruteur : lues dans vivier_cvs (`apolloId`).

export const isMbcRevealStoreConfigured = () => !!COLLECTIONS.MBC_REVEALS

const codeOf = (err: unknown) => (err as { code?: number }).code

/** Profils de ces personnes déjà révélés par l'organisation et encore conservés. */
export async function storedReveals(tenantId: string, apolloIds: string[], now: Date): Promise<MbcRevealed[]> {
  if (!isMbcRevealStoreConfigured() || apolloIds.length === 0) return []
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.MBC_REVEALS, [
    Query.equal('tenantId', tenantId), Query.equal('apolloId', apolloIds), Query.limit(apolloIds.length),
  ])
  return res.documents.flatMap(d => parseRevealDoc(d as unknown as Record<string, unknown>, now) ?? [])
}

/** Garde les profils qui viennent d'être payés (même personne révélée deux fois en même temps : mise à jour). */
export async function saveReveals(tenantId: string, userId: string, profiles: MbcRevealed[], now: Date): Promise<void> {
  if (!isMbcRevealStoreConfigured()) return
  const { databases } = createAdminClient()
  for (const p of profiles) {
    const id = revealDocId(tenantId, p.id)
    const data = { profileJson: revealJson(p), revealedBy: userId, revealedAt: now.toISOString() }
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.MBC_REVEALS, id, { ...data, tenantId, apolloId: p.id })
    } catch (err) {
      if (codeOf(err) !== 409) throw err
      await databases.updateDocument(DB_ID, COLLECTIONS.MBC_REVEALS, id, data)
    }
  }
}

/**
 * Personnes déjà dans un vivier du recruteur (général : « general », sinon l'offre), d'après l'identifiant Apollo
 * enregistré à l'ajout. Un vivier est personnel : seuls les CV de ce recruteur comptent.
 */
export async function vivierTargetsOf(tenantId: string, recruiterId: string, apolloIds: string[]): Promise<Record<string, string[]>> {
  if (apolloIds.length === 0) return {}
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [
    Query.equal('tenantId', tenantId), Query.equal('recruiterId', recruiterId), Query.equal('apolloId', apolloIds),
    Query.select(['apolloId', 'jobId']), Query.limit(100),
  ])
  const out: Record<string, string[]> = {}
  for (const d of res.documents) {
    const id = typeof d.apolloId === 'string' ? d.apolloId : ''
    if (id) (out[id] ??= []).push(typeof d.jobId === 'string' && d.jobId ? d.jobId : 'general')
  }
  return out
}

/** Supprime les profils révélés plus anciens que la durée de conservation, jusqu'à `deadline` (ms). */
export async function purgeExpiredReveals(now: Date, deadline: number): Promise<number> {
  if (!isMbcRevealStoreConfigured()) return 0
  const { databases } = createAdminClient()
  let deleted = 0
  for (;;) {
    let page: Models.DocumentList<Models.Document>
    try {
      page = await databases.listDocuments(DB_ID, COLLECTIONS.MBC_REVEALS, [
        Query.lessThan('revealedAt', revealCutoff(now).toISOString()), Query.select(['$id']), Query.limit(100),
      ])
    } catch (err) {
      if ((err as { type?: string }).type !== 'collection_not_found') throw err
      console.warn('[mbc-search] collection des profils révélés absente : rien à purger')
      return deleted
    }
    for (const d of page.documents) {
      await databases.deleteDocument(DB_ID, COLLECTIONS.MBC_REVEALS, d.$id).catch(e => { if (codeOf(e) !== 404) throw e })
      deleted++
    }
    if (page.documents.length < 100 || Date.now() > deadline) return deleted
  }
}
