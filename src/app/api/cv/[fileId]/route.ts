import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BUCKETS, DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { cvFileHeaders } from '@/lib/cv-file-headers'

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

  // Type lu dans le fichier, jamais celui enregistré : un PDF s'affiche, le reste se télécharge (cv-file-headers.ts).
  return new NextResponse(bytes, { headers: cvFileHeaders(new Uint8Array(bytes), meta?.name ?? `cv-${fileId}.pdf`) })
}
