import { requireAdmin } from '@/lib/appwrite/auth'
import type { AoPageView } from '@/lib/ao/dashboard-types'
import { filtersFromSearchParams, filtersToSearchParams } from '@/lib/ao/filters'
import { emptyAoView, loadPlatformAoView, searchParamsOf } from '@/lib/ao/platform-view'
import type { TrackingStep } from '@/lib/ao/tracking'
import { loadAoTracking } from '@/lib/ao/tracking-store'
import { AoOffersDashboard, type MailboxIssue } from '@/components/ao/ao-offers-dashboard'
import { addAoOfferComment, deleteAoOffer, deleteAoOfferComment, listAoOfferComments, retryAoEmail } from './actions'

// « Réessayer » (Server Action de cette page) traite un e-mail tout de suite (150 s au plus). La publication se fait sur la
// page de l'offre (./[offerId]).
// « Synchroniser maintenant » passe par /api/admin/candidats/sync, enchaîné par AoSyncProvider (layout admin).
export const maxDuration = 300

// Filtres dans l'adresse : la liste est filtrée par le serveur. Chaque offre a sa page (./[offerId]).
export default async function AdminAoOffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin()
  const sp = searchParamsOf(await searchParams)
  const filters = filtersFromSearchParams(sp)
  let view: AoPageView = emptyAoView()
  let inboxConfigured = false
  let mailboxIssues: MailboxIssue[] = []
  let loadError = ''
  try {
    const { sources, ...pageView } = await loadPlatformAoView(filters)
    view = pageView
    const enabled = sources.filter(s => s.enabled)
    inboxConfigured = enabled.length > 0
    mailboxIssues = enabled.filter(s => s.lastError).map(s => ({ label: s.label, error: s.lastError, at: s.lastSyncAt }))
  } catch (err) {
    console.error('AO Offers: chargement impossible', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO. Vérifiez que les collections AO existent (npm run ao:setup, npm run schema:push), que APPWRITE_COLLECTION_AO_EMAILS / _AO_OFFERS / _AO_SOURCES / _AO_OFFER_DETAILS / _AO_OFFER_INDEX sont définies et que l’index de la liste est rempli (npm run ao:index).'
  }
  // Suivi des offres publiées (offre en ligne, LinkedIn, sourcing) : lu à part, son échec n'empêche pas d'afficher les offres.
  let tracking: Record<string, TrackingStep[]> = {}
  let trackingError = ''
  try {
    tracking = await loadAoTracking(view.rows)
  } catch (err) {
    console.error('AO Offers: suivi des publications illisible', err instanceof Error ? err.message : err)
    trackingError = 'Suivi des publications indisponible (offre en ligne, LinkedIn, sourcing) : la lecture en cause est dans les journaux du serveur (« suivi des publications illisible »). Si l’erreur persiste, vérifiez APPWRITE_COLLECTION_SOCIAL_POSTS et APPWRITE_COLLECTION_JOB_MATCHES.'
  }
  return (
    <AoOffersDashboard
      titleInAdminBar
      view={view}
      filters={filters}
      query={filtersToSearchParams(filters).toString()}
      inboxConfigured={inboxConfigured}
      mailboxIssues={mailboxIssues}
      loadError={loadError}
      tracking={tracking}
      trackingError={trackingError}
      actions={{
        retryEmail: retryAoEmail, deleteOffer: deleteAoOffer,
        listComments: listAoOfferComments, addComment: addAoOfferComment, deleteComment: deleteAoOfferComment,
      }}
      paths={{
        list: '/admin/candidats',
        statistics: '/admin/candidats/statistiques',
        mailboxes: '/admin/candidats/boites',
        exportApi: '/api/admin/candidats/export',
        originalApi: '/api/admin/candidats/original',
        jobs: '/admin/jobs',
      }}
      copy={{
        title: 'Candidats',
        scope: 'de la plateforme',
      }}
    />
  )
}
