import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { syncAoInbox } from '@/lib/ao/sync'

// Lit les nouveaux appels d'offres de la boîte ao@. Appelé par Vercel Cron (vercel.json : une fois par jour,
// limite du plan Hobby) et par tout planificateur externe qui envoie `Authorization: Bearer $CRON_SECRET`.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const report = await syncAoInbox({ budgetMs: 240_000, holder: 'cron' })
    // Personne ne lit la réponse d'un cron : le journal Vercel est le seul endroit où le voir.
    if (report.aiUnavailable) console.warn('AO inbox: IA indisponible (crédits épuisés ou clé refusée) — e-mails en attente, voir /admin/ao-offers')
    return NextResponse.json(report)
  } catch (err) {
    // Connexion IMAP, Appwrite ou IA indisponible : visible dans les logs, réessayé au passage suivant.
    // Le détail n'est renvoyé qu'à l'appelant authentifié par CRON_SECRET (planificateur, npm run ao:poll).
    // « fetch failed » cache la vraie cause réseau (ETIMEDOUT, ECONNREFUSED…) dans err.cause.
    const cause = (err as { cause?: { code?: string } })?.cause?.code
    const detail = `${err instanceof Error ? err.message : String(err)}${cause ? ` (${cause})` : ''}`
    console.error('AO inbox sync failed', detail)
    return NextResponse.json({ error: 'Synchronisation AO échouée', detail }, { status: 500 })
  }
}
