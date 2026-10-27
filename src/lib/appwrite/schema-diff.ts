// Structure Appwrite décrite par appwrite.config.json, comparée à celle d'un projet comme la compare
// `appwrite push collection` (CLI 8.3.0, lib/commands/push.js) — règles pures utilisées par
// scripts/appwrite-schema.mts (docs/adr/0011-structure-appwrite-appwrite-config.md).

export interface SchemaAttribute {
  key: string
  type: string
  [setting: string]: unknown
}

export interface SchemaIndex {
  key: string
  type: string
  attributes: string[]
  [setting: string]: unknown
}

export interface SchemaCollection {
  $id: string
  $permissions: string[]
  databaseId: string
  name: string
  enabled: boolean
  documentSecurity: boolean
  attributes: SchemaAttribute[]
  indexes: SchemaIndex[]
}

export interface SchemaDatabase {
  $id: string
  name: string
  enabled: boolean
}

/** Contenu de appwrite.config.json (seules les collections sont gérées par ce fichier). */
export interface SchemaConfig {
  projectId: string
  databases?: SchemaDatabase[]
  collections?: SchemaCollection[]
}

export interface AppwriteEnvironment {
  projectId: string
  databaseId: string
}

/**
 * Ajouts, appliqués par schema:push : `create-collection`, `add-attribute` (facultatif), `add-index` (non unique).
 *
 * Présents sur le projet mais absents du fichier, gardés : `kept-attribute`, `kept-index`. schema:push pousse le fichier
 * complété par eux (`pushCopy`) : la CLI, qui supprime ce qui manque au fichier, ne supprime donc rien. Leur suppression
 * passe par un script, après le déploiement du code qui ne s'en sert plus, et ne bloque pas les ajouts.
 *
 * Refusés (rien n'est poussé) :
 * - `add-required-attribute` : attribut obligatoire ajouté à une collection existante — ses documents n'auraient pas de
 *   valeur et ne pourraient plus être modifiés ; on l'ajoute facultatif, on le remplit, puis on le rend obligatoire.
 * - `add-unique-index` : index unique ajouté à une collection existante — ses données peuvent le contredire (doublons),
 *   Appwrite le laisse alors « failed » ; un script vérifie les doublons puis le crée.
 * - `update-attribute` : réglage modifiable sur place (obligatoire, valeur par défaut, bornes, valeurs d'une
 *   énumération) que la CLI affiche et dit appliquer, mais elle renvoie les valeurs du projet (`attribute = remote`
 *   dans checkAttributeChanges) : rien ne change.
 * - `rounded-bound` : borne 64 bits d'un attribut entier (±9223372036854775807) arrondie par un outil qui a réécrit le
 *   fichier en lisant les nombres en double précision (JSON.parse) : le fichier ne décrit plus le projet.
 * - `recreate-*` : réglage que la CLI ne sait pas modifier (type, taille, tableau, format…) : elle supprime puis recrée,
 *   les données de l'attribut sont perdues.
 * - `unavailable-index` : index du projet qui n'est pas « available » (création échouée ou en cours) : sa contrainte ne
 *   s'applique pas, et la CLI ne compare pas cet état.
 * - `collection-settings` : permissions, sécurité par document, activation ou nom de la collection : la CLI les affiche
 *   mais n'applique que le nom.
 */
export type SchemaChangeKind =
  | 'create-collection'
  | 'add-attribute'
  | 'add-index'
  | 'kept-attribute'
  | 'kept-index'
  | 'add-required-attribute'
  | 'add-unique-index'
  | 'update-attribute'
  | 'rounded-bound'
  | 'recreate-attribute'
  | 'recreate-index'
  | 'unavailable-index'
  | 'collection-settings'

export interface SchemaChange {
  kind: SchemaChangeKind
  /** `collection` ou `collection.clé` */
  target: string
  /** Réglages en cause, « clé : avant → après » */
  detail?: string
}

const ADDITIONS: ReadonlySet<SchemaChangeKind> = new Set(['create-collection', 'add-attribute', 'add-index'])
const KEPT: ReadonlySet<SchemaChangeKind> = new Set(['kept-attribute', 'kept-index'])

// Clés comparées par la CLI (KeysAttributes de lib/config.js), selon qu'elle les dit modifiables ou non (changeableKeys).
const ATTRIBUTE_UPDATABLE = ['required', 'default', 'min', 'max', 'elements']
const BOUNDS = ['min', 'max']
const ATTRIBUTE_RECREATED = ['type', 'array', 'size', 'format', 'encrypt', 'relatedCollection', 'relationType', 'twoWay', 'twoWayKey', 'onDelete', 'side']
const INDEX_RECREATED = ['type', 'attributes', 'orders']
const COLLECTION_SETTINGS = ['$permissions', 'documentSecurity', 'enabled', 'name'] as const

