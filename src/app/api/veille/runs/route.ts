import { NextRequest, NextResponse } from 'next/server'
import { hasBearerSecret } from '@/lib/cron-auth'
import { MAX_RUN_REPORT_BYTES, parseRunReport } from '@/lib/veille/run-report'
import { isVeilleRunsStorageConfigured, saveVeilleRun } from '@/lib/veille/runs-store'

// Rapport d'un passage envoyé par le scanner veille-marches-emplois après l'enregistrement de son état (ADR 0030), avec
// le jeton de la route des réglages (`Authorization: Bearer $VEILLE_CONFIG_TOKEN`, 32 caractères au moins). Il ne
// permet que d'ajouter un rapport de suivi : ni lecture, ni modification d'un rapport existant. Idempotent : un passage
// déjà reçu répond { ok: true } sans rien réécrire.
export const dynamic = 'force-dynamic'

/** Corps lu morceau par morceau et abandonné au-delà de `max` octets (la taille annoncée n'est pas crue). */
async function readBounded(req: NextRequest, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function POST(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.VEILLE_CONFIG_TOKEN, 32)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  if (!isVeilleRunsStorageConfigured()) {
    console.error('[veille] rapport de passage refusé : APPWRITE_COLLECTION_VEILLE_RUNS non définie')
    return NextResponse.json({ error: 'Suivi des sources non configuré.' }, { status: 503 })
  }
  const body = await readBounded(req, MAX_RUN_REPORT_BYTES)
  if (body === null) return NextResponse.json({ error: 'Rapport trop volumineux.' }, { status: 413 })
  let input: unknown
  try {
    input = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Rapport illisible (JSON attendu).' }, { status: 400 })
  }
  const parsed = parseRunReport(input, new Date())
  if (!parsed.success) return NextResponse.json({ error: `Rapport invalide — ${parsed.error}` }, { status: 400 })
  try {
    const created = await saveVeilleRun(parsed.report)
    return NextResponse.json({ ok: true, created }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[veille] rapport de passage non enregistré', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Rapport non enregistré pour le moment.' }, { status: 500 })
  }
}
