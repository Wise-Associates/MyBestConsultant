import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { BUCKETS } from '@/lib/appwrite/config'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'admin' && user.role !== 'recruiter')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fileId } = await params
  const endpoint = process.env.APPWRITE_ENDPOINT!
  const projectId = process.env.APPWRITE_PROJECT_ID!
  const apiKey = process.env.APPWRITE_API_KEY!

  try {
    // Stream straight through instead of buffering the whole file in memory — a full
    // interview's merged recording (audio, or video with recordings) can run well past a
    // serverless function's response-size/memory budget, where the old buffer-then-send
    // approach would silently fail with no error the player could ever surface. Forwarding
    // the client's Range header (and relaying 206 + Content-Range back) is also what lets
    // <audio>/<video> seek and start playback without fetching the entire file first.
    const range = req.headers.get('range')
    const upstream = await fetch(
      `${endpoint}/storage/buckets/${BUCKETS.RECORDINGS}/files/${fileId}/download`,
      {
        headers: {
          'X-Appwrite-Project': projectId,
          'X-Appwrite-Key': apiKey,
          ...(range ? { Range: range } : {}),
        },
      },
    )
    if (!upstream.ok && upstream.status !== 206) return new NextResponse('Not found', { status: 404 })

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'audio/webm')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'private, max-age=3600')
    const contentLength = upstream.headers.get('Content-Length')
    if (contentLength) headers.set('Content-Length', contentLength)
    const contentRange = upstream.headers.get('Content-Range')
    if (contentRange) headers.set('Content-Range', contentRange)

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch {
    return new NextResponse('Error', { status: 500 })
  }
}
