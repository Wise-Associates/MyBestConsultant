import { requireAdmin } from '@/lib/appwrite/auth'
import { EMPTY_AO_FILTERS, type AoOfferRow } from '@/lib/ao/filters'
import { listAllAoOfferRows } from '@/lib/ao/repo'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { AoStatsView } from '@/components/ao/ao-stats-view'

// Statistiques des offres AO de la plateforme (même périmètre que /admin/candidats).
export const dynamic = 'force-dynamic'

export default async function AoStatsPage() {
  await requireAdmin()
  let rows: AoOfferRow[] = []
  let loadError = ''
  try {
    rows = await listAllAoOfferRows(PLATFORM_TENANT_ID, EMPTY_AO_FILTERS)
  } catch (err) {
    console.error('AO: statistiques indisponibles', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO : vérifiez les collections AO (npm run ao:setup) et leurs variables APPWRITE_COLLECTION_AO_*.'
  }
  return <AoStatsView titleInAdminBar rows={rows} loadError={loadError} back={{ href: '/admin/candidats', label: 'Candidats' }} scope="de la plateforme" now={new Date()} />
}
