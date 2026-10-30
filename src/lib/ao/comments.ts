import 'server-only'
import { ID, Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { batchByLength } from './repo'

// Commentaires internes sur une offre AO (collection AO_COMMENTS, sans permission client) : notes de suivi des
// utilisateurs de l'organisation de l'offre (la plateforme pour l'instant). Ils peuvent contenir des données
// personnelles : purgés avec les e-mails et offres AO (365 jours, purgeAoRecords).

export interface AoComment {
  $id: string
  offerId: string
  tenantId: string
  authorId: string
  /** Nom de l'auteur au moment du commentaire. */
  authorName: string
  body: string
  createdAt: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function docToComment(d: Models.Document): AoComment {
  const doc = d as Models.Document & Record<string, unknown>
  return { $id: d.$id, offerId: str(doc.offerId), tenantId: str(doc.tenantId), authorId: str(doc.authorId), authorName: str(doc.authorName), body: str(doc.body), createdAt: d.$createdAt }
}

/** Erreur explicite si la collection n'est pas configurée (fonction facultative : le reste d'AO Offers marche sans). */
function collection(): string {
  if (!COLLECTIONS.AO_COMMENTS) throw new Error('Commentaires indisponibles : créez la collection (npm run ao:setup) et définissez APPWRITE_COLLECTION_AO_COMMENTS.')
  return COLLECTIONS.AO_COMMENTS
}

/** Commentaires d'une offre, du plus ancien au plus récent (200 au plus). */
export async function listAoComments(offerId: string): Promise<AoComment[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [Query.equal('offerId', offerId), Query.orderAsc('$createdAt'), Query.limit(200)])
  return res.documents.map(docToComment)
}

/**
 * Nombre de commentaires de chaque offre (absente : aucun). Collection non configurée : aucun compte, le tableau des
 * offres s'affiche quand même (fonction facultative). Seul l'identifiant d'offre de chaque commentaire est lu.
 */
export async function countAoComments(offerIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!COLLECTIONS.AO_COMMENTS) return counts
  const { databases } = createAdminClient()
  // Lots lus en parallèle : chaque appel à Appwrite coûte un aller-retour réseau.
  await Promise.all(batchByLength([...new Set(offerIds.filter(Boolean))]).map(async batch => {
    let cursor: string | null = null
    for (;;) {
      const res: Models.DocumentList<Models.Document> = await databases.listDocuments(DB_ID, COLLECTIONS.AO_COMMENTS, [
        Query.equal('offerId', batch), Query.select(['$id', 'offerId']), Query.orderAsc('$id'), Query.limit(500),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ])
      for (const doc of res.documents) counts.set(String(doc.offerId), (counts.get(String(doc.offerId)) ?? 0) + 1)
      if (res.documents.length < 500) return
      cursor = res.documents[res.documents.length - 1].$id
    }
  }))
  return counts
}

export async function getAoComment(id: string): Promise<AoComment | null> {
  const { databases } = createAdminClient()
  try {
    return docToComment(await databases.getDocument(DB_ID, collection(), id))
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null
    throw err
  }
}

export async function createAoComment(data: Omit<AoComment, '$id' | 'createdAt'>): Promise<AoComment> {
  const { databases } = createAdminClient()
  return docToComment(await databases.createDocument(DB_ID, collection(), ID.unique(), {
    offerId: data.offerId, tenantId: data.tenantId, authorId: data.authorId, authorName: data.authorName.slice(0, 200), body: data.body,
  }))
}

export async function deleteAoComment(id: string): Promise<void> {
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, collection(), id)
}

/** Supprime tous les commentaires d'une offre (offre supprimée) ; rien à faire sans la collection des commentaires. */
export async function deleteAoCommentsOfOffer(offerId: string): Promise<void> {
  if (!COLLECTIONS.AO_COMMENTS) return
  const { databases } = createAdminClient()
  for (;;) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.AO_COMMENTS, [Query.equal('offerId', offerId), Query.select(['$id']), Query.limit(100)])
    if (!res.documents.length) return
    for (const doc of res.documents) {
      await databases.deleteDocument(DB_ID, COLLECTIONS.AO_COMMENTS, doc.$id).catch(err => { if ((err as { code?: number }).code !== 404) throw err })
    }
  }
}
