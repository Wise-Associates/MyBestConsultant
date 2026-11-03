import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { listAllDocuments } from '@/lib/appwrite/list-all'
import type { OfferScore } from '@/lib/vivier-matching'
import { rowChanges, wantedRows, type VivierOfferMatchRow } from '@/lib/vivier-offer-matches'

// Lignes de vivier_offer_matches (ADR 0026, règles dans src/lib/vivier-offer-matches.ts) : correspondances des CV du
// vivier général aux offres, lues par le Matching IA de chaque offre.

const errorCode = (err: unknown) => (err as { code?: unknown } | null)?.code

export interface StoredVivierOfferMatch extends VivierOfferMatchRow {
  /** Date du dernier changement du score (ISO). */
  updatedAt: string
}

function docToRow(d: Models.Document): StoredVivierOfferMatch {
  return {
    tenantId: String(d.tenantId ?? ''), jobId: String(d.jobId ?? ''), vivierCvId: String(d.vivierCvId ?? ''),
    score: Number(d.score), reason: String(d.reason ?? ''), updatedAt: d.$updatedAt,
  }
}

/**
 * Collection lisible : vérifiée avant de prendre une place de quota et d'appeler l'IA pour comparer un CV, pour qu'une
 * collection absente (mise en place pas faite) n'use pas une comparaison payée dont les scores seraient perdus.
 */
export async function assertVivierOfferMatchesReady(): Promise<void> {
  if (!COLLECTIONS.VIVIER_OFFER_MATCHES) throw new Error('APPWRITE_COLLECTION_VIVIER_OFFER_MATCHES manquante (ADR 0026)')
  await createAdminClient().databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, [Query.limit(1), Query.select(['$id'])])
}

/**
 * Réécrit les lignes d'un CV d'après `scores`, ceux qui vont être enregistrés sur lui (offerMatchesJson). Appelée avant
 * l'enregistrement des scores : si elle échoue, les scores ne sont pas enregistrés et la prochaine comparaison la refait.
 */
export async function syncVivierOfferMatches(tenantId: string, vivierCvId: string, scores: OfferScore[]): Promise<void> {
  const { databases } = createAdminClient()
  const current = await listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, [Query.equal('vivierCvId', vivierCvId)])
  const { write, remove } = rowChanges(new Map(current.map(d => [d.$id, docToRow(d)])), wantedRows(tenantId, vivierCvId, scores))
  const existing = new Set(current.map(d => d.$id))
  await Promise.all([
    ...write.map(async ([id, row]) => {
      if (existing.has(id)) return databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, id, row)
      try {
        return await databases.createDocument(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, id, row)
      } catch (err) {
        // Créée entre-temps par une autre comparaison du même CV : la valeur de celle-ci, plus récente, l'emporte.
        if (errorCode(err) !== 409) throw err
        return databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, id, row)
      }
    }),
    ...remove.map(id => databases.deleteDocument(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, id).catch(err => {
      if (errorCode(err) !== 404) throw err
    })),
  ])
}

/** Supprime les lignes d'un CV (avant le CV lui-même). */
export async function deleteVivierOfferMatchesOf(vivierCvId: string): Promise<void> {
  const { databases } = createAdminClient()
  const rows = await listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, [Query.equal('vivierCvId', vivierCvId), Query.select(['$id'])])
  await Promise.all(rows.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, d.$id).catch(err => {
    if (errorCode(err) !== 404) throw err
  })))
}

/** CV du vivier général de l'organisation qui correspondent à l'offre, toutes les lignes (par l'index de l'offre). */
export async function listVivierOfferMatches(jobId: string, tenantId: string): Promise<StoredVivierOfferMatch[]> {
  const { databases } = createAdminClient()
  const rows = await listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_OFFER_MATCHES, [
    Query.equal('jobId', jobId), Query.equal('tenantId', tenantId),
  ])
  return rows.map(docToRow)
}
