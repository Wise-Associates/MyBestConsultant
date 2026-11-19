import { NextRequest, NextResponse } from 'next/server'
import { hasBearerSecret } from '@/lib/cron-auth'
import { readBoundedBody } from '@/lib/http/read-bounded-body'
import { MAX_SCRAPER_STATUS_BYTES, parseScraperStatusReport } from '@/lib/veille/scraper-status'
import { isScraperStatusStorageConfigured, saveScraperStatus } from '@/lib/veille/scraper-status-store'

// État de session d'un site envoyé par le scraper d'appels d'offres (french-tender-scraper) après chaque passage
// (ADR 0048), avec son propre jeton (`Authorization: Bearer $SCRAPER_STATUS_TOKEN`, 32 caractères au moins, distinct de
// VEILLE_CONFIG_TOKEN) : il ne permet que de dire « session valide » ou « session expirée » pour un site de la liste
// SCRAPER_SITES, rien lire, aucun texte choisi. Idempotent : un état déjà reçu,
// ou plus ancien que celui gardé, répond { ok: true, saved: false } sans rien réécrire.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.SCRAPER_STATUS_TOKEN, 32)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  // Un jeton par robot : celui de la veille lit ses réglages et ne doit pas aussi écrire cet état.
  if (process.env.SCRAPER_STATUS_TOKEN === process.env.VEILLE_CONFIG_TOKEN) {
    console.error('[scraper] état de session refusé : SCRAPER_STATUS_TOKEN identique à VEILLE_CONFIG_TOKEN')
    return NextResponse.json({ error: 'Suivi du scraper mal configuré.' }, { status: 503 })
  }
  if (!isScraperStatusStorageConfigured()) {
    console.error('[scraper] état de session refusé : APPWRITE_COLLECTION_SCRAPER_STATUS non définie')
    return NextResponse.json({ error: 'Suivi du scraper non configuré.' }, { status: 503 })
  }
  const body = await readBoundedBody(req, MAX_SCRAPER_STATUS_BYTES)
  if (body === null) return NextResponse.json({ error: 'État trop volumineux.' }, { status: 413 })
  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'État illisible (JSON attendu).' }, { status: 400 })
  }
  const parsed = parseScraperStatusReport(input, new Date())
  if (!parsed.success) return NextResponse.json({ error: `État invalide — ${parsed.error}` }, { status: 400 })
  try {
    const saved = await saveScraperStatus(parsed.report)
    return NextResponse.json({ ok: true, saved }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[scraper] état de session non enregistré', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'État non enregistré pour le moment.' }, { status: 500 })
  }
}
