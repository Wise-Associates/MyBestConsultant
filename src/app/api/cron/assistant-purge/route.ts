import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isAssistantStorageConfigured, purgeExpiredAssistantTurns, purgeOldAssistantQuotaSlots } from '@/lib/assistant/host'

// Conservation des conversations avec l'assistant IA : ASSISTANT_RETENTION_DAYS (ADR 0007). Appelée chaque jour par Vercel Cron.
// Purge aussi les places de quota de plus de 7 jours. Un passage interrompu reprend au suivant.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isAssistantStorageConfigured()) {
    // Normal tant que l'assistant n'a jamais été installé ; sinon, conversations conservées au-delà de la durée prévue.
    console.warn('[assistant] purge ignorée : APPWRITE_COLLECTION_ASSISTANT_TURNS non définie')
    return NextResponse.json({ purged: 0, configured: false })
  }

  try {
    const now = new Date()
    const purged = await purgeExpiredAssistantTurns(now)
    const quotaSlots = await purgeOldAssistantQuotaSlots(now, Date.now() + 40_000)
    return NextResponse.json({ purged, quotaSlots })
  } catch (err) {
    console.error('[assistant] purge en échec', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Purge en échec' }, { status: 500 })
  }
}
