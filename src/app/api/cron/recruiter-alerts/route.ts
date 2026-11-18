import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isSavedSearchesConfigured, runSavedSearchSweep } from '@/lib/saved-searches-store'

// Rattrapage des alertes des recherches enregistrées (ADR 0046), toutes les 10 minutes sur le VPS (deploy/crontab) :
// candidats modifiés depuis 24 h comparés de nouveau aux recherches actives (une comparaison interrompue après le dépôt
// d'un CV), puis e-mails en échec renvoyés. Sans doublon : chaque alerte a un identifiant fixe.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isSavedSearchesConfigured()) {
    return NextResponse.json({ configured: false })
  }
  try {
    return NextResponse.json(await runSavedSearchSweep(new Date()))
  } catch (err) {
    console.error('[recherches] rattrapage en échec', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Rattrapage en échec' }, { status: 500 })
  }
}
