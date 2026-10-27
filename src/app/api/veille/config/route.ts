import { NextRequest, NextResponse } from 'next/server'
import { hasBearerSecret } from '@/lib/cron-auth'
import { getLatestVeilleConfig } from '@/lib/veille/store'

// Réglages de la veille lus par le scanner veille-marches-emplois au début de chaque passage (ADR 0012), avec
// `Authorization: Bearer $VEILLE_CONFIG_TOKEN` (32 caractères au moins, propre à cette route : il ne donne accès qu'à ces
// réglages, ni à la base ni aux autres routes). Rien d'autre n'est renvoyé que la version en vigueur.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!hasBearerSecret(req, process.env.VEILLE_CONFIG_TOKEN, 32)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  try {
    const latest = await getLatestVeilleConfig()
    if (!latest) return NextResponse.json({ error: 'Aucun réglage enregistré : lancez npm run veille:seed.' }, { status: 404 })
    return NextResponse.json(
      { version: latest.version, savedAt: latest.savedAt, config: latest.config },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[veille] réglages illisibles pour le scanner', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Réglages de la veille illisibles pour le moment.' }, { status: 500 })
  }
}
