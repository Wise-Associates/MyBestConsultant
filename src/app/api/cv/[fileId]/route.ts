import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BUCKETS, DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin' && user.role !== 'hunter')) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { fileId } = await params
  const { storage, databases } = createAdminClient()

  if (user.role === 'hunter') {
    const owned = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('cvFileId', fileId), Query.equal('hunterUserId', user.userId), Query.limit(1)])
    if (owned.total === 0) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const [bytes, meta] = await Promise.all([
    storage.getFileDownload(BUCKETS.CVS, fileId),
    storage.getFile(BUCKETS.CVS, fileId).catch(() => null),
  ])

  const filename = meta?.name ?? `cv-${fileId}.pdf`
  // Force PDF mime type so browser opens inline instead of downloading
  const mimeType = meta?.mimeType && meta.mimeType !== 'application/octet-stream'
    ? meta.mimeType
    : 'application/pdf'

  return new NextResponse(bytes, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