/** Ce que schema:push applique. */
export function isAddition(change: SchemaChange): boolean {
  return ADDITIONS.has(change.kind)
}

/** Ce qui empêche schema:push de pousser quoi que ce soit : tout sauf les ajouts et ce qui est gardé. */
export function isBlocking(change: SchemaChange): boolean {
  return !ADDITIONS.has(change.kind) && !KEPT.has(change.kind)
}

/** Comme la CLI : null, chaîne blanche et tableau vide sont la même absence de valeur. */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Deux valeurs différentes au chiffre près mais égales une fois lues en double précision. */
function sameOnceRounded(a: unknown, b: unknown): boolean {
  return Number(JSON.stringify(a)) === Number(JSON.stringify(b))
}

function changedKeys(remote: object, local: object, keys: readonly string[]): string | undefined {
  const before = remote as Record<string, unknown>
  const after = local as Record<string, unknown>
  const changes = keys
    .filter(key => !sameValue(before[key], after[key]))
    .map(key => `${key} : ${JSON.stringify(before[key] ?? null)} → ${JSON.stringify(after[key] ?? null)}`)
  return changes.length > 0 ? changes.join(', ') : undefined
}

function diffEntries<T extends { key: string }>(
  collectionId: string,
  local: T[],
  remote: T[],
  compare: (remote: T, local: T) => SchemaChange | undefined,
  added: (entry: T) => SchemaChangeKind,
  kept: SchemaChangeKind,
): SchemaChange[] {
  const changes: SchemaChange[] = []
  const remoteByKey = new Map(remote.map(entry => [entry.key, entry]))
  const localKeys = new Set(local.map(entry => entry.key))
  for (const entry of local) {
    const existing = remoteByKey.get(entry.key)
    const change = existing ? compare(existing, entry) : { kind: added(entry), target: `${collectionId}.${entry.key}` }
    if (change) changes.push(change)
  }
  for (const entry of remote) {
    if (!localKeys.has(entry.key)) changes.push({ kind: kept, target: `${collectionId}.${entry.key}` })
  }
  return changes
}

/**
 * Changements que `push collection` ferait sur le projet pour qu'il ressemble au fichier. Les collections du projet
 * absentes du fichier ne sont pas comptées : la CLI n'y touche pas.
 */
export function diffSchema(local: SchemaCollection[], remote: SchemaCollection[]): SchemaChange[] {
  const remoteById = new Map(remote.map(collection => [collection.$id, collection]))
  const changes: SchemaChange[] = []

  for (const collection of local) {
    const existing = remoteById.get(collection.$id)
    if (!existing) {
      // Créée avec les permissions du fichier, sans que la CLI les montre.
      const access = `$permissions : ${JSON.stringify(collection.$permissions)}, documentSecurity : ${collection.documentSecurity}`
      changes.push({ kind: 'create-collection', target: collection.$id, detail: access })
      continue
    }

    const settings = changedKeys(existing, collection, COLLECTION_SETTINGS)
    if (settings) changes.push({ kind: 'collection-settings', target: collection.$id, detail: settings })

    changes.push(...diffEntries(
      collection.$id,
      collection.attributes,
      existing.attributes,
      (remoteAttribute, localAttribute) => {
        const target = `${collection.$id}.${localAttribute.key}`
        const recreated = changedKeys(remoteAttribute, localAttribute, ATTRIBUTE_RECREATED)
        if (recreated) return { kind: 'recreate-attribute', target, detail: recreated }
        const rounded = BOUNDS.filter(key => !sameValue(remoteAttribute[key], localAttribute[key]) && sameOnceRounded(remoteAttribute[key], localAttribute[key]))
        if (rounded.length > 0) return { kind: 'rounded-bound', target, detail: changedKeys(remoteAttribute, localAttribute, rounded) }
        const updated = changedKeys(remoteAttribute, localAttribute, ATTRIBUTE_UPDATABLE)
        return updated ? { kind: 'update-attribute', target, detail: updated } : undefined
      },
      attribute => (attribute.required === true ? 'add-required-attribute' : 'add-attribute'),
      'kept-attribute',
    ))

    changes.push(...diffEntries(
      collection.$id,
      collection.indexes,
      existing.indexes,
      (remoteIndex, localIndex) => {
        const recreated = changedKeys(remoteIndex, localIndex, INDEX_RECREATED)
        return recreated ? { kind: 'recreate-index', target: `${collection.$id}.${localIndex.key}`, detail: recreated } : undefined
      },
      index => (index.type === 'unique' ? 'add-unique-index' : 'add-index'),
      'kept-index',
    ))

    for (const index of existing.indexes) {
      if (index.status !== undefined && index.status !== 'available') {
        changes.push({ kind: 'unavailable-index', target: `${collection.$id}.${index.key}`, detail: `status : ${JSON.stringify(index.status)}` })
      }
    }
  }

  return changes
}

