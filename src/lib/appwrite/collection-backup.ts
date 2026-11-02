import { Query, type Databases, type Models } from 'node-appwrite'
import { listAllDocuments } from './list-all'

// Sauvegarde d'une collection dans une nouvelle collection du même projet, faite par les scripts qui modifient des
// documents avant d'écrire (demande du 2026-11-02 : jobs → jobs_backup_02112026 pour scripts/jobs-move-tenant.mts et
// scripts/jobs-fill-recruiter.mts).
// - Mêmes attributs, tous facultatifs : un document ancien peut ne pas avoir une valeur devenue obligatoire depuis.
// - Mêmes identifiants et permissions de documents ; dates d'origine dans originalCreatedAt / originalUpdatedAt
//   (Appwrite 1.7 ne permet pas de fixer $createdAt).
// - Collection sans permission ni sécurité par document : lisible avec la clé d'API seulement.
// - Reprise sans risque : un document déjà sauvegardé n'est pas réécrit. Deux scripts lancés le même jour gardent donc
//   l'état d'avant le premier.
// Retour arrière : relire la valeur d'un champ dans la sauvegarde, au même $id (console Appwrite ou script).

type Attribute = Models.AttributeList['attributes'][number]
type BackupDatabases = Pick<Databases,
  | 'listAttributes' | 'getCollection' | 'createCollection' | 'listDocuments' | 'createDocument'
  | 'createStringAttribute' | 'createEmailAttribute' | 'createUrlAttribute' | 'createIpAttribute' | 'createEnumAttribute'
  | 'createIntegerAttribute' | 'createFloatAttribute' | 'createBooleanAttribute' | 'createDatetimeAttribute'>

export const ORIGINAL_CREATED_AT = 'originalCreatedAt'
export const ORIGINAL_UPDATED_AT = 'originalUpdatedAt'
const WAIT_STEP_MS = 2000
/** Création des attributs (asynchrone côté Appwrite) : quelques secondes d'ordinaire, plus sur un serveur chargé. */
const WAIT_MAX_MS = 10 * 60_000
const COPY_PARALLEL = 10

/** Arrêt prévu (message pour l'opérateur, sans pile d'appels). */
export class BackupStop extends Error {}

// Code HTTP de l'erreur Appwrite, sans instanceof : un script (ESM) et ce module (chargé en CommonJS par tsx) n'ont pas
// la même classe AppwriteException.
const codeOf = (err: unknown) => (err as { code?: number }).code

/**
 * Collection de sauvegarde (`<collection>_backup_JJMMAAAA`) : jamais reprise dans appwrite.config.json par
 * `npm run schema:pull`, pour qu'elle ne soit pas créée en production par schema:push.
 */
export const isBackupCollectionId = (id: string) => /_backup_\d{8}$/.test(id)

/** `jobs_backup_02112026` : collection sauvegardée et jour de la sauvegarde (heure de Paris), au format JJMMAAAA. */
export function backupCollectionId(sourceId: string, now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(now).map(part => [part.type, part.value]))
  const id = `${sourceId}_backup_${parts.day}${parts.month}${parts.year}`
  // Limite des identifiants Appwrite.
  if (id.length > 36) throw new BackupStop(`Nom de sauvegarde trop long (36 caractères au plus) : ${id}`)
  return id
}

/** Données d'un document à recopier : ses attributs (les champs $… sont gérés par Appwrite), plus ses dates d'origine. */
export function backupData(doc: Models.Document): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) if (!key.startsWith('$')) data[key] = value
  data[ORIGINAL_CREATED_AT] = doc.$createdAt
  data[ORIGINAL_UPDATED_AT] = doc.$updatedAt
  return data
}

/** Bornes reprises seulement quand elles sont exactes : le SDK lit ±9223372036854775807 arrondi, refusé en retour. */
const exactBound = (value: number | undefined) => (value !== undefined && Number.isSafeInteger(value) ? value : undefined)

