// Duplicate an Appwrite database (collections, attributes, indexes, documents)
// into a new database in the same project.
// Usage: node _duplicate-db.mjs <targetDbId> [sourceDbId = APPWRITE_DB_ID]
import { Client, Databases, Query } from 'node-appwrite'
import { readFileSync } from 'fs'
import net from 'net'

// The server's TCP handshake takes ~240ms, right at Node's 250ms IPv4 attempt timeout;
// on a miss Node falls back to IPv6 (unreachable here) and the request fails with ETIMEDOUT
net.setDefaultAutoSelectFamilyAttemptTimeout(2000)

for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const [target, source = process.env.APPWRITE_DB_ID] = process.argv.slice(2)
if (!target || target === source) {
  console.error('Usage: node _duplicate-db.mjs <targetDbId> [sourceDbId]')
  process.exit(1)
}

const databases = new Databases(
  new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY),
)

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
  const base = [target, colId, a.key]
  switch (a.format || a.type) {
    case 'email': return databases.createEmailAttribute(...base, a.required, def(a), a.array)
    case 'url': return databases.createUrlAttribute(...base, a.required, def(a), a.array)
    case 'ip': return databases.createIpAttribute(...base, a.required, def(a), a.array)
    case 'enum': return databases.createEnumAttribute(...base, a.elements, a.required, def(a), a.array)
    case 'string': return databases.createStringAttribute(...base, a.size, a.required, def(a), a.array)
    case 'integer': return databases.createIntegerAttribute(...base, a.required, bound(a.min), bound(a.max), def(a), a.array)
    case 'double': return databases.createFloatAttribute(...base, a.required, bound(a.min), bound(a.max), def(a), a.array)
    case 'boolean': return databases.createBooleanAttribute(...base, a.required, def(a), a.array)
    case 'datetime': return databases.createDatetimeAttribute(...base, a.required, def(a), a.array)
    default: throw new Error(`${colId}.${a.key}: unsupported attribute type ${a.type}/${a.format}`)
  }
}

const collections = await listAll((q) => databases.listCollections(source, q), 'collections')

// Relationship attributes need a two-pass document copy; refuse rather than half-copy them
const relationships = collections.flatMap((c) =>
  c.attributes.filter((a) => a.type === 'relationship').map((a) => `${c.$id}.${a.key}`),
)
if (relationships.length) {
  console.error(`Relationship attributes not supported: ${relationships.join(', ')}`)
  process.exit(1)
}

const sourceDb = await databases.get(source)
await databases.create(target, `${sourceDb.name} (copy)`, sourceDb.enabled)
console.log(`Created database ${target} — ${collections.length} collections to copy`)

for (const c of collections) {
  await databases.createCollection(target, c.$id, c.name, c.$permissions, c.documentSecurity, c.enabled)

  for (const a of c.attributes) await createAttribute(c.$id, a)
  for (const a of c.attributes) {
    await waitAvailable(() => databases.getAttribute(target, c.$id, a.key), `${c.$id}.${a.key}`)
  }

  for (const i of c.indexes) await databases.createIndex(target, c.$id, i.key, i.type, i.attributes, i.orders)
  for (const i of c.indexes) {
    await waitAvailable(() => databases.getIndex(target, c.$id, i.key), `${c.$id} index ${i.key}`)
  }

  let copied = 0
  let cursor
  for (;;) {
    const { documents } = await databases.listDocuments(source, c.$id, [
      Query.limit(100),
      ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    await Promise.all(
      documents.map((doc) => {
        const data = Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('$')))
        return databases.createDocument(target, c.$id, doc.$id, data, doc.$permissions)
      }),
    )
    copied += documents.length
    if (documents.length < 100) break
    cursor = documents.at(-1).$id
  }
  console.log(`  ${c.$id}: ${c.attributes.length} attrs, ${c.indexes.length} indexes, ${copied} docs`)
}

console.log(`Done. Point APPWRITE_DB_ID at "${target}" to use the copy.`)
