import { NextRequest, NextResponse } from 'next/server'

const APPWRITE_ENDPOINT = process.env.APPWRITE_ENDPOINT ?? 'https://appwrite.dat-articles.com/v1'
// Non-HTTPS source the homepage hero video can be hosted on (client's WordPress site) —
// proxied to dodge the browser's mixed-content block on an otherwise-HTTPS page.
const ALLOWED_HTTP_HOSTS = ['wise-portage.fr']
// Only Appwrite storage file bytes may be proxied with the admin key attached — never
// an arbitrary path under the endpoint (that would let a crafted `url` hit any Appwrite
// API route, e.g. a database/users listing, authenticated with our own admin key).
const APPWRITE_FILE_PATH = /^\/v1\/storage\/buckets\/[^/]+\/files\/[^/]+\/(view|download|preview)(\?|$)/

// This is a public, unauthenticated endpoint — `url` is fully attacker-controlled unless
// checked here. Without this allowlist it was an open proxy: any URL got fetched and
// served back under mybestconsultant.fr, which is exactly what got the domain flagged by
// Google Safe Browsing as serving "deceptive" content, and also leaked our Appwrite admin
// key's authority to whatever Appwrite path an attacker cared to pass.
function isAllowedSource(rawUrl: string): boolean {
  if (rawUrl.startsWith(APPWRITE_ENDPOINT)) {
    return APPWRITE_FILE_PATH.test(rawUrl.slice(APPWRITE_ENDPOINT.length))
  }
  try {
    const { protocol, hostname } = new URL(rawUrl)
    return protocol === 'http:' && ALLOWED_HTTP_HOSTS.includes(hostname)
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })
  if (!isAllowedSource(url)) return new NextResponse('Forbidden', { status: 403 })

  // Build upstream headers — add Appwrite auth only for Appwrite URLs
  const upstreamHeaders: HeadersInit = {}
  if (url.startsWith(APPWRITE_ENDPOINT)) {
    upstreamHeaders['X-Appwrite-Project'] = process.env.APPWRITE_PROJECT_ID!
    upstreamHeaders['X-Appwrite-Key']     = process.env.APPWRITE_API_KEY!
  }

  // Forward Range header so browsers can seek/buffer video properly
  const range = req.headers.get('range')
  if (range) upstreamHeaders['Range'] = range

  let upstream: Response
  try {
    upstream = await fetch(url, { headers: upstreamHeaders })
  } catch {
    return new NextResponse('Upstream error', { status: 502 })
  }

  const resHeaders = new Headers()
  resHeaders.set('Content-Type', upstream.headers.get('content-type') ?? 'video/mp4')
  resHeaders.set('Accept-Ranges', 'bytes')
  resHeaders.set('Cache-Control', 'public, max-age=86400')

  const contentLength = upstream.headers.get('content-length')
  const contentRange  = upstream.headers.get('content-range')
  if (contentLength) resHeaders.set('Content-Length', contentLength)
  if (contentRange)  resHeaders.set('Content-Range', contentRange)

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  })
}
