import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import type { AoOfferNeighbours } from '@/lib/ao/dashboard-types'
import { filtersFromSearchParams, filtersToSearchParams, type AoOfferRow } from '@/lib/ao/filters'
import { loadAoNeighbours, loadAoOfferRow, searchParamsOf } from '@/lib/ao/platform-view'
import type { TrackingStep } from '@/lib/ao/tracking'
import { loadAoTracking } from '@/lib/ao/tracking-store'
import { Banner } from '@/components/ao/ao-banner'
import { AoOfferPage } from '@/components/ao/ao-offer-page'
import { recruiterAoOfferSourcing, setRecruiterAoOfferStatus, stopRecruiterAoPublicationTasks } from '../actions'

// Page d'un appel d'offres de l'organisation du recruteur : détail, préparation et publication, sourcing, et offres
// précédente et suivante de la liste filtrée (filtres de la liste gardés dans l'adresse). Offres des boîtes de son
// organisation seulement (organisation de la session). « Publier » répond tout de suite, la diffusion et le sourcing
// continuent après la réponse (after()) dans ce délai.
export const maxDuration = 300

/** Barre de navigation fixe de l'espace recruteur (site-navbar-client.tsx) : la barre du haut de l'offre se colle dessous. */
const RECRUITER_NAVBAR_HEIGHT = 68

export default async function RecruiterAoOfferPage({ params, searchParams }: {
  params: Promise<{ offerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  const { offerId } = await params
  const filters = filtersFromSearchParams(searchParamsOf(await searchParams))
  const query = filtersToSearchParams(filters).toString()
  let row: AoOfferRow | null = null
  let neighbours: AoOfferNeighbours = { previous: null, next: null, position: null, total: 0 }
  try {
    [row, neighbours] = await Promise.all([loadAoOfferRow(user.tenantId, offerId), loadAoNeighbours(user.tenantId, filters, offerId)])
  } catch (err) {
    console.error('AO: offre de l\'organisation illisible', user.tenantId, offerId, err instanceof Error ? err.message : err)
    return (
      <div className="admin-light min-h-full p-8 space-y-4">
        <Banner tone="error" text="Impossible de charger cet appel d’offres pour le moment : rechargez la page dans quelques instants." />
        <Link href={`/recruiter/parametres/boites-ao${query ? `?${query}` : ''}`} className="text-sm underline" style={{ color: 'var(--admin-fg-muted)' }}>Retour à la liste</Link>
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
    console.error('AO: suivi de la publication de l\'organisation illisible', user.tenantId, offerId, err instanceof Error ? err.message : err)
    trackingError = 'Suivi de la publication indisponible (offre en ligne, LinkedIn, sourcing) : rechargez la page dans quelques instants.'
  }
  return (
    <AoOfferPage
      row={row}
      tracking={tracking}
      trackingError={trackingError}
      neighbours={neighbours}
      query={query}
      actions={{ setStatus: setRecruiterAoOfferStatus, sourcing: recruiterAoOfferSourcing, stopTasks: stopRecruiterAoPublicationTasks }}
      paths={{ list: '/recruiter/parametres/boites-ao', originalApi: '/api/recruiter/ao/original', jobs: '/recruiter/annonces' }}
      copy={{
        title: 'Appels d’offres',
        publishNote: 'Comme pour vos autres offres, la publication déclenche la diffusion sur les réseaux et le sourcing automatiques s’ils sont activés.',
        // ?offre=<id> : le tableau de bord fait défiler « Mes offres » jusqu'à cette offre (jobs-list-client.tsx).
        social: { href: '/recruiter/dashboard', label: 'Republier depuis le tableau de bord', jobParam: 'offre' },
      }}
      stickyTop={RECRUITER_NAVBAR_HEIGHT}
    />
  )
}