/** Types que createBackupAttribute sait recréer (pas les relations). */
export function isSupportedAttribute(attr: Attribute): boolean {
  const format = 'format' in attr ? attr.format : ''
  if (attr.type === 'string') return ['', 'email', 'url', 'ip', 'enum'].includes(format)
  return ['integer', 'double', 'boolean', 'datetime'].includes(attr.type)
}

/** Crée dans la sauvegarde l'attribut `attr` de la collection d'origine, facultatif et sans valeur par défaut. */
export async function createBackupAttribute(db: BackupDatabases, databaseId: string, collectionId: string, attr: Attribute): Promise<void> {
  const { key } = attr
  const array = attr.array ?? false
  const format = 'format' in attr ? attr.format : ''
  if (attr.type === 'string' && format === 'email') await db.createEmailAttribute(databaseId, collectionId, key, false, undefined, array)
  else if (attr.type === 'string' && format === 'url') await db.createUrlAttribute(databaseId, collectionId, key, false, undefined, array)
  else if (attr.type === 'string' && format === 'ip') await db.createIpAttribute(databaseId, collectionId, key, false, undefined, array)
  else if (attr.type === 'string' && format === 'enum' && 'elements' in attr) {
    await db.createEnumAttribute(databaseId, collectionId, key, attr.elements, false, undefined, array)
  } else if (attr.type === 'string' && !format && 'size' in attr) {
    await db.createStringAttribute(databaseId, collectionId, key, attr.size, false, undefined, array)
  } else if (attr.type === 'integer') {
    const { min, max } = attr as Models.AttributeInteger
    await db.createIntegerAttribute(databaseId, collectionId, key, false, exactBound(min), exactBound(max), undefined, array)
  } else if (attr.type === 'double') {
    const { min, max } = attr as Models.AttributeFloat
    await db.createFloatAttribute(databaseId, collectionId, key, false, exactBound(min), exactBound(max), undefined, array)
  } else if (attr.type === 'boolean') await db.createBooleanAttribute(databaseId, collectionId, key, false, undefined, array)
  else if (attr.type === 'datetime') await db.createDatetimeAttribute(databaseId, collectionId, key, false, undefined, array)
  // Relation ou type inconnu : la sauvegarde serait incomplète.
  else throw new BackupStop(`Attribut ${key} (${attr.type}${format ? `, ${format}` : ''}) : type non pris en charge par la sauvegarde.`)
}

const sameShape = (a: Attribute, b: Attribute) =>
  a.type === b.type && (a.array ?? false) === (b.array ?? false)
  && ('format' in a ? a.format : '') === ('format' in b ? b.format : '')
  && (!('size' in a) || ('size' in b && b.size >= a.size))

async function listAttributes(db: BackupDatabases, databaseId: string, collectionId: string): Promise<Attribute[]> {
  const { total, attributes } = await db.listAttributes(databaseId, collectionId, [Query.limit(100)])
  if (total > attributes.length) throw new BackupStop(`${collectionId} : plus de 100 attributs, non pris en charge par la sauvegarde.`)
  return attributes
}

async function collectionExists(db: BackupDatabases, databaseId: string, collectionId: string): Promise<boolean> {
  try {
    await db.getCollection(databaseId, collectionId)
    return true
  } catch (err) {
    if (codeOf(err) === 404) return false
    throw err
  }
}

/** Attend que tous les attributs de la sauvegarde soient utilisables : un document écrit avant serait refusé. */
async function waitForAttributes(db: BackupDatabases, databaseId: string, collectionId: string): Promise<void> {
  const deadline = Date.now() + WAIT_MAX_MS
  for (;;) {
    const attributes = await listAttributes(db, databaseId, collectionId)
    const broken = attributes.find(a => a.status === 'failed' || a.status === 'stuck')
    if (broken) throw new BackupStop(`${collectionId}.${broken.key} : création ${broken.status} (${broken.error || 'sans détail'}).`)
    if (attributes.every(a => a.status === 'available')) return
    if (Date.now() > deadline) throw new BackupStop(`${collectionId} : attributs toujours en création après 10 min, relancez le script.`)
    await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS))
  }
}

