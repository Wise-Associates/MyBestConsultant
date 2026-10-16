// Copy production DATA into the dev project, on top of the structure made by
// _copy-structure-to-dev.mjs: auth users (with their password hashes, so logins work),
// every document and every storage file. Prod is only read.
// Safe to re-run: existing users and files are skipped, existing documents are overwritten.
// Source: .env (prod project) — Target: .env.dev (dev project)
// Usage: node _copy-content-to-dev.mjs [users] [documents] [files]   (no argument = all three)
import { Client, Databases, Query, Storage, Users } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { readFileSync } from 'fs'
import dns from 'dns'
import net from 'net'

// This machine has no IPv6 route and the server's TCP handshake is slow (~240ms, more under load):
// connect over IPv4 only and let the OS retry the handshake instead of Node's happy-eyeballs cutoff
dns.setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamily(false)

const PROD_DB_ID = 'bestconsult'
const steps = process.argv.length > 2 ? process.argv.slice(2) : ['users', 'documents', 'files']
// Blanked in dev: they would let dev post on the real LinkedIn page, trigger the prod
// Make scenarios, or read Google Analytics with the prod service account
const SECRET_FIELDS = {
  LINKEDIN_CONFIG: ['linkedinAccessToken', 'makeWebhookUrl'],
  '6a7f4525000c00fb276a': ['serviceAccountJson'],
}

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
const prod = { users: new Users(connect(prodEnv)), databases: new Databases(connect(prodEnv)), storage: new Storage(connect(prodEnv)) }
const dev = { users: new Users(connect(devEnv)), databases: new Databases(connect(devEnv)), storage: new Storage(connect(devEnv)) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retry dropped connections (fetch throws a TypeError without a status code), never Appwrite errors.
// Every step below is safe to repeat: creates fall back on "already exists".
async function retry(fn, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (typeof e?.code === 'number' || i === attempts) throw e
      await sleep(2000 * i)
    }
  }
}

async function listAll(fetchPage, key) {
  const items = []
  for (;;) {
    const cursor = items.at(-1)?.$id
    const page = await retry(() => fetchPage([Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]))
    items.push(...page[key])
    if (page[key].length < 100) return items
  }
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item) => retry(() => fn(item))))
  }
}

const alreadyExists = (e) => e?.code === 409

// Stored file URLs (logoUrl, coverImageUrl, page sections…) end in ?project=<prod>; point them at dev
const prodProjectParam = new RegExp(`project=${prodEnv.APPWRITE_PROJECT_ID.replace(/\./g, '\\.')}(?![\\w.-])`, 'g')
const toDev = (v) =>
  typeof v === 'string' ? v.replace(prodProjectParam, `project=${devEnv.APPWRITE_PROJECT_ID}`)
    : Array.isArray(v) ? v.map(toDev)
      : v

console.log(`${prodEnv.APPWRITE_PROJECT_ID} → ${devEnv.APPWRITE_PROJECT_ID}`)

// ── Auth users ──

const users = steps.includes('users') ? await listAll((q) => prod.users.list(q), 'users') : []
let usersSkipped = 0
await inBatches(users, 10, async (u) => {
  try {
    if (u.password) {
      if (u.hash !== 'argon2') throw new Error(`user ${u.$id}: unsupported password hash ${u.hash}`)
      await dev.users.createArgon2User(u.$id, u.email, u.password, u.name)
    } else {
      await dev.users.create(u.$id, u.email || undefined, undefined, undefined, u.name)
    }
  } catch (e) {
    if (!alreadyExists(e)) throw e
    usersSkipped++
  }
  // Re-applied even when the user already exists, in case a previous run stopped mid-user
  // Setting the same phone again fails with user_target_already_exists
  if (u.phone) await dev.users.updatePhone(u.$id, u.phone).catch((e) => { if (!alreadyExists(e)) throw e })
  if (u.labels.length) await dev.users.updateLabels(u.$id, u.labels)
  if (u.emailVerification) await dev.users.updateEmailVerification(u.$id, true)
  if (Object.keys(u.prefs).length) await dev.users.updatePrefs(u.$id, u.prefs)
  if (!u.status) await dev.users.updateStatus(u.$id, false)
})
if (steps.includes('users')) console.log(`Auth users: ${users.length} (${usersSkipped} already in dev)`)

// ── Documents ──

const collections = steps.includes('documents')
  ? await listAll((q) => prod.databases.listCollections(PROD_DB_ID, q), 'collections')
  : []
for (const c of collections) {
  const documents = await listAll((q) => prod.databases.listDocuments(PROD_DB_ID, c.$id, q), 'documents')
  await inBatches(documents, 10, async (doc) => {
    const data = Object.fromEntries(
      Object.entries(doc).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, toDev(v)]),
    )
    for (const field of SECRET_FIELDS[c.$id] ?? []) data[field] = null
    try {
      await dev.databases.createDocument(devDbId, c.$id, doc.$id, data, doc.$permissions)
    } catch (e) {
      if (!alreadyExists(e)) throw e
      await dev.databases.updateDocument(devDbId, c.$id, doc.$id, data, doc.$permissions)
    }
  })
  console.log(`  ${c.$id}: ${documents.length} docs`)
}

// ── Storage files ──

const buckets = steps.includes('files') ? await listAll((q) => prod.storage.listBuckets(q), 'buckets') : []
for (const b of buckets) {
  const files = await listAll((q) => prod.storage.listFiles(b.$id, q), 'files')
  const inDev = new Set((await listAll((q) => dev.storage.listFiles(b.$id, q), 'files')).map((f) => f.$id))
  // Files listed in prod whose content is gone from the prod server's disk
  const missingInProd = []
  await inBatches(files.filter((f) => !inDev.has(f.$id)), 5, async (f) => {
    let content
    try {
      content = await prod.storage.getFileDownload(b.$id, f.$id)
    } catch (e) {
      if (e?.type !== 'storage_file_not_found') throw e
      missingInProd.push(f.$id)
      return
    }
    try {
      await dev.storage.createFile(b.$id, f.$id, InputFile.fromBuffer(Buffer.from(content), f.name), f.$permissions)
    } catch (e) {
      if (!alreadyExists(e)) throw e
    }
  })
  console.log(`Bucket ${b.$id}: ${files.length} files (${inDev.size} already in dev)`
    + (missingInProd.length ? ` — ${missingInProd.length} missing on the prod server: ${missingInProd.join(', ')}` : ''))
}

console.log('Done.')
