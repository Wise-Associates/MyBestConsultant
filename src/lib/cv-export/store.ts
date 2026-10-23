import 'server-only'
import { AppwriteException, ID, Query, type Models } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { CvExportError, type CvExportDocx } from './export'
import { parseStoredExport, serializeNotes, type StoredCvExport } from './stored'
import type { AnonymizationMode, CvLang } from './types'

// Versions enregistrées des exports au format ESN (ADR 0009) : collection `cv_exports` (un document par candidat,
// anonymisation et langue, index unique) et bucket privé `cv_exports` (les .docx), créés par
// `npm run cv-export:setup`. Aucune permission client : seule la clé API serveur y accède, depuis la route admin
// /api/admin/cv-export et les actions de la CV Thèque. Facultatif : sans les deux variables, rien n'est enregistré.

export const isCvExportStorageConfigured = () => !!COLLECTIONS.CV_EXPORTS && !!BUCKETS.CV_EXPORTS

const MODES: AnonymizationMode[] = ['standard', 'renforcee']
const LANGS: CvLang[] = ['fr', 'en']

// Nom du fichier dans le bucket (le nom téléchargé est celui du document) : sans donnée personnelle, et retrouvable
// par candidat pour la suppression avec le compte, même quand plus aucun document ne le référence (voir saveCvExports).
const storageName = (candidateId: string, mode: AnonymizationMode, lang: CvLang) => `${candidateId}_${mode}_${lang}.docx`

// Par type et non par code : un bucket ou une collection introuvable (configuration) répond aussi 404.
const isAppwrite = (err: unknown, type: string) => err instanceof AppwriteException && err.type === type
const isConflict = (err: unknown) => err instanceof AppwriteException && err.code === 409

/** Nature d'une erreur pour les journaux (type et code Appwrite), sans son message. */
export const cvExportErrorName = (err: unknown) =>
  err instanceof AppwriteException ? `${err.type} ${err.code}` : err instanceof Error ? err.name : 'inconnue'

/** Collection ou bucket des exports introuvable : variables définies sans `npm run cv-export:setup` sur ce projet. */
export const isCvExportStorageMissing = (err: unknown) =>
  isAppwrite(err, 'collection_not_found') || isAppwrite(err, 'storage_bucket_not_found')

async function listDocs(candidateId: string): Promise<Models.Document[]> {
  const { databases } = createAdminClient()
  // 4 versions au plus (2 anonymisations × 2 langues) : la marge couvre des doublons écrits à la main.
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.CV_EXPORTS, [Query.equal('candidateId', candidateId), Query.limit(25)])
  return res.documents
}

export async function listCvExports(candidateId: string): Promise<StoredCvExport[]> {
  return (await listDocs(candidateId)).flatMap(doc => {
    const stored = parseStoredExport(doc)
    if (!stored) console.warn('[cv-export] version enregistrée incomplète, ignorée', doc.$id)
    return stored ? [stored] : []
  })
}

async function deleteFileIfPresent(fileId: string): Promise<void> {
  const { storage } = createAdminClient()
  try {
    await storage.deleteFile(BUCKETS.CV_EXPORTS, fileId)
  } catch (err) {
    if (!isAppwrite(err, 'storage_file_not_found')) throw err
  }
}

/**
 * Enregistre les fichiers d'une génération, chacun à la place de la version précédente de même anonymisation et
 * langue. `candidate-gone` : candidat supprimé pendant la génération (1 à 3 min), rien n'est gardé.
 */
