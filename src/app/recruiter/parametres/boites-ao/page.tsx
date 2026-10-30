import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { AoPageView } from '@/lib/ao/dashboard-types'
import { filtersFromSearchParams, filtersToSearchParams } from '@/lib/ao/filters'
import { emptyAoView, loadAoView, searchParamsOf } from '@/lib/ao/platform-view'
import type { TrackingStep } from '@/lib/ao/tracking'
import { loadAoTracking } from '@/lib/ao/tracking-store'
import { canUseAoSourcing } from '@/lib/ao/tenancy'
import { AoOffersDashboard, type MailboxIssue } from '@/components/ao/ao-offers-dashboard'
import {
  addRecruiterAoOfferComment, deleteRecruiterAoOffer, deleteRecruiterAoOfferComment, listRecruiterAoOfferComments, retryRecruiterAoEmail,
} from './actions'

// Appels d'offres reçus dans les boîtes de l'organisation du recruteur (ADR 0005, phase C) : même tableau que
// /admin/candidats, limité à ses boîtes ; tous ses recruteurs le voient. Boîtes : ./boites.
// « Réessayer » (Server Action de cette page) traite un e-mail tout de suite (150 s au plus). La publication se fait sur la
// page de l'offre (./[offerId]).
// « Synchroniser maintenant » passe par /api/recruiter/ao/sync, enchaîné par AoSyncProvider (layout recruteur).
export const maxDuration = 300

// Filtres dans l'adresse : la liste est filtrée par le serveur. Chaque offre a sa page (./[offerId]).
export default async function RecruiterAoOffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  const sp = searchParamsOf(await searchParams)
  const filters = filtersFromSearchParams(sp)

  let view: AoPageView = emptyAoView()
  let inboxConfigured = false
  let mailboxIssues: MailboxIssue[] = []
  let accessAlert: string | undefined
  let loadError = ''
  try {
    const { databases } = createAdminClient()
    const [tenant, loaded] = await Promise.all([databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId), loadAoView(user.tenantId, filters)])
    if (!canUseAoSourcing(tenant.$id, typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null)) {
      accessAlert = 'Votre abonnement n’est pas actif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation (page « Abonnement »).'
    }
    const { sources, ...pageView } = loaded
    view = pageView
    const enabled = sources.filter(s => s.enabled)
    inboxConfigured = enabled.length > 0
    mailboxIssues = enabled.filter(s => s.lastError).map(s => ({ label: s.label, error: s.lastError, at: s.lastSyncAt }))
  } catch (err) {
    console.error('AO: tableau de l\'organisation illisible', user.tenantId, err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger vos appels d’offres pour le moment : rechargez la page dans quelques instants.'
  }
  // Suivi des offres publiées (offre en ligne, LinkedIn, sourcing) : lu à part, son échec n'empêche pas d'afficher les offres.
  let tracking: Record<string, TrackingStep[]> = {}
  let trackingError = ''
  try {
    tracking = await loadAoTracking(view.rows)
  } catch (err) {
    console.error('AO: suivi des publications de l\'organisation illisible', user.tenantId, err instanceof Error ? err.message : err)
    trackingError = 'Suivi des publications indisponible (offre en ligne, LinkedIn, sourcing) : rechargez la page dans quelques instants.'
  }

  return (
    <AoOffersDashboard
      view={view}
      filters={filters}
      query={filtersToSearchParams(filters).toString()}
      inboxConfigured={inboxConfigured}
      mailboxIssues={mailboxIssues}
      loadError={loadError}
      accessAlert={accessAlert}
      tracking={tracking}
      trackingError={trackingError}
      actions={{
        retryEmail: retryRecruiterAoEmail, deleteOffer: deleteRecruiterAoOffer,
        listComments: listRecruiterAoOfferComments, addComment: addRecruiterAoOfferComment, deleteComment: deleteRecruiterAoOfferComment,
      }}
      paths={{
        list: '/recruiter/parametres/boites-ao',
        statistics: '/recruiter/parametres/boites-ao/statistiques',
        mailboxes: '/recruiter/parametres/boites-ao/boites',
        exportApi: '/api/recruiter/ao/export',
        originalApi: '/api/recruiter/ao/original',
        jobs: '/recruiter/annonces',
      }}
      copy={{
        title: 'Appels d’offres',
        scope: 'de votre organisation',
      }}
    />
  )
}