const listIds = async (db: BackupDatabases, databaseId: string, collectionId: string) =>
  new Set((await listAllDocuments(db, databaseId, collectionId, [Query.select(['$id'])])).map(doc => doc.$id))

export interface BackupReport {
  /** La collection de sauvegarde existait avant ce passage. */
  existed: boolean
  /** Documents recopiés par ce passage (avec `apply`), ou à recopier (simulation). */
  copied: number
  /** Documents d'origine déjà dans la sauvegarde (état d'un passage précédent, gardé tel quel). */
  kept: number
  /** Identifiants présents dans la sauvegarde à la fin (simulation : ceux qu'elle aurait). */
  savedIds: Set<string>
}

/**
 * Sauvegarde `sourceId` dans `targetId` (créée si besoin). Sans `apply`, compte seulement ce qui serait fait.
 * Le script vérifie ensuite que les documents qu'il va modifier sont dans `savedIds`.
 */
export async function backupCollection(
  db: BackupDatabases, databaseId: string, sourceId: string, targetId: string, apply: boolean,
): Promise<BackupReport> {
  const sourceAttributes = await listAttributes(db, databaseId, sourceId)
  const reserved = sourceAttributes.find(a => a.key === ORIGINAL_CREATED_AT || a.key === ORIGINAL_UPDATED_AT)
  if (reserved) throw new BackupStop(`${sourceId}.${reserved.key} : nom réservé aux dates d'origine de la sauvegarde.`)
  // Vérifiés avant toute écriture : un type non pris en charge arrête le script avant la création de la collection.
  const unsupported = sourceAttributes.find(attr => !isSupportedAttribute(attr))
  if (unsupported) throw new BackupStop(`Attribut ${unsupported.key} (${unsupported.type}) : type non pris en charge par la sauvegarde.`)

  const exists = await collectionExists(db, databaseId, targetId)
  const sourceIds = await listIds(db, databaseId, sourceId)
  const targetIds = exists ? await listIds(db, databaseId, targetId) : new Set<string>()
  const missing = [...sourceIds].filter(id => !targetIds.has(id))
  const kept = sourceIds.size - missing.length
  if (!apply) return { existed: exists, copied: missing.length, kept, savedIds: new Set([...targetIds, ...sourceIds]) }

  if (!exists) await db.createCollection(databaseId, targetId, targetId, [], false, true)
  const targetAttributes = new Map((await listAttributes(db, databaseId, targetId)).map(a => [a.key, a]))
  for (const attr of sourceAttributes) {
    const existing = targetAttributes.get(attr.key)
    if (!existing) await createBackupAttribute(db, databaseId, targetId, attr)
    else if (!sameShape(attr, existing)) throw new BackupStop(`${targetId}.${attr.key} existe avec un autre type que dans ${sourceId} : ce n'est pas une sauvegarde de ${sourceId}.`)
  }
  for (const key of [ORIGINAL_CREATED_AT, ORIGINAL_UPDATED_AT]) {
    if (!targetAttributes.has(key)) await db.createDatetimeAttribute(databaseId, targetId, key, false)
  }
  await waitForAttributes(db, databaseId, targetId)

  // Relus en entier au moment de la copie, par lots (une offre a jusqu'à 64 Ko de description).
  const missingSet = new Set(missing)
  const toCopy = (await listAllDocuments(db, databaseId, sourceId, [])).filter(doc => missingSet.has(doc.$id))
  let copied = 0
  for (let i = 0; i < toCopy.length; i += COPY_PARALLEL) {
    await Promise.all(toCopy.slice(i, i + COPY_PARALLEL).map(async doc => {
      try {
        await db.createDocument(databaseId, targetId, doc.$id, backupData(doc), doc.$permissions)
        copied++
      } catch (err) {
        // Déjà sauvegardé par un passage simultané : l'état le plus ancien est gardé.
        if (codeOf(err) !== 409) throw err
      }
    }))
  }
  return { existed: exists, copied, kept, savedIds: await listIds(db, databaseId, targetId) }
}
