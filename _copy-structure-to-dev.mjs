// Copy the production database STRUCTURE into the dev project, without personal data:
// every collection (attributes + indexes) and every bucket's settings, but documents only
// for CONTENT_COLLECTIONS. No users, no files. Prod is only read.
// Source: .env (prod project) — Target: .env.dev (dev project, existing empty database APPWRITE_DB_ID)
// Usage: node _copy-structure-to-dev.mjs
import { Client, Databases, Query, Storage } from 'node-appwrite'
import { readFileSync } from 'fs'
import net from 'net'

// The server's TCP handshake takes ~240ms, right at Node's 250ms IPv4 attempt timeout;
// on a miss Node falls back to IPv6 (unreachable here) and the request fails with ETIMEDOUT
net.setDefaultAutoSelectFamilyAttemptTimeout(2000)

const PROD_DB_ID = 'bestconsult'
// Public site content and non-secret settings. Left out on purpose: every collection holding
// personal data, LINKEDIN_CONFIG (access token, Make webhook) and analytics_config (service account key)
const CONTENT_COLLECTIONS = ['pages', 'blog_posts', 'templates_config', 'site_layout', 'ai_config']

function readEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)="?(.*?)"?$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const prodEnv = readEnv('.env')
const devEnv = readEnv('.env.dev')
const devDbId = devEnv.APPWRITE_DB_ID

if (!devDbId || devEnv.APPWRITE_PROJECT_ID === prodEnv.APPWRITE_PROJECT_ID) {
  console.error('.env.dev must point at a different project than .env and set APPWRITE_DB_ID')
  process.exit(1)
}

const connect = (env) =>
  new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY)
const prod = { databases: new Databases(connect(prodEnv)), storage: new Storage(connect(prodEnv)) }
const dev = { databases: new Databases(connect(devEnv)), storage: new Storage(connect(devEnv)) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Unset numeric bounds come back as ±2^63 / ±1.79e308, which can't be sent back as-is
const bound = (v) => (v == null || Math.abs(v) >= Number.MAX_SAFE_INTEGER ? undefined : v)
// Required attributes can't have a default
const def = (a) => (a.required || a.default == null ? undefined : a.default)

async function listAll(fetchPage, key) {
  const items = []
  for (;;) {
    const cursor = items.at(-1)?.$id
    const page = await fetchPage([Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])])
    items.push(...page[key])
    if (page[key].length < 100) return items
  }
}

async function waitAvailable(get, label) {
  for (;;) {
    const { status, error } = await get()
    if (status === 'available') return
    if (status === 'failed' || status === 'stuck') throw new Error(`${label}: ${status} ${error}`)
    await sleep(500)
  }
}

function createAttribute(colId, a) {
  const base = [devDbId, colId, a.key]
  const db = dev.databases
  switch (a.format || a.type) {
    case 'email': return db.createEmailAttribute(...base, a.required, def(a), a.array)
    case 'url': return db.createUrlAttribute(...base, a.required, def(a), a.array)
    case 'ip': return db.createIpAttribute(...base, a.required, def(a), a.array)
    case 'enum': return db.createEnumAttribute(...base, a.elements, a.required, def(a), a.array)
    case 'string': return db.createStringAttribute(...base, a.size, a.required, def(a), a.array)
    case 'integer': return db.createIntegerAttribute(...base, a.required, bound(a.min), bound(a.max), def(a), a.array)
    case 'double': return db.createFloatAttribute(...base, a.required, bound(a.min), bound(a.max), def(a), a.array)
    case 'boolean': return db.createBooleanAttribute(...base, a.required, def(a), a.array)
    case 'datetime': return db.createDatetimeAttribute(...base, a.required, def(a), a.array)
    default: throw new Error(`${colId}.${a.key}: unsupported attribute type ${a.type}/${a.format}`)
  }
}

const [devCollections, devBuckets] = await Promise.all([
  dev.databases.listCollections(devDbId, [Query.limit(1)]),
  dev.storage.listBuckets([Query.limit(1)]),
])
if (devCollections.total || devBuckets.total) {
  console.error(`Dev project is not empty (${devCollections.total} collections, ${devBuckets.total} buckets) — copy only runs into an empty one`)
  process.exit(1)
}

const collections = await listAll((q) => prod.databases.listCollections(PROD_DB_ID, q), 'collections')
const relationships = collections.flatMap((c) =>
  c.attributes.filter((a) => a.type === 'relationship').map((a) => `${c.$id}.${a.key}`),
)
if (relationships.length) {
  console.error(`Relationship attributes not supported: ${relationships.join(', ')}`)
  process.exit(1)
}

console.log(`${prodEnv.APPWRITE_PROJECT_ID}/${PROD_DB_ID} → ${devEnv.APPWRITE_PROJECT_ID}/${devDbId}: ${collections.length} collections`)

for (const c of collections) {
  await dev.databases.createCollection(devDbId, c.$id, c.name, c.$permissions, c.documentSecurity, c.enabled)

  for (const a of c.attributes) await createAttribute(c.$id, a)
  for (const a of c.attributes) {
    await waitAvailable(() => dev.databases.getAttribute(devDbId, c.$id, a.key), `${c.$id}.${a.key}`)
  }

  for (const i of c.indexes) await dev.databases.createIndex(devDbId, c.$id, i.key, i.type, i.attributes, i.orders)
  for (const i of c.indexes) {
    await waitAvailable(() => dev.databases.getIndex(devDbId, c.$id, i.key), `${c.$id} index ${i.key}`)
  }

  let copied = 0
  if (CONTENT_COLLECTIONS.includes(c.$id)) {
    const documents = await listAll((q) => prod.databases.listDocuments(PROD_DB_ID, c.$id, q), 'documents')
    for (const doc of documents) {
      const data = Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('$')))
      await dev.databases.createDocument(devDbId, c.$id, doc.$id, data, doc.$permissions)
    }
    copied = documents.length
  }
  console.log(`  ${c.$id}: ${c.attributes.length} attrs, ${c.indexes.length} indexes, ${copied} docs`)
}

const buckets = await listAll((q) => prod.storage.listBuckets(q), 'buckets')
for (const b of buckets) {
  await dev.storage.createBucket(b.$id, b.name, b.$permissions, b.fileSecurity, b.enabled,
    b.maximumFileSize, b.allowedFileExtensions, b.compression, b.encryption, b.antivirus)
}
console.log(`Buckets (settings only, no files): ${buckets.map((b) => b.$id).join(', ')}`)
