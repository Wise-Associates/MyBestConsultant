#!/usr/bin/env node
// Crée les collections et buckets de l'export « Format ESN » dans un projet Appwrite (idempotent : l'existant est
// conservé) : `cv_exports` (versions enregistrées, ADR 0009) et `cv_templates` (modèle Word de chaque organisation,
// ADR 0010). Même fonctionnement que scripts/setup-assistant-collections.mjs.
// Migration de `cv_exports` vers une version par organisation (ADR 0010), en deux temps :
//   1. avant le déploiement : attribut `tenantId`, versions existantes rattachées à la plateforme (« admin »), index
//      unique (candidateId, tenantId, mode, lang). L'ancien index unique (candidateId, mode, lang) est GARDÉ : tant
//      qu'il existe, l'ancien code encore en ligne ne peut pas créer de doublon, et le rattachement ne peut pas entrer
//      en conflit ;
//   2. après le déploiement, avec --drop-old-index : rattachement des versions écrites entre-temps par l'ancien code,
//      puis suppression de l'ancien index. Seulement ensuite, définir les variables CV_TEMPLATES (sinon la version d'un
//      recruteur pour un candidat déjà exporté par la plateforme serait refusée par l'ancien index).
//
//   npm run cv-export:setup -- .env.dev                → affiche ce qui manque, ne modifie rien
//   npm run cv-export:setup -- .env.dev --apply        → crée ce qui manque (projet DEV)
//   npm run cv-export:setup -- .env --prod             → simulation sur la production
//   npm run cv-export:setup -- .env --prod --apply     → production (à lancer par un humain)
//   … --apply --drop-old-index                          → après le déploiement : supprime l'ancien index de cv_exports
//
// Le fichier d'environnement fournit APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY et APPWRITE_DB_ID.
// Ensuite, ajoutez dans ce même environnement (fichier local ET variables Vercel) :
//   APPWRITE_COLLECTION_CV_EXPORTS=cv_exports      APPWRITE_STORAGE_CV_EXPORTS=cv_exports
//   APPWRITE_COLLECTION_CV_TEMPLATES=cv_templates  APPWRITE_STORAGE_CV_TEMPLATES=cv_templates
// Ni les collections ni les buckets n'ont de permission client : seule la clé API serveur y accède
// (src/lib/cv-export/store.ts, templates.ts).
import { Client, Databases, Query, Storage } from 'node-appwrite'
import { readFileSync } from 'fs'

function readEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.error('Usage : npm run cv-export:setup -- <fichier .env> [--apply] [--prod]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const dropOldIndex = flags.includes('--drop-old-index')
const env = readEnv(file)
for (const key of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID']) {
  if (!env[key]) { console.error(`${key} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== 'bestconsultant-dev' && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}
const client = new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY)
const db = new Databases(client)
const storage = new Storage(client)
const DB = env.APPWRITE_DB_ID

const PLATFORM_TENANT_ID = 'admin' // src/lib/ao/tenancy.ts

// Un document par organisation, candidat, anonymisation et langue (dernière version seulement, remplacée à chaque
// génération). Données personnelles (CV pseudonymisé) : supprimées avec le compte du candidat (deleteUserAccount).
const EXPORTS = {
  id: 'cv_exports',
  name: 'CV exports (format ESN)',
  // [type, clé, options] — 16 attributs maximum par collection (limite du projet, voir AGENTS.md).
  attributes: [
    ['string', 'candidateId', { size: 36, required: true }],
    ['string', 'mode', { size: 10, required: true }],
    ['string', 'lang', { size: 2, required: true }],
    ['string', 'fileId', { size: 36, required: true }],
    // Nom proposé au téléchargement (« CV_Wise-Associates_J-D_Developpeur-Java_FR.docx »).
    ['string', 'fileName', { size: 255, required: true }],
    // CV du candidat lu pour cette génération : signale une version tirée d'un CV remplacé depuis.
    ['string', 'sourceCvFileId', { size: 36, required: true }],
    // Compte rendu (JSON) ; taille : NOTES_MAX_LENGTH de src/lib/cv-export/stored.ts.
    ['string', 'notes', { size: 4000 }],
    ['datetime', 'generatedAt', { required: true }],
    // Organisation qui a généré la version (« admin » : la plateforme). Facultatif pour Appwrite seulement : ajouté à
    // une collection qui a déjà des documents, rempli par la migration ci-dessous, toujours écrit par le code.
    ['string', 'tenantId', { size: 36 }],
  ],
  // Unique : deux générations simultanées de la même version ne créent pas de doublon (saveCvExports). candidateId en
  // premier : l'index sert aussi la recherche par candidat seul (suppression avec le compte, toutes organisations).
  indexes: [['tenantversion', 'unique', ['candidateId', 'tenantId', 'mode', 'lang']]],
}
// Index d'avant ADR 0010 : il interdirait à deux organisations d'enregistrer une version du même candidat.
const OLD_EXPORTS_INDEX = 'candidateversion'

// Un document par organisation, d'identifiant celui de l'organisation (unique par construction, pas d'index).
const TEMPLATES = {
  id: 'cv_templates',
  name: 'CV templates (format ESN)',
  attributes: [
    ['string', 'esn', { size: 100, required: true }],
    ['string', 'fileId', { size: 36, required: true }],
    // template_map.json ; taille : MAX_MAP_LENGTH de src/lib/cv-export/template-check.ts.
    ['string', 'mapJson', { size: 20000, required: true }],
    ['string', 'uploadedBy', { size: 36, required: true }],
    ['datetime', 'uploadedAt', { required: true }],
  ],
  indexes: [],
}

// .docx chiffrés au repos, 10 Mo au plus (un dossier fait environ 100 Ko, un modèle 2 Mo au plus : src/lib/cv-export/limits.ts).
const BUCKETS = [
  { id: 'cv_exports', name: 'CV exports (format ESN)', maxFileSize: 10 * 1024 * 1024, extensions: ['docx'] },
  { id: 'cv_templates', name: 'CV templates (format ESN)', maxFileSize: 10 * 1024 * 1024, extensions: ['docx'] },
]

function createAttribute(collection, [type, key, o]) {
  const required = o.required ?? false
  const def = required ? undefined : o.default
  if (type === 'string') return db.createStringAttribute(DB, collection, key, o.size, required, def, o.array ?? false)
  if (type === 'datetime') return db.createDatetimeAttribute(DB, collection, key, required, def)
  throw new Error(`type inconnu : ${type}`)
}

// Les attributs sont créés en arrière-plan par Appwrite : il faut attendre « available » avant les index.
async function waitForAttributes(collection) {
  for (let i = 0; i < 60; i++) {
    const { attributes } = await db.listAttributes(DB, collection)
    const failed = attributes.filter(a => a.status === 'failed' || a.status === 'stuck')
    if (failed.length) throw new Error(`Attributs en échec (à supprimer dans la console Appwrite, puis relancer) : ${failed.map(a => `${a.key} (${a.error || a.status})`).join(', ')}`)
    if (attributes.every(a => a.status === 'available')) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Attributs toujours en cours de création après 60 s')
}

async function waitForIndexes(collection) {
  for (let i = 0; i < 60; i++) {
    const { indexes } = await db.listIndexes(DB, collection)
    const failed = indexes.filter(x => x.status === 'failed' || x.status === 'stuck')
    if (failed.length) throw new Error(`Index en échec (à supprimer dans la console Appwrite, puis relancer) : ${failed.map(x => `${x.key} (${x.error || x.status})`).join(', ')}`)
    if (indexes.every(x => x.status === 'available')) return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Index toujours en cours de création après 60 s')
}

const MAX_ATTRIBUTES = 16

/**
 * Collection : créée si absente, attributs et index manquants ajoutés, l'existant vérifié. `beforeIndexes` s'exécute
 * une fois les attributs disponibles (migration des documents existants avant un index unique). Renvoie false en cas
 * d'erreur bloquante (rien n'est créé pour cette collection).
 */
async function ensureCollection(c, beforeIndexes) {
  const collection = await db.getCollection(DB, c.id).catch(e => { if (e.code === 404) return null; throw e })
  const hasCollection = collection !== null
  if (!hasCollection) {
    console.log(`+ collection ${c.id}`)
    if (apply) await db.createCollection(DB, c.id, c.name, [], false, true)
  } else if (collection.$permissions.length > 0 || collection.documentSecurity) {
    // Ouverte aux clients, elle exposerait les noms de fichiers (initiales, intitulé), les comptes rendus ou les modèles.
    console.error(`${c.id} : permissions client présentes (${collection.$permissions.join(', ') || 'documentSecurity'}). Retirez-les dans la console Appwrite.`)
    process.exitCode = 1
  }
  const existing = hasCollection ? (await db.listAttributes(DB, c.id)).attributes : []
  const existingAttrs = new Set(existing.map(a => a.key))
  // Un attribut déjà créé avec un autre type, une autre taille ou une autre obligation ferait échouer les écritures
  // de l'application : le script s'arrête au lieu de le laisser passer.
  let mismatch = false
  for (const [type, key, o] of c.attributes) {
    const a = existing.find(x => x.key === key)
    if (a && (a.type !== type || (o.size && a.size !== o.size) || a.required !== (o.required ?? false))) {
      console.error(`${c.id}.${key} existe déjà avec type ${a.type}, taille ${a.size ?? '-'}, obligatoire ${a.required} ; attendu ${type}, ${o.size ?? '-'}, ${o.required ?? false}. À corriger dans la console Appwrite.`)
      mismatch = true
    }
  }
  // Un attribut obligatoire que le code n'écrit pas ferait refuser chaque enregistrement.
  for (const a of existing) {
    if (a.required && !c.attributes.some(([, key]) => key === a.key)) {
      console.error(`${c.id}.${a.key} : attribut obligatoire inconnu du code (src/lib/cv-export/). À rendre facultatif ou à supprimer dans la console Appwrite.`)
      mismatch = true
    }
  }
  const total = new Set([...existingAttrs, ...c.attributes.map(a => a[1])]).size
  if (mismatch) {
    process.exitCode = 1
    return false
  }
  if (total > MAX_ATTRIBUTES) {
    console.error(`${c.id} : ${total} attributs après création, limite du projet ${MAX_ATTRIBUTES}. Rien n'est créé pour cette collection.`)
    process.exitCode = 1
    return false
  }
  console.log(`  ${c.id} : ${total}/${MAX_ATTRIBUTES} attributs`)
  for (const attr of c.attributes) {
    if (existingAttrs.has(attr[1])) continue
    console.log(`  + attribut ${c.id}.${attr[1]} (${attr[0]})`)
    if (apply) await createAttribute(c.id, attr)
  }
  if (apply) await waitForAttributes(c.id)
  if (beforeIndexes) await beforeIndexes(hasCollection)
  const existingIndexes = hasCollection ? (await db.listIndexes(DB, c.id)).indexes : []
  let indexesOk = true
  for (const [key, type, attributes] of c.indexes) {
    const found = existingIndexes.find(i => i.key === key)
    if (found) {
      // L'unicité évite les doublons de deux générations simultanées (saveCvExports) : un autre index ne la garantit pas.
      if (found.type !== type || found.attributes.join(',') !== attributes.join(',')) {
        console.error(`${c.id}.${key} existe avec type ${found.type} sur ${found.attributes.join(', ')} ; attendu ${type} sur ${attributes.join(', ')}. À corriger dans la console Appwrite.`)
        process.exitCode = 1
        indexesOk = false
      }
      continue
    }
    console.log(`  + index ${c.id}.${key} (${type})`)
    if (apply) await db.createIndex(DB, c.id, key, type, attributes)
  }
  if (apply) await waitForIndexes(c.id)
  return indexesOk
}

/** Versions d'avant ADR 0010 (sans organisation) : générées par l'admin, rattachées à la plateforme. */
async function backfillExportsTenant(hasCollection) {
  if (!hasCollection) return
  // Simulation : l'attribut n'existe peut-être pas encore (ou pas fini de créer), la requête serait refusée ; on compte.
  if (!apply && !(await db.listAttributes(DB, EXPORTS.id)).attributes.some(a => a.key === 'tenantId' && a.status === 'available')) {
    const { total } = await db.listDocuments(DB, EXPORTS.id, [Query.limit(1)])
    if (total > 0) console.log(`  ~ ${total} version(s) à rattacher à la plateforme (« ${PLATFORM_TENANT_ID} »)`)
    return
  }
  let updated = 0
  for (;;) {
    const { documents, total } = await db.listDocuments(DB, EXPORTS.id, [Query.isNull('tenantId'), Query.limit(100)])
    if (documents.length === 0) break
    if (!apply) {
      console.log(`  ~ ${total} version(s) à rattacher à la plateforme (« ${PLATFORM_TENANT_ID} »)`)
      return
    }
    for (const doc of documents) await db.updateDocument(DB, EXPORTS.id, doc.$id, { tenantId: PLATFORM_TENANT_ID })
    updated += documents.length
  }
  if (updated > 0) console.log(`  ~ ${updated} version(s) rattachée(s) à la plateforme (« ${PLATFORM_TENANT_ID} »)`)
}

/**
 * Ancien index unique (sans organisation), seulement avec --drop-old-index (après le déploiement) : supprimé une fois le
 * nouveau disponible et conforme, sans quoi plus rien ne garantirait l'unicité des versions.
 */
async function dropOldExportsIndex() {
  const { indexes } = await db.listIndexes(DB, EXPORTS.id).catch(e => { if (e.code === 404) return { indexes: [] }; throw e })
  const old = indexes.find(i => i.key === OLD_EXPORTS_INDEX)
  if (!old || old.status === 'deleting') return
  if (!dropOldIndex) {
    console.log(`  ${EXPORTS.id}.${OLD_EXPORTS_INDEX} gardé jusqu'au déploiement : relancez ensuite avec --apply --drop-old-index`)
    return
  }
  const [key, type, attributes] = EXPORTS.indexes[0]
  const replacement = indexes.find(i => i.key === key)
  const conforming = replacement && replacement.type === type && replacement.attributes.join(',') === attributes.join(',')
  if (!conforming || (apply && replacement.status !== 'available')) {
    console.error(`  ${EXPORTS.id}.${OLD_EXPORTS_INDEX} conservé : ${key} absent, non conforme ou pas encore disponible. Relancez le script.`)
    process.exitCode = 1
    return
  }
  console.log(`  - index ${EXPORTS.id}.${OLD_EXPORTS_INDEX} (remplacé par ${key})`)
  if (!apply) return
  try {
    await db.deleteIndex(DB, EXPORTS.id, OLD_EXPORTS_INDEX)
  } catch (err) {
    console.error(`  ${EXPORTS.id}.${OLD_EXPORTS_INDEX} non supprimé (${err.message}) : supprimez-le dans la console Appwrite, puis relancez.`)
    process.exitCode = 1
  }
}

async function ensureBucket(b) {
  const bucket = await storage.getBucket(b.id).catch(e => { if (e.code === 404) return null; throw e })
  if (!bucket) {
    console.log(`+ bucket ${b.id} (privé, chiffré, .docx, ${b.maxFileSize / 1024 / 1024} Mo max)`)
    // permissions [] + fileSecurity true sans permission sur les fichiers : aucun accès client, clé API seulement.
    if (apply) await storage.createBucket(b.id, b.name, [], true, true, b.maxFileSize, b.extensions, 'none', true, false)
    return
  }
  // Bucket créé à la main : il doit être aussi fermé et chiffré que celui du script, et accepter les .docx.
  const problems = [
    bucket.$permissions.length > 0 && `permissions client (${bucket.$permissions.join(', ')})`,
    !bucket.fileSecurity && 'fileSecurity désactivé',
    !bucket.enabled && 'bucket désactivé',
    !bucket.encryption && 'chiffrement désactivé',
    !bucket.allowedFileExtensions.includes('docx') && bucket.allowedFileExtensions.length > 0 && 'extension docx refusée',
    bucket.maximumFileSize < b.maxFileSize && `taille maximale ${bucket.maximumFileSize} o < ${b.maxFileSize} o`,
  ].filter(Boolean)
  if (problems.length > 0) {
    console.error(`bucket ${b.id} : ${problems.join(' ; ')}. À corriger dans la console Appwrite avant de définir les variables.`)
    process.exitCode = 1
  } else {
    console.log(`  bucket ${b.id} : présent, sans permission client, chiffré`)
  }
}

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'CRÉATION' : 'simulation (ajoutez --apply pour créer)'}`)

// Modèles et buckets d'abord : un échec de la migration de cv_exports ne les empêche pas.
await ensureCollection(TEMPLATES)
for (const b of BUCKETS) await ensureBucket(b)
if (await ensureCollection(EXPORTS, backfillExportsTenant)) await dropOldExportsIndex()

if (process.exitCode) console.error(apply ? 'Terminé avec des erreurs : voir ci-dessus.' : 'Simulation : erreurs à corriger, voir ci-dessus.')
else console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variables à définir (portée Preview d\'abord ; Production après --prod --apply) : APPWRITE_COLLECTION_CV_EXPORTS=cv_exports, APPWRITE_STORAGE_CV_EXPORTS=cv_exports, APPWRITE_COLLECTION_CV_TEMPLATES=cv_templates, APPWRITE_STORAGE_CV_TEMPLATES=cv_templates')
