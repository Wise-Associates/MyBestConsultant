import { NextResponse } from 'next/server'
import { handleCallback, verifyCallbackAuth } from '@/lib/social'

export const dynamic = 'force-dynamic'

// Rappel de Make une fois les visuels générés puis la publication faite (ou échouée).
// Authentification : secret partagé (SOCIAL_WEBHOOK_SECRET) en `Authorization: Bearer …` ou `X-MBC-Secret`.
//
// Corps attendu (JSON) :
//   { "publicationId": "...", "status": "images_ready" | "published" | "partial" | "failed",
//     "images": ["https://…/image.png"],
//     "results": [ { "network": "linkedin|instagram|facebook|x", "status": "published|scheduled|failed|skipped", "url": "https://…", "error": "…" } ],
//     "error": "message global (facultatif)" }
export async function POST(req: Request) {
  if (!verifyCallbackAuth(req.headers.get('authorization'), req.headers.get('x-mbc-secret'))) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const res = await handleCallback(body).catch(e => ({ ok: false, error: e instanceof Error ? e.message : 'Erreur' }))
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
