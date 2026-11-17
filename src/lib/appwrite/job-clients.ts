import 'server-only'
import { createHash } from 'node:crypto'
import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { isEmptyClient, jobClientSchema, type JobClient } from '@/lib/client-response'

// Client d'une offre pour une organisation (collection `job_clients`, ADR 0040) : un document par offre et organisation,
// d'identifiant déduit des deux (une offre de la plateforme est partagée : chaque organisation a son client). Lu et écrit
// par le serveur seulement, après le contrôle d'accès à l'offre fait par l'appelant.

export const isJobClientsConfigured = () => !!COLLECTIONS.JOB_CLIENTS

/** Identifiant du document (36 caractères au plus, comme tout identifiant Appwrite). */
const docId = (tenantId: string, jobId: string) => `jc${createHash('sha256').update(`${tenantId}:${jobId}`).digest('hex').slice(0, 34)}`

/** Client enregistré ; null s'il n'y en a pas (ou si la collection n'est pas configurée). Une panne est levée. */
export async function getJobClient(tenantId: string, jobId: string): Promise<JobClient | null> {
  if (!isJobClientsConfigured()) return null
  try {
    const doc = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, docId(tenantId, jobId))
    if (doc.tenantId !== tenantId || doc.jobId !== jobId) return null
    const parsed = jobClientSchema.safeParse({ company: doc.company ?? '', contactName: doc.contactName ?? '', email: doc.email ?? '' })
    return parsed.success && !isEmptyClient(parsed.data) ? parsed.data : null
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) return null
    throw err
  }
}

/** Enregistre le client (déjà validé) ; tout vide : le retire. */
export async function saveJobClient(tenantId: string, jobId: string, client: JobClient): Promise<void> {
  const { databases } = createAdminClient()
  const id = docId(tenantId, jobId)
  if (isEmptyClient(client)) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, id).catch(err => {
      if (!(err instanceof AppwriteException && err.code === 404)) throw err
    })
    return
  }
  const data = { tenantId, jobId, ...client }
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, id, data)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, id, data)
    } catch (createErr) {
      // Créé entre-temps par un autre recruteur de l'organisation : le dernier enregistrement l'emporte.
      if (!(createErr instanceof AppwriteException && createErr.code === 409)) throw createErr
      await databases.updateDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, id, data)
    }
  }
}

/** Offre supprimée : ses clients (contacts) le sont aussi, toutes organisations. Jamais bloquant : un échec est journalisé. */
export async function deleteJobClients(jobId: string): Promise<void> {
  if (!isJobClientsConfigured()) return
  try {
    const { databases } = createAdminClient()
    const docs = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_CLIENTS, [Query.equal('jobId', jobId), Query.select(['$id']), Query.limit(100)])
    await Promise.all(docs.documents.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.JOB_CLIENTS, d.$id)))
  } catch (err) {
    console.error('[réponse client] client de l\'offre supprimée non effacé', jobId, err instanceof Error ? err.message : err)
  }
}
