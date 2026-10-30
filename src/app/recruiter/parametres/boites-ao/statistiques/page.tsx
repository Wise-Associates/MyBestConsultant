import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { EMPTY_AO_FILTERS, type AoOfferRow } from '@/lib/ao/filters'
import { listAllAoOfferRows } from '@/lib/ao/repo'
import { AoStatsView } from '@/components/ao/ao-stats-view'

// Statistiques des appels d'offres de l'organisation du recruteur (même périmètre que /recruiter/parametres/boites-ao).
export const dynamic = 'force-dynamic'

export default async function RecruiterAoStatsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  let rows: AoOfferRow[] = []
  let loadError = ''
  try {
    rows = await listAllAoOfferRows(user.tenantId, EMPTY_AO_FILTERS)
  } catch (err) {
    console.error('AO: statistiques de l\'organisation indisponibles', user.tenantId, err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger vos appels d’offres pour le moment : rechargez la page dans quelques instants.'
  }
  return (
    <AoStatsView rows={rows} loadError={loadError} back={{ href: '/recruiter/parametres/boites-ao', label: 'Appels d’offres' }} scope="de votre organisation" now={new Date()} />
  )
}
