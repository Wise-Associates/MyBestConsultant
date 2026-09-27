import { Client, Databases, Query } from 'node-appwrite'
import { config } from 'dotenv'
config({ path: 'C:/MES PROJET CODE/mybestconsultant/.env.local', override: true })

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY)

const databases = new Databases(client)
const DB_ID = process.env.APPWRITE_DB_ID

const collections = [
  process.env.APPWRITE_COLLECTION_SITE_LAYOUT,
  process.env.APPWRITE_COLLECTION_TEMPLATES_CONFIG,
].filter(Boolean)

for (const col of collections) {
  try {
    const res = await databases.listDocuments(DB_ID, col, [Query.limit(100)])
    for (const doc of res.documents) {
      const str = JSON.stringify(doc)
      if (/matching learning/i.test(str)) {
        console.log('FOUND in', col, doc.$id)
        const idx = str.toLowerCase().indexOf('matching learning')
        console.log(str.slice(Math.max(0,idx-100), idx+150))
      }
    }
  } catch (e) { console.log('skip', col, e.message) }
}
console.log('search done')
