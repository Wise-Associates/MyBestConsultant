import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'

// Read by the public homepage (src/app/page.tsx) — kept out of the admin Server Actions
// so it doesn't need an admin session.
export async function getHomepage() {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, 'pages', [
      Query.equal('isHomepage', true),
      Query.equal('isPublished', true),
      Query.limit(1),
    ])
    if (result.documents.length === 0) return null
    const doc = result.documents[0]
    return { sections: doc.sections ?? '[]' }
  } catch {
    return null
  }
}
