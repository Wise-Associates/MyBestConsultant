import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { databases } = createAdminClient()
  const now = new Date().toISOString()

  let deactivated = 0
  while (true) {
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
      Query.equal('isActive', true),
      Query.lessThan('expiresAt', now),
      Query.limit(100),
    ])
    if (res.documents.length === 0) break
    for (const doc of res.documents) {
      await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, doc.$id, { isActive: false })
      deactivated++
    }
  }

  return NextResponse.json({ deactivated })
}
