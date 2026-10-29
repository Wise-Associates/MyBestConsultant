import 'server-only'
import { AppwriteException } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS } from '@/lib/appwrite/config'
import type { PosterScene } from './poster'
import { sceneMime } from './scene'

// Scènes photo des affiches (ADR 0015) : bucket privé `social_scenes` (appwrite.config.json, npm run schema:push), un fichier par publication,
// d'identifiant celui de la publication. Gardées pour que l'affiche, redessinée à chaque téléchargement, montre toujours
// la même photo. Facultatif : sans APPWRITE_STORAGE_SOCIAL_SCENES, les affiches partent sans photo.

export const isSceneStorageConfigured = () => !!BUCKETS.SOCIAL_SCENES

const isAppwrite = (err: unknown, type: string) => err instanceof AppwriteException && err.type === type

export async function hasScene(publicationId: string): Promise<boolean> {
  const { storage } = createAdminClient()
  try {
    await storage.getFile(BUCKETS.SOCIAL_SCENES, publicationId)
    return true
  } catch (err) {
    if (isAppwrite(err, 'storage_file_not_found')) return false
    throw err
  }
}

export async function readScene(publicationId: string): Promise<PosterScene | null> {
  const { storage } = createAdminClient()
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await storage.getFileDownload(BUCKETS.SOCIAL_SCENES, publicationId))
  } catch (err) {
    if (isAppwrite(err, 'storage_file_not_found')) return null
    throw err
  }
  const mime = sceneMime(bytes)
  if (!mime) {
    console.error('[social] photo d’affiche illisible, ignorée', publicationId)
    return null
  }
  return { bytes, mime }
}

export async function storeScene(publicationId: string, scene: PosterScene): Promise<void> {
  const { storage } = createAdminClient()
  const name = `${publicationId}.${scene.mime === 'image/jpeg' ? 'jpg' : 'png'}`
  try {
    await storage.createFile(BUCKETS.SOCIAL_SCENES, publicationId, InputFile.fromBuffer(Buffer.from(scene.bytes), name))
  } catch (err) {
    // Déjà enregistrée par un envoi simultané de la même publication : on garde celle-là.
    if (!(err instanceof AppwriteException && err.code === 409)) throw err
  }
}
