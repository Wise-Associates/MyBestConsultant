#!/usr/bin/env node
// Crée la collection de l'assistant IA dans un projet Appwrite (idempotent : l'existant est conservé).
// Même fonctionnement que scripts/setup-ao-collections.mjs.
//
//   npm run assistant:setup -- .env.dev                → affiche ce qui manque, ne modifie rien
//   npm run assistant:setup -- .env.dev --apply        → crée ce qui manque (projet DEV)
//   npm run assistant:setup -- .env --prod             → simulation sur la production
//   npm run assistant:setup -- .env --prod --apply     → production (à lancer par un humain)
//
// Le fichier d'environnement fournit APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY et APPWRITE_DB_ID.
// Ensuite, ajoutez dans ce même environnement (fichier local ET variables Vercel) :
//   APPWRITE_COLLECTION_ASSISTANT_TURNS=assistant_turns
// La collection n'a aucune permission client : seule la clé API serveur y accède (src/lib/assistant/host.ts).
import { Client, Databases } from 'node-appwrite'
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
  console.error('Usage : npm run assistant:setup -- <fichier .env> [--apply] [--prod]')
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
const db = new Databases(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))
const DB = env.APPWRITE_DB_ID

// [type, clé, options] — 16 attributs maximum par collection (limite du projet, voir AGENTS.md).
const SCHEMA = [
  {
    // Un document par échange : la question et la réponse sont enregistrées ensemble. Données personnelles
    // possibles (texte libre) : supprimées après 90 jours (/api/cron/assistant-purge) et avec le compte.
    id: 'assistant_turns',
    name: 'Assistant turns',
    attributes: [
      ['string', 'conversationId', { size: 36, required: true }],
      ['string', 'userId', { size: 36, required: true }],
      // Tailles : MAX_MESSAGE_LENGTH et MAX_ANSWER_LENGTH de src/assistant/core/rules.ts.
      ['string', 'question', { size: 2000, required: true }],
      ['string', 'answer', { size: 8000, required: true }],
      // Modèle qui a répondu (Config IA), pour le suivi de la qualité et des coûts.
      ['string', 'provider', { size: 60 }],
    ],
    indexes: [['userid', 'key', ['userId']], ['conversationid', 'key', ['conversationId']]],
  },
]

async function exists(fn) {
  try { await fn(); return true } catch (e) { if (e.code === 404) return false; throw e }
}

function createAttribute(collection, [type, key, o]) {
  const required = o.required ?? false
  const def = required ? undefined : o.default
  if (type === 'string') return db.createStringAttribute(DB, collection, key, o.size, required, def, o.array ?? false)
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
for (const c of SCHEMA) {
  const hasCollection = await exists(() => db.getCollection(DB, c.id))
  if (!hasCollection) {
    console.log(`+ collection ${c.id}`)
    if (apply) await db.createCollection(DB, c.id, c.name, [], false, true)
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
  if (mismatch) { process.exitCode = 1; continue }
  const total = new Set([...existingAttrs, ...c.attributes.map(a => a[1])]).size
  if (total > MAX_ATTRIBUTES) {
    console.error(`${c.id} : ${total} attributs après création, limite du projet ${MAX_ATTRIBUTES}. Rien n'est créé pour cette collection.`)
    process.exitCode = 1
    continue
  }
  console.log(`  ${c.id} : ${total}/${MAX_ATTRIBUTES} attributs`)
  for (const attr of c.attributes) {
    if (existingAttrs.has(attr[1])) continue
    console.log(`  + attribut ${c.id}.${attr[1]} (${attr[0]})`)
    if (apply) await createAttribute(c.id, attr)
  }
  if (apply) await waitForAttributes(c.id)
  const existingIndexes = hasCollection ? new Set((await db.listIndexes(DB, c.id)).indexes.map(i => i.key)) : new Set()
  for (const [key, type, attributes] of c.indexes) {
    if (existingIndexes.has(key)) continue
    console.log(`  + index ${c.id}.${key} (${type})`)
    if (apply) await db.createIndex(DB, c.id, key, type, attributes)
  }
  if (apply) await waitForIndexes(c.id)
}
if (process.exitCode) console.error(apply ? 'Terminé avec des erreurs : voir ci-dessus.' : 'Simulation : erreurs à corriger, voir ci-dessus.')
else console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variable à définir : APPWRITE_COLLECTION_ASSISTANT_TURNS=assistant_turns (portée Preview d\'abord ; Production après --prod --apply)')
