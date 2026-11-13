import 'server-only'
import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { offerOf, type PlanOffer } from '@/lib/plan-offers'

// Offres sur mesure en base (collection plan_offers, ADR 0034) : un document par organisation, d'identifiant celui de
// l'organisation, lu et écrit par le serveur seulement. Règles : plan-offers.ts.

export const isPlanOffersConfigured = () => !!COLLECTIONS.PLAN_OFFERS

// Document absent seulement : une collection ou une base introuvable (variable posée avant la création de la collection,
// faute de frappe) est une panne, qui remonte, et non « aucune offre » (droits standard donnés sans rien dire).
const isNotFound = (err: unknown) => (err as { type?: string } | null)?.type === 'document_not_found'

/** Offre de l'organisation ; null si aucune, si la collection n'est pas configurée ou si le document est illisible (journalisé). */
export async function loadOffer(tenantId: string): Promise<PlanOffer | null> {
  if (!isPlanOffersConfigured()) return null
  try {
    const doc = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.PLAN_OFFERS, tenantId)
    const offer = offerOf(doc as unknown as Record<string, unknown>)
    if (!offer) console.error('[offres] offre sur mesure illisible', tenantId)
    return offer
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Offres de plusieurs organisations (liste de l'admin, passage planifié des boîtes AO). */
export async function loadOffers(tenantIds: string[]): Promise<Map<string, PlanOffer>> {
  const offers = new Map<string, PlanOffer>()
  if (!isPlanOffersConfigured() || tenantIds.length === 0) return offers
  const { databases } = createAdminClient()
  const ids = [...new Set(tenantIds)]
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.PLAN_OFFERS, [Query.equal('$id', batch), Query.limit(batch.length)])
    for (const doc of res.documents) {
      const offer = offerOf(doc as unknown as Record<string, unknown>)
      if (offer) offers.set(doc.$id, offer)
      else console.error('[offres] offre sur mesure illisible', doc.$id)
    }
  }
  return offers
}

/** Écrit (ou remplace) l'offre de l'organisation en entier. `data` : offerDocument ou acceptedDocument (plan-offers.ts). */
export async function writeOffer(tenantId: string, data: Record<string, unknown>): Promise<void> {
  const { databases } = createAdminClient()
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.PLAN_OFFERS, tenantId, data)
  } catch (err) {
    if (!isNotFound(err)) throw err
    await databases.createDocument(DB_ID, COLLECTIONS.PLAN_OFFERS, tenantId, data)
  }
}

export async function withdrawOffer(tenantId: string): Promise<void> {
  await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.PLAN_OFFERS, tenantId, { status: 'withdrawn' })
}
