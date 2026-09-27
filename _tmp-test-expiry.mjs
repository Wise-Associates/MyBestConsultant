import { Client, Databases, ID } from 'node-appwrite'
import { readFileSync } from 'fs'

const raw = readFileSync('.env.local', 'utf-8')
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY)

const databases = new Databases(client)

const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const doc = await databases.createDocument(
  process.env.APPWRITE_DB_ID,
  process.env.APPWRITE_COLLECTION_JOBS,
  ID.unique(),
  {
    tenantId: '', title: 'QA Test Expired Job', description: 'temp', skills: [],
    location: 'Paris', isActive: true, expiresAt: past,
  },
)
console.log(JSON.stringify({ id: doc.$id, isActive: doc.isActive, expiresAt: doc.expiresAt }))
