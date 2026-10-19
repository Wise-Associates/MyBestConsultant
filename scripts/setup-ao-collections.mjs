#!/usr/bin/env node
// Crée les deux collections du module AO Offers dans un projet Appwrite (idempotent : l'existant est conservé).
//
//   npm run ao:setup -- .env.dev                → affiche ce qui manque, ne modifie rien
//   npm run ao:setup -- .env.dev --apply        → crée ce qui manque (projet DEV)
//   npm run ao:setup -- .env --prod             → simulation sur la production
//   npm run ao:setup -- .env --prod --apply     → production (à lancer par un humain)
//
// Le script npm ajoute --network-family-autoselection-attempt-timeout=2000 (même réglage que .claude/launch.json) :
// sans lui, la connexion à Appwrite expire sur les réseaux sans IPv6.
// Le fichier d'environnement fournit APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY et APPWRITE_DB_ID.
// Ensuite, ajoutez dans ce même environnement (fichier local ET variables Vercel) :
//   APPWRITE_COLLECTION_AO_EMAILS=ao_emails
//   APPWRITE_COLLECTION_AO_OFFERS=ao_offers
// Les collections n'ont aucune permission client : seules la clé API serveur et l'admin y accèdent.
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
  console.error('Usage : npm run ao:setup -- <fichier .env> [--apply] [--prod]')
  process.exit(1)
}
const apply = flags.includes('--apply')
if (/(^|\/)\.env$/.test(file) && !flags.includes('--prod')) {
  console.error('« .env » désigne la production : ajoutez --prod pour confirmer.')
  process.exit(1)
}
const env = readEnv(file)
for (const key of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID']) {
  if (!env[key]) { console.error(`${key} manquant dans ${file}`); process.exit(1) }
}
const db = new Databases(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))
const DB = env.APPWRITE_DB_ID

// [type, clé, options] — 16 attributs maximum par collection (limite du projet, voir AGENTS.md).
const SCHEMA = [
  {
    id: 'ao_emails',
    name: 'AO emails',
    attributes: [
      ['string', 'messageId', { size: 500, required: true }],
      ['integer', 'uid', { required: true, min: 0 }],
      ['string', 'fromAddress', { size: 320 }],
      ['string', 'fromName', { size: 200 }],
      ['string', 'subject', { size: 500 }],
      ['datetime', 'receivedAt', {}],
      ['string', 'attachments', { size: 255, array: true }],
      ['string', 'status', { size: 20, required: true }],
      ['string', 'error', { size: 1000 }],
      ['integer', 'offerCount', { min: 0, default: 0 }],
      ['integer', 'duplicateCount', { min: 0, default: 0 }],
      ['integer', 'attempts', { min: 0, default: 0 }],
    ],
    indexes: [['messageid_unique', 'unique', ['messageId']], ['receivedat', 'key', ['receivedAt']], ['status', 'key', ['status']]],
  },
  {
    id: 'ao_offers',
    name: 'AO offers',
    attributes: [
      ['string', 'title', { size: 200, required: true }],
      ['string', 'companyName', { size: 200 }],
      ['string', 'location', { size: 200 }],
      ['string', 'contractType', { size: 20 }],
      ['string', 'remote', { size: 20 }],
      ['integer', 'salary', { min: 0, max: 999999 }],
      ['string', 'skills', { size: 60, array: true }],
      ['string', 'description', { size: 20000 }],
      ['string', 'duration', { size: 100 }],
      ['string', 'startDate', { size: 100 }],
      ['string', 'experience', { size: 100 }],
      ['string', 'fingerprint', { size: 40, required: true }],
      ['string', 'emailId', { size: 36 }],
      ['string', 'status', { size: 20, required: true }],
      ['string', 'jobId', { size: 36 }],
      ['integer', 'sourceCount', { min: 1, default: 1 }],
    ],
    indexes: [['fingerprint', 'key', ['fingerprint']], ['status', 'key', ['status']]],
  },
]

async function exists(fn) {
  try { await fn(); return true } catch (e) { if (e.code === 404) return false; throw e }
}

function createAttribute(collection, [type, key, o]) {
  const required = o.required ?? false
  const def = required ? undefined : o.default
  if (type === 'string') return db.createStringAttribute(DB, collection, key, o.size, required, def, o.array ?? false)
  if (type === 'integer') return db.createIntegerAttribute(DB, collection, key, required, o.min, o.max, def)
  if (type === 'datetime') return db.createDatetimeAttribute(DB, collection, key, required, def)
  throw new Error(`type inconnu : ${type}`)
}

// Les attributs sont créés en arrière-plan par Appwrite : il faut attendre « available » avant les index.
async function waitForAttributes(collection) {
  for (let i = 0; i < 60; i++) {
    const { attributes } = await db.listAttributes(DB, collection)
    const failed = attributes.filter(a => a.status === 'failed')
    if (failed.length) throw new Error(`Attributs en échec : ${failed.map(a => a.key).join(', ')}`)
    if (attributes.every(a => a.status === 'available')) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('Attributs toujours en cours de création après 60 s')
}

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'CRÉATION' : 'simulation (ajoutez --apply pour créer)'}`)
for (const c of SCHEMA) {
  const hasCollection = await exists(() => db.getCollection(DB, c.id))
  if (!hasCollection) {
    console.log(`+ collection ${c.id}`)
    if (apply) await db.createCollection(DB, c.id, c.name, [], false, true)
  }
  const existingAttrs = hasCollection ? new Set((await db.listAttributes(DB, c.id)).attributes.map(a => a.key)) : new Set()
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
}
console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variables à définir : APPWRITE_COLLECTION_AO_EMAILS=ao_emails  APPWRITE_COLLECTION_AO_OFFERS=ao_offers')
