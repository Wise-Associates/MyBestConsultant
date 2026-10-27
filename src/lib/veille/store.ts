import 'server-only'
import { ID, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { MAX_CONFIG_LENGTH, parseVeilleConfig, VEILLE_SCHEMA_VERSION, type VeilleConfig } from './config'

// Réglages de la veille en versions (collection veille_config, aucune permission client) : chaque enregistrement crée
// la version suivante, document `v<numéro>` ; la plus récente est en vigueur. Deux enregistrements simultanés à partir
// de la même version ne peuvent pas réussir tous les deux (même identifiant de document, index unique sur `version`).

/**
 * Versions gardées : les plus anciennes sont supprimées après chaque enregistrement. L'auteur de chaque version (nom et
 * identifiant de l'admin, jamais son e-mail) est gardé aussi longtemps qu'elle (ADR 0012).
 */
const KEPT_VERSIONS = 50

export interface VeilleConfigVersion {
  version: number
  config: VeilleConfig
  savedAt: string
  savedByName: string
}

export function isVeilleConfigStorageConfigured(): boolean {
  return Boolean(COLLECTIONS.VEILLE_CONFIG)
}

function assertConfigured(): void {
  if (!COLLECTIONS.VEILLE_CONFIG) {
    throw new Error('APPWRITE_COLLECTION_VEILLE_CONFIG non définie : créez la collection veille_config (npm run schema:push) et ajoutez la variable.')
  }
}

const codeOf = (err: unknown) => (err as { code?: number }).code

/** Version en vigueur ; null tant qu'aucune n'est enregistrée (npm run veille:seed). Une version illisible est une erreur. */
export async function getLatestVeilleConfig(): Promise<VeilleConfigVersion | null> {
  assertConfigured()
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VEILLE_CONFIG, [Query.orderDesc('version'), Query.limit(1)])
  const doc = res.documents[0]
  if (!doc) return null
  const parsed = parseVeilleConfig(JSON.parse(String(doc.config)))
  if (!parsed.success) throw new Error(`Réglages de la veille illisibles (version ${doc.version}) : ${parsed.errors.slice(0, 3).join(' ; ')}`)
  return { version: Number(doc.version), config: parsed.config, savedAt: doc.$createdAt, savedByName: String(doc.savedByName) }
}

export type SaveResult = { version: number } | { conflict: true } | { tooLarge: true }

/**
 * Enregistre `config` (déjà validée) comme version suivant `baseVersion`, celle que l'admin a modifiée. Une autre
 * version enregistrée entre-temps : `conflict`, rien n'est écrit (l'admin recharge et refait sa modification).
 */
export async function saveVeilleConfig(config: VeilleConfig, baseVersion: number, author: { id: string; name: string }): Promise<SaveResult> {
  assertConfigured()
  const json = JSON.stringify(config)
  if (json.length > MAX_CONFIG_LENGTH) return { tooLarge: true }
  const latest = await getLatestVeilleConfig()
  if ((latest?.version ?? 0) !== baseVersion) return { conflict: true }
  const version = baseVersion + 1
  const { databases } = createAdminClient()
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.VEILLE_CONFIG, ID.custom(`v${version}`), {
      version,
      schemaVersion: VEILLE_SCHEMA_VERSION,
      config: json,
      savedById: author.id.slice(0, 36),
      savedByName: author.name.slice(0, 128),
    })
  } catch (err) {
    if (codeOf(err) === 409) return { conflict: true }
    throw err
  }
  await pruneOldVersions(version).catch(err => {
    // La nouvelle version est enregistrée : seule la place prise par les anciennes reste à récupérer au prochain enregistrement.
    console.error('[veille] anciennes versions des réglages non supprimées', err instanceof Error ? err.message : String(err))
  })
  return { version }
}

async function pruneOldVersions(latest: number): Promise<void> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VEILLE_CONFIG, [
    Query.lessThanEqual('version', latest - KEPT_VERSIONS), Query.select(['$id']), Query.limit(100),
  ])
  for (const doc of res.documents) await databases.deleteDocument(DB_ID, COLLECTIONS.VEILLE_CONFIG, doc.$id)
}
