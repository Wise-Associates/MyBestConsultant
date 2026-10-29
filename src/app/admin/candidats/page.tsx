import { requireAdmin } from '@/lib/appwrite/auth'
import type { AoOfferRow } from '@/lib/ao/filters'
import type { AoEmail } from '@/lib/ao/types'
import { loadPlatformAoView } from '@/lib/ao/platform-view'
import type { TrackingStep } from '@/lib/ao/tracking'
import { loadAoTracking } from '@/lib/ao/tracking-store'
import { AoOffersDashboard, type MailboxIssue } from '@/components/ao/ao-offers-dashboard'
import {
  addAoOfferComment, aoOfferSourcing, deleteAoOffer, deleteAoOfferComment, listAoOfferComments, previewAoPublication, publishAoOffer,
  retryAoEmail, setAoOfferStatus, stopAoPublicationTasks,
} from './actions'

// « Réessayer » (Server Action de cette page) traite un e-mail tout de suite (150 s au plus). « Publier » répond tout de
// suite, la diffusion sur les réseaux et le sourcing continuent après la réponse (after()) dans ce même délai.
// « Synchroniser maintenant » passe par /api/admin/candidats/sync, enchaîné par AoSyncProvider (layout admin).
export const maxDuration = 300

export default async function AdminAoOffersPage() {
  await requireAdmin()
  let rows: AoOfferRow[] = []
  let emails: AoEmail[] = []
  let inboxConfigured = false
  let mailboxIssues: MailboxIssue[] = []
  let loadError = ''
  try {
    const view = await loadPlatformAoView()
    rows = view.rows
    emails = view.recentEmails
    const sources = view.sources
    const enabled = sources.filter(s => s.enabled)
    inboxConfigured = enabled.length > 0
    mailboxIssues = enabled.filter(s => s.lastError).map(s => ({ label: s.label, error: s.lastError, at: s.lastSyncAt }))
  } catch (err) {
    console.error('AO Offers: chargement impossible', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO. Vérifiez que les collections AO existent (npm run ao:setup) et que APPWRITE_COLLECTION_AO_EMAILS / _AO_OFFERS / _AO_SOURCES sont définies.'
  }
  // Suivi des offres publiées (offre en ligne, LinkedIn, sourcing) : lu à part, son échec n'empêche pas d'afficher les offres.
  let tracking: Record<string, TrackingStep[]> = {}
  let trackingError = ''
  try {
    tracking = await loadAoTracking(rows)
  } catch (err) {
    console.error('AO Offers: suivi des publications illisible', err instanceof Error ? err.message : err)
    trackingError = 'Suivi des publications indisponible (offre en ligne, LinkedIn, sourcing) : la lecture en cause est dans les journaux du serveur (« suivi des publications illisible »). Si l’erreur persiste, vérifiez APPWRITE_COLLECTION_SOCIAL_POSTS et APPWRITE_COLLECTION_JOB_MATCHES.'
  }
  return (
    <AoOffersDashboard
      titleInAdminBar
      rows={rows}
      recentEmails={emails}
      inboxConfigured={inboxConfigured}
      mailboxIssues={mailboxIssues}
      loadError={loadError}
      tracking={tracking}
      trackingError={trackingError}
      actions={{
        retryEmail: retryAoEmail, deleteOffer: deleteAoOffer, previewPublication: previewAoPublication,
        publish: publishAoOffer, setStatus: setAoOfferStatus, sourcing: aoOfferSourcing, stopTasks: stopAoPublicationTasks,
        listComments: listAoOfferComments, addComment: addAoOfferComment, deleteComment: deleteAoOfferComment,
      }}
      paths={{
        statistics: '/admin/candidats/statistiques',
        mailboxes: '/admin/candidats/boites',
        exportApi: '/api/admin/candidats/export',
        originalApi: '/api/admin/candidats/original',
        jobs: '/admin/jobs',
      }}
      copy={{
        eyebrow: 'RECRUTEMENT',
        title: 'Candidats',
        scope: 'de la plateforme',
        publishNote: 'L’offre est en ligne dès la publication. Suivent en arrière-plan la diffusion sur les réseaux, si la « Publication automatique » est activée dans Réseaux sociaux, et le sourcing automatique (e-mail aux meilleurs candidats).',
        social: { href: '/admin/social', label: 'Relancer depuis Réseaux sociaux' },
      }}
    />
  )
}