export async function saveCvExports(input: {
  candidateId: string
  mode: AnonymizationMode
  sourceCvFileId: string
  notes: string[]
  files: CvExportDocx[]
  now: Date
}): Promise<'saved' | 'candidate-gone'> {
  const { databases, storage } = createAdminClient()
  const candidateExists = async () => {
    try {
      await databases.getDocument(DB_ID, COLLECTIONS.USERS, input.candidateId)
      return true
    } catch (err) {
      if (isAppwrite(err, 'document_not_found')) return false
      throw err
    }
  }
  if (!(await candidateExists())) return 'candidate-gone'

  const notes = serializeNotes(input.notes)
  for (const file of input.files) {
    const uploaded = await storage.createFile(BUCKETS.CV_EXPORTS, ID.unique(),
      InputFile.fromBuffer(Buffer.from(file.bytes), storageName(input.candidateId, input.mode, file.lang)))
    const data = {
      candidateId: input.candidateId, mode: input.mode, lang: file.lang, fileId: uploaded.$id, fileName: file.fileName,
      sourceCvFileId: input.sourceCvFileId, notes, generatedAt: input.now.toISOString(),
    }
    // Documents bruts, pas seulement ceux que parseStoredExport accepte : un document incomplet (modifié à la main) est
    // remplacé ; ignoré, il bloquerait cette version pour toujours (index unique).
    const findCurrent = async () => (await listDocs(input.candidateId)).find(d => d.mode === input.mode && d.lang === file.lang)
    const fileIdOf = (doc: Models.Document) => (typeof doc.fileId === 'string' && doc.fileId ? doc.fileId : undefined)

    let previousFileId: string | undefined
    try {
      const current = await findCurrent()
      if (current) {
        await databases.updateDocument(DB_ID, COLLECTIONS.CV_EXPORTS, current.$id, data)
        previousFileId = fileIdOf(current)
      } else {
        try {
          await databases.createDocument(DB_ID, COLLECTIONS.CV_EXPORTS, ID.unique(), data)
        } catch (err) {
          // Même version enregistrée entre-temps par une autre génération (index unique) : celle-ci la remplace.
          const raced = isConflict(err) ? await findCurrent() : undefined
          if (!raced) throw err
          await databases.updateDocument(DB_ID, COLLECTIONS.CV_EXPORTS, raced.$id, data)
          previousFileId = fileIdOf(raced)
        }
      }
    } catch (err) {
      await deleteFileIfPresent(uploaded.$id).catch(cleanupErr =>
        console.error('[cv-export] fichier non référencé laissé dans le bucket', uploaded.$id, cvExportErrorName(cleanupErr)))
      throw err
    }

    // La nouvelle version est enregistrée : un ancien fichier non supprimé ici (ou laissé par deux générations
    // simultanées) n'est plus référencé, et sera supprimé avec le compte du candidat (recherche par nom).
    if (previousFileId) {
      await deleteFileIfPresent(previousFileId).catch(err =>
        console.error('[cv-export] ancienne version non supprimée du bucket', previousFileId, cvExportErrorName(err)))
    }
  }

  // Candidat supprimé pendant l'écriture : sa suppression (deleteUserAccount) a pu passer entre la vérification du début
  // et ces documents. Vérifié après coup, la course est fermée : soit son second passage voit ces documents, soit
  // cette vérification voit la suppression.
  if (!(await candidateExists())) {
    await deleteCvExportsForCandidate(input.candidateId)
    return 'candidate-gone'
  }
  return 'saved'
}

/** Fichiers des versions demandées ; une version dont le fichier a disparu est à régénérer. */
export async function readCvExportFiles(versions: StoredCvExport[]): Promise<CvExportDocx[]> {
  const { storage } = createAdminClient()
  return Promise.all(versions.map(async v => {
    try {
      return { lang: v.lang, fileName: v.fileName, bytes: new Uint8Array(await storage.getFileDownload(BUCKETS.CV_EXPORTS, v.fileId)) }
    } catch (err) {
      if (isAppwrite(err, 'storage_file_not_found')) {
        throw new CvExportError('Fichier de la version enregistrée introuvable : générez une nouvelle version.', 404, { cause: err })
      }
      throw err
    }
  }))
}

/**
 * Suppression avec le compte du candidat (RGPD) : fichiers d'abord, y compris ceux qu'aucun document ne référence
 * plus, puis documents. Un échec est levé : l'appelant ne supprime pas le compte, l'admin recommence.
 */
export async function deleteCvExportsForCandidate(candidateId: string): Promise<void> {
  const { databases, storage } = createAdminClient()
  const docs = await listDocs(candidateId)
  for (const doc of docs) {
    if (typeof doc.fileId === 'string' && doc.fileId) await deleteFileIfPresent(doc.fileId)
  }
  const names = MODES.flatMap(mode => LANGS.map(lang => storageName(candidateId, mode, lang)))
  const leftovers = await storage.listFiles(BUCKETS.CV_EXPORTS, [Query.equal('name', names), Query.limit(100)])
  for (const file of leftovers.files) await deleteFileIfPresent(file.$id)
  for (const doc of docs) {
    try {
      await databases.deleteDocument(DB_ID, COLLECTIONS.CV_EXPORTS, doc.$id)
    } catch (err) {
      if (!isAppwrite(err, 'document_not_found')) throw err
    }
  }
}
