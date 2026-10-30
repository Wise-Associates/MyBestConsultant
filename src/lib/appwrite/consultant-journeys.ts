import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { parseJourney, type JourneyState } from '@/lib/consultant-journey'

// Parcours consultant enregistrés (collection CONSULTANT_JOURNEYS, sans permission client, ADR 0021) : un document
// par candidature, de même identifiant, ce qui empêche deux parcours pour une même candidature. Les règles sont dans
// src/lib/consultant-journey.ts ; ici, seulement la lecture et l'écriture.

export interface StoredJourney {
  applicationId: string
  tenantId: string
  jobId: string
  candidateId: string
  /** null : contenu illisible (parcours affiché en erreur, non modifiable). */
  journey: JourneyState | null
  /** Compteur de modifications : une action envoyée sur une version périmée est refusée. */
  version: number
  updatedAt: string
}

export class JourneyConflictError extends Error {
  constructor() {
    super('Le parcours a été modifié entre-temps : la page a été rechargée, refaites votre action.')
  }
}

export const isJourneyStoreConfigured = () => Boolean(COLLECTIONS.CONSULTANT_JOURNEYS)

function collection(): string {
  if (!COLLECTIONS.CONSULTANT_JOURNEYS) {
    throw new Error('Parcours consultant indisponible : créez la collection (npm run schema:push -- dev) et définissez APPWRITE_COLLECTION_CONSULTANT_JOURNEYS.')
  }
  return COLLECTIONS.CONSULTANT_JOURNEYS
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function docToJourney(d: Models.Document): StoredJourney {
  const doc = d as Models.Document & Record<string, unknown>
  return {
    applicationId: d.$id,
    tenantId: str(doc.tenantId),
    jobId: str(doc.jobId),
    candidateId: str(doc.candidateId),
    journey: parseJourney(doc.stage, doc.status, doc.piecesJson, doc.historyJson),
    version: typeof doc.version === 'number' ? doc.version : 0,
    updatedAt: d.$updatedAt,
  }
}

const isNotFound = (err: unknown) => (err as { code?: number }).code === 404
const isConflict = (err: unknown) => (err as { code?: number }).code === 409

/** Parcours d'une candidature (null : pas encore démarré). Ne vérifie pas l'organisation : à faire par l'appelant. */
export async function getJourney(applicationId: string): Promise<StoredJourney | null> {
  const { databases } = createAdminClient()
  try {
    return docToJourney(await databases.getDocument(DB_ID, collection(), applicationId))
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Parcours de l'organisation, les plus récemment modifiés d'abord (200 au plus). */
export async function listTenantJourneys(tenantId: string): Promise<StoredJourney[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, collection(), [
    Query.equal('tenantId', tenantId), Query.orderDesc('$updatedAt'), Query.limit(200),
  ])
  return res.documents.map(docToJourney)
}

function fields(journey: JourneyState) {
  return {
    stage: journey.stage,
    status: journey.status,
    piecesJson: JSON.stringify(journey.pieces),
    historyJson: JSON.stringify(journey.history),
  }
}

/** Démarre le parcours d'une candidature ; JourneyConflictError s'il existe déjà (double clic, deux onglets). */
export async function createJourney(input: {
  applicationId: string; tenantId: string; jobId: string; candidateId: string; journey: JourneyState
}): Promise<void> {
  const { databases } = createAdminClient()
  try {
    await databases.createDocument(DB_ID, collection(), input.applicationId, {
      tenantId: input.tenantId, jobId: input.jobId, candidateId: input.candidateId, version: 1, ...fields(input.journey),
    })
  } catch (err) {
    if (isConflict(err)) throw new JourneyConflictError()
    throw err
  }
}

/**
 * Enregistre le parcours si personne ne l'a modifié depuis `expectedVersion`. Appwrite 1.7 n'a pas de mise à jour
 * conditionnelle : la version est relue juste avant d'écrire, ce qui réduit la fenêtre sans la fermer tout à fait
 * (deux clics à quelques millisecondes d'écart peuvent encore passer ; le dernier gagne).
 */
export async function updateJourney(applicationId: string, expectedVersion: number, journey: JourneyState): Promise<number> {
  const { databases } = createAdminClient()
  const current = docToJourney(await databases.getDocument(DB_ID, collection(), applicationId))
  if (current.version !== expectedVersion) throw new JourneyConflictError()
  const version = expectedVersion + 1
  await databases.updateDocument(DB_ID, collection(), applicationId, { version, ...fields(journey) })
  return version
}

/** Supprime le parcours d'une candidature supprimée (rien à faire s'il n'y en a pas ou si la collection manque). */
export async function deleteJourney(applicationId: string): Promise<void> {
  if (!isJourneyStoreConfigured()) return
  const { databases } = createAdminClient()
  await databases.deleteDocument(DB_ID, collection(), applicationId).catch(err => { if (!isNotFound(err)) throw err })
}
