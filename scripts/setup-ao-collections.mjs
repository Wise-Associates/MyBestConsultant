#!/usr/bin/env node
// Crée les collections du module AO Offers dans un projet Appwrite (idempotent : l'existant est conservé).
// Passage aux boîtes par organisation (ADR 0005) : lancer ensuite scripts/ao-sources-migrate.mts.
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
//   APPWRITE_COLLECTION_AO_STATE=ao_sync_state
//   APPWRITE_COLLECTION_AO_SOURCES=ao_sources
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
    id: 'ao_emails',
    name: 'AO emails',
    attributes: [
      // Boîte lue (ao_sources) : un même Message-ID reçu par deux boîtes est suivi deux fois.
      ['string', 'sourceId', { size: 36 }],
      ['string', 'messageId', { size: 500, required: true }],
      ['integer', 'uid', { required: true, min: 0 }],
      ['string', 'fromAddress', { size: 320 }],
      ['string', 'fromName', { size: 200 }],
      // Expéditeur du message d'origine, « Nom <adresse> » (src/lib/ao/origin.ts) ; date limite de réponse et clients
      // cités (masqués à la publication) : sur l'e-mail, ao_offers étant à 16/16 attributs.
      ['string', 'origin', { size: 530 }],
      ['string', 'deadline', { size: 100 }],
      ['string', 'citedClients', { size: 200, array: true }],
      ['string', 'subject', { size: 500 }],
      ['datetime', 'receivedAt', {}],
      ['string', 'attachments', { size: 255, array: true }],
      ['string', 'status', { size: 20, required: true }],
      ['string', 'error', { size: 1000 }],
      ['integer', 'offerCount', { min: 0, default: 0 }],
      ['integer', 'duplicateCount', { min: 0, default: 0 }],
      ['integer', 'attempts', { min: 0, default: 0 }],
    ],
    // L'ancien index unique sur messageId seul (messageid_unique) est supprimé par scripts/ao-sources-migrate.mts.
    indexes: [['source_message_unique', 'unique', ['sourceId', 'messageId']], ['receivedat', 'key', ['receivedAt']], ['status', 'key', ['status']]],
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
  {
    // État de la synchronisation : verrou (un seul passage à la fois), point de reprise par boîte lue,
    // compteur quotidien des lectures par l'IA.
    id: 'ao_sync_state',
    name: 'AO sync state',
    attributes: [
      ['string', 'kind', { size: 20, required: true }],
      ['string', 'holder', { size: 200 }],
      ['string', 'token', { size: 36 }],
      ['datetime', 'expiresAt', {}],
      ['string', 'uidValidity', { size: 40 }],
      ['integer', 'lastUid', { min: 0 }],
      ['datetime', 'reconciledAt', {}],
      ['integer', 'count', { min: 0 }],
    ],
    // Places des limites quotidiennes (state.ts : takeDailySlot) comptées par holder ; purge par kind.
    indexes: [['holder', 'key', ['holder']], ['kind', 'key', ['kind']]],
  },
  {
    // Commentaires internes sur une offre AO (src/lib/ao/comments.ts) : visibles des seuls utilisateurs de l'organisation
    // de l'offre, purgés avec les e-mails et offres (365 jours).
    id: 'ao_comments',
    name: 'AO comments',
    attributes: [
      ['string', 'offerId', { size: 36, required: true }],
      ['string', 'tenantId', { size: 36, required: true }],
      ['string', 'authorId', { size: 36, required: true }],
      ['string', 'authorName', { size: 200 }],
      ['string', 'body', { size: 5000, required: true }],
    ],
    indexes: [['offerid', 'key', ['offerId']]],
  },
  {
    // Détails d'une offre hors du modèle d'import (src/lib/ao/types.ts : AoOfferDetails) : document de même identifiant
    // que l'offre (ao_offers est à 16/16 attributs), supprimé avec elle par la purge.
    id: 'ao_offer_details',
    name: 'AO offer details',
    attributes: [
      ['string', 'engagement', { size: 20 }],
      ['string', 'technologies', { size: 60, array: true }],
      // Dernier sourcing d'une offre non publiée (JSON : date, CV analysés, candidats retenus : identifiant, score,
      // raison ; jamais le nom ni l'e-mail, relus dans la fiche du candidat à l'affichage).
      ['string', 'sourcing', { size: 5000 }],
    ],
    indexes: [],
  },
  {
    // Boîtes lues : celles de la plateforme (tenantId « admin ») et celles des organisations (src/lib/ao/sources.ts).
    // Mot de passe chiffré avec AO_CREDENTIALS_KEY (src/lib/ao/credentials.ts), jamais en clair.
    id: 'ao_sources',
    name: 'AO sources',
    attributes: [
      ['string', 'tenantId', { size: 36, required: true }],
      ['string', 'label', { size: 200 }],
      ['string', 'host', { size: 253, required: true }],
      ['string', 'username', { size: 320, required: true }],
      ['string', 'passwordSealed', { size: 2000, required: true }],
      ['string', 'mailbox', { size: 200 }],
      ['boolean', 'enabled', { default: true }],
      ['string', 'ownDomains', { size: 253, array: true }],
      ['datetime', 'lastSyncAt', {}],
      ['string', 'lastError', { size: 1000 }],
    ],
    indexes: [['tenantid', 'key', ['tenantId']], ['enabled', 'key', ['enabled']], ['lastsyncat', 'key', ['lastSyncAt']]],
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
  if (type === 'boolean') return db.createBooleanAttribute(DB, collection, key, required, def)
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

// Les index sont créés en arrière-plan, comme les attributs : un index « failed » ne garantirait plus rien (unicité).
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
  const existingAttrs = hasCollection ? new Set((await db.listAttributes(DB, c.id)).attributes.map(a => a.key)) : new Set()
  // Limite du projet : le total (attributs existants, y compris hors de ce schéma, et nouveaux) ne doit pas la dépasser.
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
console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variables à définir : APPWRITE_COLLECTION_AO_EMAILS=ao_emails  APPWRITE_COLLECTION_AO_OFFERS=ao_offers  APPWRITE_COLLECTION_AO_STATE=ao_sync_state  APPWRITE_COLLECTION_AO_SOURCES=ao_sources  APPWRITE_COLLECTION_AO_OFFER_DETAILS=ao_offer_details  APPWRITE_COLLECTION_AO_COMMENTS=ao_comments')
