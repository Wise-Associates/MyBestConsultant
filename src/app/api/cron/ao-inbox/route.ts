import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { syncAoInbox } from '@/lib/ao/sync'

// Vercel Cron (vercel.json, toutes les 5 minutes) : lit les nouveaux appels d'offres de la boîte ao@.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await syncAoInbox({ budgetMs: 240_000 })
    return NextResponse.json(report)
  } catch (err) {
    // Connexion IMAP, Appwrite ou IA indisponible : visible dans les logs Vercel, réessayé au passage suivant.
    console.error('AO inbox sync failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Synchronisation AO échouée' }, { status: 500 })
  }
}