/**
 * Copie poussée par schema:push : le fichier complété par les attributs et index que seul le projet a, pour que la CLI
 * ne supprime rien (voir `kept-*`).
 */
export function pushCopy(config: SchemaConfig, remote: SchemaCollection[]): SchemaConfig {
  const remoteById = new Map(remote.map(collection => [collection.$id, collection]))
  const onlyRemote = <T extends { key: string }>(local: T[], project: T[]) => project.filter(entry => !local.some(own => own.key === entry.key))
  return {
    ...config,
    collections: (config.collections ?? []).map(collection => {
      const existing = remoteById.get(collection.$id)
      if (!existing) return collection
      return {
        ...collection,
        attributes: [...collection.attributes, ...onlyRemote(collection.attributes, existing.attributes)],
        indexes: [...collection.indexes, ...onlyRemote(collection.indexes, existing.indexes)],
      }
    }),
  }
}

/** Fichier qui ne peut pas servir au projet visé : le message dit quoi faire. */
export class SchemaFileError extends Error {}

/**
 * Copie du fichier (instantané du projet DEV) pour un autre projet : la CLI ne lit le projet que dans
 * appwrite.config.json, et la base de la production n'a pas le même identifiant. La base est celle lue sur le projet
 * visé : sinon la CLI créerait sans demander une base absente, ou renommerait celle qui existe.
 */
export function configFor(config: SchemaConfig, source: AppwriteEnvironment, target: AppwriteEnvironment, targetDatabase: SchemaDatabase): SchemaConfig {
  if (config.projectId !== source.projectId) {
    throw new SchemaFileError(`appwrite.config.json vise le projet ${config.projectId}, pas ${source.projectId} : reprenez-le depuis git et relancez npm run schema:pull`)
  }
  const otherDatabase = [...(config.databases ?? []).map(database => database.$id), ...(config.collections ?? []).map(collection => collection.databaseId)]
    .find(databaseId => databaseId !== source.databaseId)
  if (otherDatabase !== undefined) {
    throw new SchemaFileError(`appwrite.config.json contient la base ${otherDatabase} : seule ${source.databaseId} est gérée par ce fichier`)
  }
  if (targetDatabase.$id !== target.databaseId) {
    throw new SchemaFileError(`Base ${targetDatabase.$id} lue sur ${target.projectId}, ${target.databaseId} attendue`)
  }
  return {
    projectId: target.projectId,
    databases: [targetDatabase],
    collections: (config.collections ?? []).map(collection => ({ ...collection, databaseId: target.databaseId })),
  }
}

const LABELS: Record<SchemaChangeKind, string> = {
  'create-collection': 'collection créée',
  'add-attribute': 'attribut ajouté',
  'add-index': 'index ajouté',
  'kept-attribute': 'absent du fichier, gardé : sa suppression passe par un script, après le déploiement du code',
  'kept-index': 'absent du fichier, gardé : sa suppression passe par un script, après le déploiement du code',
  'add-required-attribute': 'attribut obligatoire ajouté à une collection existante : ajoutez-le facultatif, remplissez-le (script), puis rendez-le obligatoire',
  'add-unique-index': 'index unique ajouté à une collection existante : ses données peuvent le contredire — script qui vérifie les doublons puis le crée',
  'update-attribute': 'modification que la CLI 8.3.0 n\'applique pas (elle renvoie les valeurs du projet) : console Appwrite ou script',
  'rounded-bound': 'borne arrondie par un outil qui a réécrit le fichier : reprenez appwrite.config.json depuis git ou relancez npm run schema:pull',
  'recreate-attribute': 'la CLI supprimerait puis recréerait l\'attribut : ses données seraient perdues — nouvel attribut + script de migration',
  'recreate-index': 'la CLI supprimerait puis recréerait l\'index — nouvel index, puis suppression de l\'ancien par un script',
  'unavailable-index': 'index non disponible sur le projet (création échouée ou en cours) : sa contrainte ne s\'applique pas — console Appwrite ou script',
  'collection-settings': 'réglage de collection que schema:push n\'applique pas : console Appwrite ou script',
}

export function describeChange(change: SchemaChange): string {
  const sign = isAddition(change) ? '+' : isBlocking(change) ? '✗' : '·'
  return `${sign} ${change.target} : ${LABELS[change.kind]}${change.detail ? ` (${change.detail})` : ''}`
}
