import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isSavedSearchesConfigured, runSavedSearchSweep } from '@/lib/saved-searches-store'
import { isAutoMatchingEnabled, sweepAutoMatching } from '@/lib/ai-matches-store'

// Rattrapages des alertes, toutes les 10 minutes sur le VPS (deploy/crontab) :
// - recherches enregistrées (ADR 0046) : e-mails en échec renvoyés, puis candidats modifiés depuis 6 h comparés de nouveau
//   aux recherches actives (une comparaison interrompue après le dépôt d'un CV) ;
// - correspondances IA (ADR 0047) : nouveaux candidats en file, en échec ou dont l'analyse a été interrompue.
// Sans doublon : chaque alerte et chaque association ont un identifiant fixe.
export const maxDuration = 300

/** Temps laissé aux correspondances IA : une analyse commencée avant peut durer encore 2 minutes. */
const AUTO_MATCH_BUDGET_MS = 120_000

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const searchesOn = isSavedSearchesConfigured()
  const autoMatchOn = isAutoMatchingEnabled()
  if (!searchesOn && !autoMatchOn) return NextResponse.json({ configured: false })

  const now = new Date()
  const result: Record<string, unknown> = {}
  let failed = false
  if (searchesOn) {
    try {
      result.searches = await runSavedSearchSweep(now)
    } catch (err) {
      failed = true
      console.error('[recherches] rattrapage en échec', err instanceof Error ? err.message : String(err))
    }
  }
  if (autoMatchOn) {
    try {
      result.autoMatching = await sweepAutoMatching(now, AUTO_MATCH_BUDGET_MS)
    } catch (err) {
      failed = true
      console.error('[correspondances IA] rattrapage en échec', err instanceof Error ? err.message : String(err))
    }
  }
  return NextResponse.json(failed ? { ...result, error: 'Rattrapage en échec' } : result, { status: failed ? 500 : 200 })
}
