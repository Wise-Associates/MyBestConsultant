import { requireAdmin } from '@/lib/appwrite/auth'
import { EMPTY_AO_FILTERS, type AoOfferRow } from '@/lib/ao/filters'
import { listAllAoOfferRows } from '@/lib/ao/repo'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { buildVeilleMonitoring, type VeilleMonitoring } from '@/lib/veille/monitoring'
import { isVeilleRunsStorageConfigured, listVeilleRuns } from '@/lib/veille/runs-store'
import { getLatestVeilleConfig, isVeilleConfigStorageConfigured } from '@/lib/veille/store'
import { AoStatsView } from '@/components/ao/ao-stats-view'
import { VeilleMonitoringSection } from '@/components/ao/veille-monitoring'

// Statistiques des offres AO de la plateforme (même périmètre que /admin/candidats), et suivi des sources de la veille
// (ADR 0030) : seule la plateforme reçoit les offres de la veille.
export const dynamic = 'force-dynamic'

export default async function AoStatsPage() {
  await requireAdmin()
  const now = new Date()
  let rows: AoOfferRow[] = []
  let loadError = ''
  try {
    rows = await listAllAoOfferRows(PLATFORM_TENANT_ID, EMPTY_AO_FILTERS)
  } catch (err) {
    console.error('AO: statistiques indisponibles', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO : vérifiez les collections AO (npm run ao:setup) et leurs variables APPWRITE_COLLECTION_AO_*.'
  }

  let monitoring: VeilleMonitoring | null = null
  let monitoringError = ''
  if (!isVeilleRunsStorageConfigured()) {
    monitoringError = 'Suivi des sources non configuré : créez la collection veille_runs (npm run schema:push) et définissez APPWRITE_COLLECTION_VEILLE_RUNS (ADR 0030).'
  } else if (loadError) {
    monitoringError = 'Suivi des sources indisponible : les offres AO ne sont pas lisibles (voir ci-dessus).'
  } else {
    try {
      const [runs, latest] = await Promise.all([
        listVeilleRuns(),
        isVeilleConfigStorageConfigured() ? getLatestVeilleConfig() : Promise.resolve(null),
      ])
      monitoring = buildVeilleMonitoring({
        config: latest?.config ?? null,
        configVersion: latest?.version ?? null,
        runs,
        offers: rows.map(r => ({ veilleSource: r.veilleSource, channel: r.channel, status: r.status, receivedAt: r.receivedAt })),
        now,
      })
    } catch (err) {
      console.error('[veille] suivi des sources indisponible', err instanceof Error ? err.message : String(err))
      monitoringError = 'Suivi des sources illisible pour le moment : rechargez la page dans quelques instants.'
    }
  }

  return (
    <AoStatsView titleInAdminBar rows={rows} loadError={loadError} back={{ href: '/admin/candidats', label: 'Candidats' }} scope="de la plateforme" now={now}>
      <VeilleMonitoringSection monitoring={monitoring} error={monitoringError} />
    </AoStatsView>
  )
}
