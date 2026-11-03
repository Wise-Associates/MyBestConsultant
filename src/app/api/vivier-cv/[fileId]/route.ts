import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BUCKETS, COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { cvFileHeaders } from '@/lib/cv-file-headers'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin')) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { fileId } = await params
  const { storage, databases } = createAdminClient()

  // Un vivier est personnel (décision du 2026-11-03) : le CV d'un recruteur n'est lu que par lui, ou par un admin de son
  // organisation, comme sur la page du vivier.
  const owned = user.tenantId ? await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [
    Query.equal('cvFileId', fileId), Query.equal('tenantId', user.tenantId),
    ...(user.role === 'admin' ? [] : [Query.equal('recruiterId', user.$id)]), Query.limit(1),
  ]) : null
  if (!owned || owned.total === 0) return NextResponse.json({ error: 'CV introuvable' }, { status: 404 })

  const [bytes, meta] = await Promise.all([
    storage.getFileDownload(BUCKETS.VIVIER_CVS, fileId),
    storage.getFile(BUCKETS.VIVIER_CVS, fileId).catch(() => null),
  ])

  // Type lu dans le fichier, jamais celui enregistré : un PDF s'affiche, le reste se télécharge (cv-file-headers.ts).
  return new NextResponse(bytes, { headers: cvFileHeaders(new Uint8Array(bytes), meta?.name ?? `cv-${fileId}.pdf`) })
}
