import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/appwrite/client'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BUCKETS } from '@/lib/appwrite/config'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin')) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { fileId } = await params
  const { storage } = createAdminClient()

  const [bytes, meta] = await Promise.all([
    storage.getFileDownload(BUCKETS.VIVIER_CVS, fileId),
    storage.getFile(BUCKETS.VIVIER_CVS, fileId).catch(() => null),
  ])

  const filename = meta?.name ?? `cv-${fileId}.pdf`
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
