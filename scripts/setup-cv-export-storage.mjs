#!/usr/bin/env node
// Crée la collection et le bucket des exports de CV au format ESN dans un projet Appwrite (idempotent : l'existant
// est conservé). Même fonctionnement que scripts/setup-assistant-collections.mjs.
//
//   npm run cv-export:setup -- .env.dev                → affiche ce qui manque, ne modifie rien
//   npm run cv-export:setup -- .env.dev --apply        → crée ce qui manque (projet DEV)
//   npm run cv-export:setup -- .env --prod             → simulation sur la production
//   npm run cv-export:setup -- .env --prod --apply     → production (à lancer par un humain)
//
// Le fichier d'environnement fournit APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY et APPWRITE_DB_ID.
// Ensuite, ajoutez dans ce même environnement (fichier local ET variables Vercel) :
//   APPWRITE_COLLECTION_CV_EXPORTS=cv_exports
//   APPWRITE_STORAGE_CV_EXPORTS=cv_exports
// Ni la collection ni le bucket n'ont de permission client : seule la clé API serveur y accède (src/lib/cv-export/store.ts).
import { Client, Databases, Storage } from 'node-appwrite'
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

// Un document par candidat, anonymisation et langue (dernière version seulement, remplacée à chaque génération).
// Données personnelles (CV pseudonymisé) : supprimées avec le compte du candidat (deleteUserAccount), sans autre durée.
const COLLECTION = {
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
  ],
  // Unique : deux générations simultanées de la même version ne créent pas de doublon (saveCvExports).
  indexes: [['candidateversion', 'unique', ['candidateId', 'mode', 'lang']]],
}

// Fichiers .docx générés par le serveur : chiffrés au repos, 10 Mo au plus (un dossier fait environ 100 Ko).
const BUCKET = { id: 'cv_exports', name: 'CV exports (format ESN)', maxFileSize: 10 * 1024 * 1024, extensions: ['docx'] }

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
    if (failed.length) throw new Error(`Index en échec : ${failed.map(x => `${x.key} (${x.error || x.status})`).join(', ')}`)
    if (indexes.every(x => x.status === 'available')) return
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('Index toujours en cours de création après 60 s')
}

const MAX_ATTRIBUTES = 16

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'CRÉATION' : 'simulation (ajoutez --apply pour créer)'}`)

const c = COLLECTION
const collection = await db.getCollection(DB, c.id).catch(e => { if (e.code === 404) return null; throw e })
const hasCollection = collection !== null
if (!hasCollection) {
  console.log(`+ collection ${c.id}`)
  if (apply) await db.createCollection(DB, c.id, c.name, [], false, true)
} else if (collection.$permissions.length > 0 || collection.documentSecurity) {
  // Ouverte aux clients, elle exposerait les noms de fichiers (initiales, intitulé) et les comptes rendus.
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
    console.error(`${c.id}.${a.key} : attribut obligatoire inconnu du code (src/lib/cv-export/store.ts). À rendre facultatif ou à supprimer dans la console Appwrite.`)
    mismatch = true
  }
}
const total = new Set([...existingAttrs, ...c.attributes.map(a => a[1])]).size
if (mismatch) {
  process.exitCode = 1
} else if (total > MAX_ATTRIBUTES) {
  console.error(`${c.id} : ${total} attributs après création, limite du projet ${MAX_ATTRIBUTES}. Rien n'est créé pour cette collection.`)
  process.exitCode = 1
} else {
  console.log(`  ${c.id} : ${total}/${MAX_ATTRIBUTES} attributs`)
  for (const attr of c.attributes) {
    if (existingAttrs.has(attr[1])) continue
    console.log(`  + attribut ${c.id}.${attr[1]} (${attr[0]})`)
    if (apply) await createAttribute(c.id, attr)
  }
  if (apply) await waitForAttributes(c.id)
  const existingIndexes = hasCollection ? (await db.listIndexes(DB, c.id)).indexes : []
  for (const [key, type, attributes] of c.indexes) {
    const found = existingIndexes.find(i => i.key === key)
    if (found) {
      // L'unicité évite les doublons de deux générations simultanées (saveCvExports) : un autre index ne la garantit pas.
      if (found.type !== type || found.attributes.join(',') !== attributes.join(',')) {
        console.error(`${c.id}.${key} existe avec type ${found.type} sur ${found.attributes.join(', ')} ; attendu ${type} sur ${attributes.join(', ')}. À corriger dans la console Appwrite.`)
        process.exitCode = 1
      }
      continue
    }
    console.log(`  + index ${c.id}.${key} (${type})`)
    if (apply) await db.createIndex(DB, c.id, key, type, attributes)
  }
  if (apply) await waitForIndexes(c.id)
}

const bucket = await storage.getBucket(BUCKET.id).catch(e => { if (e.code === 404) return null; throw e })
if (!bucket) {
  console.log(`+ bucket ${BUCKET.id} (privé, chiffré, .docx, ${BUCKET.maxFileSize / 1024 / 1024} Mo max)`)
  // permissions [] + fileSecurity true sans permission sur les fichiers : aucun accès client, clé API seulement.
  if (apply) await storage.createBucket(BUCKET.id, BUCKET.name, [], true, true, BUCKET.maxFileSize, BUCKET.extensions, 'none', true, false)
} else {
  // Bucket créé à la main : il doit être aussi fermé et chiffré que celui du script, et accepter les .docx.
  const problems = [
    bucket.$permissions.length > 0 && `permissions client (${bucket.$permissions.join(', ')})`,
    !bucket.fileSecurity && 'fileSecurity désactivé',
    !bucket.enabled && 'bucket désactivé',
    !bucket.encryption && 'chiffrement désactivé',
    !bucket.allowedFileExtensions.includes('docx') && bucket.allowedFileExtensions.length > 0 && 'extension docx refusée',
    bucket.maximumFileSize < BUCKET.maxFileSize && `taille maximale ${bucket.maximumFileSize} o < ${BUCKET.maxFileSize} o`,
  ].filter(Boolean)
  if (problems.length > 0) {
    console.error(`bucket ${BUCKET.id} : ${problems.join(' ; ')}. À corriger dans la console Appwrite avant de définir les variables.`)
    process.exitCode = 1
  } else {
    console.log(`  bucket ${BUCKET.id} : présent, sans permission client, chiffré`)
  }
}

if (process.exitCode) console.error(apply ? 'Terminé avec des erreurs : voir ci-dessus.' : 'Simulation : erreurs à corriger, voir ci-dessus.')
else console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variables à définir : APPWRITE_COLLECTION_CV_EXPORTS=cv_exports et APPWRITE_STORAGE_CV_EXPORTS=cv_exports (portée Preview d\'abord ; Production après --prod --apply)')
