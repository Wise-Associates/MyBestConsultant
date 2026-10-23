import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { AppwriteException, ID } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { parseTemplateMap } from './template-check'
import wiseAssociatesMap from './templates/wise-associates/template_map.json'
import type { TemplateMap } from './types'

// Modèle Word de chaque organisation (ADR 0010), déposé depuis sa CV Thèque : par ses recruteurs pour une organisation,
// par l'admin pour la plateforme (« admin »), qui exporte avec le modèle Wise Associates du dépôt tant qu'elle n'en a pas
// déposé d'autre. Collection `cv_templates` (un document par organisation, d'identifiant celui de l'organisation) et
// bucket privé `cv_templates`, créés par `npm run cv-export:setup`. Aucune permission client. Sans les deux variables,
// seule la plateforme exporte, avec le modèle du dépôt.

export interface EsnTemplate {
  bytes: Uint8Array
  map: TemplateMap
}

/** Ce que les CV Thèques et la fenêtre d'export voient d'un modèle : ni fichier ni cartographie. */
export interface EsnTemplateInfo {
  esn: string
  /** Vide pour le modèle du dépôt. */
  uploadedAt: string
  /** Modèle Wise Associates du dépôt : celui de la plateforme tant que l'admin n'en a pas déposé d'autre. */
  builtIn: boolean
}

// Lus sur disque : next.config.ts les inclut dans les fonctions des routes qui les lisent (outputFileTracingIncludes).
const TEMPLATES_DIR = path.join(process.cwd(), 'src', 'lib', 'cv-export', 'templates')
const BUNDLED_PATH = path.join(TEMPLATES_DIR, 'wise-associates', 'template.docx')
const BUNDLED_MAP: TemplateMap = wiseAssociatesMap
// Copie du modèle Wise sans rien de Wise Associates : nom (« Votre ESN »), logo (remplacé par un emplacement « LOGO »),
// bloc contact (nom, téléphone et e-mail d'un commercial, remplacés par des valeurs fictives), propriétés du document.
// L'exemple va aux recruteurs de toutes les organisations. Même cartographie que le modèle Wise (son `esn` excepté),
// qui ne touche pas à ces éléments. Testé dans template-check.test.ts.
const EXAMPLE_DIR = path.join(TEMPLATES_DIR, 'example')

/** Exemple pour préparer le modèle d'une organisation : modèle Word et template_map.json tels quels. */
export async function readExampleTemplateFiles(): Promise<{ docx: Uint8Array; mapJson: Uint8Array }> {
  const [docx, mapJson] = await Promise.all([readFile(path.join(EXAMPLE_DIR, 'template.docx')), readFile(path.join(EXAMPLE_DIR, 'template_map.json'))])
  return { docx: new Uint8Array(docx), mapJson: new Uint8Array(mapJson) }
}

export const isCvTemplateStorageConfigured = () => !!COLLECTIONS.CV_TEMPLATES && !!BUCKETS.CV_TEMPLATES

const isNotFound = (err: unknown) => err instanceof AppwriteException && (err.type === 'document_not_found' || err.type === 'storage_file_not_found')

async function getTemplateDoc(tenantId: string) {
  if (!isCvTemplateStorageConfigured()) return null
  try {
    return await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.CV_TEMPLATES, tenantId)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** Modèle d'une organisation ; null si elle n'en a pas (pas de « Format ESN » pour ses recruteurs). */
export async function loadEsnTemplate(tenantId: string): Promise<EsnTemplate | null> {
  const doc = await getTemplateDoc(tenantId)
  if (!doc) return tenantId === PLATFORM_TENANT_ID ? { bytes: new Uint8Array(await readFile(BUNDLED_PATH)), map: BUNDLED_MAP } : null
  const bytes = await createAdminClient().storage.getFileDownload(BUCKETS.CV_TEMPLATES, String(doc.fileId))
  // Revérifiée à chaque lecture : un document modifié à la main dans la console ne doit pas faire planter un export.
  return { bytes: new Uint8Array(bytes), map: parseTemplateMap(String(doc.mapJson)) }
}

export async function getEsnTemplateInfo(tenantId: string): Promise<EsnTemplateInfo | null> {
  const doc = await getTemplateDoc(tenantId)
  if (doc) return { esn: String(doc.esn), uploadedAt: String(doc.uploadedAt), builtIn: false }
  return tenantId === PLATFORM_TENANT_ID ? { esn: BUNDLED_MAP.esn, uploadedAt: '', builtIn: true } : null
}

/** Enregistre (ou remplace) le modèle déjà vérifié (checkTemplate) d'une organisation. */
export async function saveEsnTemplate(input: { tenantId: string; bytes: Uint8Array; map: TemplateMap; mapJson: string; uploadedBy: string; now: Date }) {
  const { databases, storage } = createAdminClient()
  const previous = await getTemplateDoc(input.tenantId)
  const uploaded = await storage.createFile(BUCKETS.CV_TEMPLATES, ID.unique(),
    InputFile.fromBuffer(Buffer.from(input.bytes), `modele_${input.tenantId}.docx`))
  const data = { esn: input.map.esn, fileId: uploaded.$id, mapJson: input.mapJson, uploadedBy: input.uploadedBy, uploadedAt: input.now.toISOString() }
  let replaced = previous
  try {
    if (previous) {
      await databases.updateDocument(DB_ID, COLLECTIONS.CV_TEMPLATES, input.tenantId, data)
    } else {
      try {
        await databases.createDocument(DB_ID, COLLECTIONS.CV_TEMPLATES, input.tenantId, data)
      } catch (err) {
        // Premier dépôt simultané (deux onglets) : l'autre a créé le document, celui-ci le remplace.
        if (!(err instanceof AppwriteException && err.code === 409)) throw err
        replaced = await getTemplateDoc(input.tenantId)
        await databases.updateDocument(DB_ID, COLLECTIONS.CV_TEMPLATES, input.tenantId, data)
      }
    }
  } catch (err) {
    await storage.deleteFile(BUCKETS.CV_TEMPLATES, uploaded.$id).catch(cleanupErr =>
      console.error('[cv-export] modèle non référencé laissé dans le bucket', uploaded.$id, cleanupErr instanceof Error ? cleanupErr.name : cleanupErr))
    throw err
  }
  if (replaced) {
    const oldFileId = String(replaced.fileId)
    await storage.deleteFile(BUCKETS.CV_TEMPLATES, oldFileId).catch(err => {
      if (!isNotFound(err)) console.error('[cv-export] ancien modèle non supprimé du bucket', oldFileId, err instanceof Error ? err.name : err)
    })
  }
}

/**
 * Retire le modèle d'une organisation : ses recruteurs n'ont plus « Format ESN » (la plateforme revient au modèle du
 * dépôt). Ses versions enregistrées restent dans le stockage (supprimées avec le compte du candidat) et redeviennent
 * accessibles si un modèle est redéposé.
 */
export async function deleteEsnTemplate(tenantId: string): Promise<void> {
  const doc = await getTemplateDoc(tenantId)
  if (!doc) return
  const { databases, storage } = createAdminClient()
  // Document d'abord : le bouton disparaît tout de suite ; un fichier resté seul ne sert plus à rien (journalisé).
  await databases.deleteDocument(DB_ID, COLLECTIONS.CV_TEMPLATES, tenantId)
  await storage.deleteFile(BUCKETS.CV_TEMPLATES, String(doc.fileId)).catch(err => {
    if (!isNotFound(err)) console.error('[cv-export] fichier du modèle retiré non supprimé du bucket', doc.fileId, err instanceof Error ? err.name : err)
  })
}
