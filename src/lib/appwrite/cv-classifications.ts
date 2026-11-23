import { createHash } from 'node:crypto'
import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import type { CvClassification } from '@/lib/cv-classification'
import { isJobFamily, type JobFamily } from '@/lib/job-families'
import { listAllByValues } from './list-all'
import { removeCvFromIndex } from '@/lib/search/cv-index'

// Classifications des CV (collection `cv_classifications`, ADR 0044) : une par CV source — candidat ou profil de chasseur
// (`users`), CV du vivier (`vivier_cvs`) —, d'identifiant déduit de la source. Effacée avec sa source (suppression d'un
// compte, d'un profil de chasseur, d'un CV du vivier) ; `npm run cv:classify` efface aussi celles dont la source n'existe
// plus. Serveur seulement, aucune permission client (pas de marqueur « server-only » : chargé aussi par ce script).

export type ClassifiedKind = 'candidate' | 'vivier'

export const isCvClassificationsConfigured = () => !!COLLECTIONS.CV_CLASSIFICATIONS

/** Identifiant du document (36 caractères au plus), le même à chaque nouvelle classification de la source. */
export const classificationId = (kind: ClassifiedKind, sourceId: string) =>
  `cl${createHash('sha256').update(`${kind}:${sourceId}`).digest('hex').slice(0, 34)}`

/** Version de CV, version des consignes et modèle (« rules-v1 » : par les règles) de la classification enregistrée ; null s'il n'y en a pas. */
export async function storedClassificationVersion(kind: ClassifiedKind, sourceId: string): Promise<{ sourceKey: string; version: number; model: string } | null> {
  try {
    const doc = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, classificationId(kind, sourceId))
    return { sourceKey: String(doc.sourceKey ?? ''), version: Number(doc.version ?? 0), model: String(doc.model ?? '') }
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) return null
    throw err
  }
}

export interface ClassificationRecord {
  kind: ClassifiedKind
  sourceId: string
  /** Organisation qui voit le CV (vivier) ; vide pour la base candidats et les profils de chasseurs. */
  tenantId: string
  /** Recruteur du vivier (profil) ou chasseur (compte) du profil ; vide pour un candidat. */
  ownerId: string
  sourceKey: string
  model: string
  classification: CvClassification
}

/** Famille de métier enregistrée dans une classification ; null si illisible. */
function jobFamilyOfData(data: unknown): JobFamily | null {
  try {
    const parsed: unknown = JSON.parse(String(data ?? ''))
    const family = parsed && typeof parsed === 'object' ? (parsed as { jobFamily?: unknown }).jobFamily : null
    return isJobFamily(family) ? family : null
  } catch {
    return null
  }
}

/**
 * Familles de métiers des candidats classés, pour le filtre « Métier » de la CV Thèque et des recherches enregistrées
 * (ADR 0057). Un candidat absent de la carte n'est pas (encore) classé. Classification désactivée : carte vide.
 * Lève si la lecture échoue : l'appelant choisit (liste sans le filtre, alerte rattrapée par le cron).
 */
export async function candidateJobFamilies(candidateIds: string[]): Promise<Map<string, JobFamily>> {
  const families = new Map<string, JobFamily>()
  if (!isCvClassificationsConfigured() || candidateIds.length === 0) return families
  const sourceOf = new Map(candidateIds.map(id => [classificationId('candidate', id), id]))
  const docs = await listAllByValues(createAdminClient().databases, DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, '$id', [...sourceOf.keys()], [
    Query.select(['$id', 'data']),
  ])
  for (const doc of docs) {
    const source = sourceOf.get(doc.$id)
    const family = jobFamilyOfData(doc.data)
    if (source && family) families.set(source, family)
  }
  return families
}

/** Enregistre (ou remplace) la classification d'une source. */
export async function saveClassification(record: ClassificationRecord): Promise<void> {
  const { databases } = createAdminClient()
  const id = classificationId(record.kind, record.sourceId)
  const data = {
    kind: record.kind, sourceId: record.sourceId, tenantId: record.tenantId, ownerId: record.ownerId,
    sourceKey: record.sourceKey, version: record.classification.version, model: record.model,
    data: JSON.stringify(record.classification),
  }
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, id, data)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, id, data)
    } catch (createErr) {
      // Créée entre-temps par une classification simultanée de la même source : la plus récente l'emporte.
      if (!(createErr instanceof AppwriteException && createErr.code === 409)) throw createErr
      await databases.updateDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, id, data)
    }
  }
}

/** Efface la classification d'une source supprimée. Jamais bloquant : un échec est journalisé (le script la rattrape). */
export async function deleteClassification(kind: ClassifiedKind, sourceId: string): Promise<void> {
  if (!isCvClassificationsConfigured()) return
  const id = classificationId(kind, sourceId)
  // L'index de recherche d'abord (jamais bloquant) : un document resté sans classification serait encore proposé.
  await removeCvFromIndex(id)
  try {
    await createAdminClient().databases.deleteDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, id)
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) return
    console.error('[classification] classification d\'un CV supprimé non effacée', kind, sourceId, err instanceof Error ? err.message : err)
  }
}
