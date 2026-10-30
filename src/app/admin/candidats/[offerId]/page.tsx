import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/appwrite/auth'
import type { AoOfferNeighbours } from '@/lib/ao/dashboard-types'
import { filtersFromSearchParams, filtersToSearchParams, type AoOfferRow } from '@/lib/ao/filters'
import { loadAoNeighbours, loadAoOfferRow, searchParamsOf } from '@/lib/ao/platform-view'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import type { TrackingStep } from '@/lib/ao/tracking'
import { loadAoTracking } from '@/lib/ao/tracking-store'
import { Banner } from '@/components/ao/ao-banner'
import { AoOfferPage } from '@/components/ao/ao-offer-page'
import { aoOfferSourcing, setAoOfferStatus, stopAoPublicationTasks } from '../actions'

// Page d'une offre AO de la plateforme : détail, préparation et publication, sourcing, et offres précédente et suivante
// de la liste filtrée (filtres de la liste gardés dans l'adresse). « Publier » répond tout de suite, la diffusion et le
// sourcing continuent après la réponse (after()) dans ce délai.
export const maxDuration = 300

export default async function AdminAoOfferPage({ params, searchParams }: {
  params: Promise<{ offerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()
  const { offerId } = await params
  const filters = filtersFromSearchParams(searchParamsOf(await searchParams))
  const query = filtersToSearchParams(filters).toString()
  let row: AoOfferRow | null = null
  let neighbours: AoOfferNeighbours = { previous: null, next: null, position: null, total: 0 }
  try {
    [row, neighbours] = await Promise.all([loadAoOfferRow(PLATFORM_TENANT_ID, offerId), loadAoNeighbours(PLATFORM_TENANT_ID, filters, offerId)])
  } catch (err) {
    console.error('AO: offre illisible', offerId, err instanceof Error ? err.message : err)
    return (
      <div className="admin-light min-h-full p-8 space-y-4">
        <Banner tone="error" text="Impossible de charger cette offre pour le moment : rechargez la page dans quelques instants." />
        <Link href={`/admin/candidats${query ? `?${query}` : ''}`} className="text-sm underline" style={{ color: 'var(--admin-fg-muted)' }}>Retour à la liste</Link>
      </div>
    )
  }
  // Offre d'une autre organisation ou supprimée : introuvable, comme si elle n'existait pas.
  if (!row) notFound()
  // Suivi de l'offre publiée : lu à part, son échec n'empêche pas d'afficher l'offre.
  let tracking: TrackingStep[] | undefined
  let trackingError = ''
  try {
    tracking = (await loadAoTracking([row]))[row.$id]
  } catch (err) {
    console.error('AO Offers: suivi de la publication illisible', offerId, err instanceof Error ? err.message : err)
    trackingError = 'Suivi de la publication indisponible (offre en ligne, LinkedIn, sourcing) : la lecture en cause est dans les journaux du serveur.'
  }
  return (
    <AoOfferPage
      titleInAdminBar
      row={row}
      tracking={tracking}
      trackingError={trackingError}
      neighbours={neighbours}
      query={query}
      actions={{ setStatus: setAoOfferStatus, sourcing: aoOfferSourcing, stopTasks: stopAoPublicationTasks }}
      paths={{ list: '/admin/candidats', originalApi: '/api/admin/candidats/original', jobs: '/admin/jobs' }}
      copy={{
        title: 'Candidats',
        publishNote: 'L’offre est en ligne dès la publication. Suivent en arrière-plan la diffusion sur les réseaux, si la « Publication automatique » est activée dans Réseaux sociaux, et le sourcing automatique (e-mail aux meilleurs candidats).',
        social: { href: '/admin/social', label: 'Relancer depuis Réseaux sociaux' },
      }}
      stickyTop={0}
    />
  )
}
