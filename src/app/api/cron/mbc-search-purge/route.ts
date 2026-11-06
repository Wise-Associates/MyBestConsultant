import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isMbcRevealStoreConfigured, purgeExpiredReveals } from '@/lib/mbc-search/reveal-store'

// Conservation des profils révélés par MBC Search : MBC_REVEAL_RETENTION_DAYS (ADR 0018). Appelée chaque jour par
// Vercel Cron ; un passage interrompu reprend au suivant.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isMbcRevealStoreConfigured()) return NextResponse.json({ purged: 0, configured: false })
  try {
    const purged = await purgeExpiredReveals(new Date(), Date.now() + 240_000)
    return NextResponse.json({ purged })
  } catch (err) {
    console.error('[mbc-search] purge des profils révélés en échec', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Purge en échec' }, { status: 500 })
  }
}
