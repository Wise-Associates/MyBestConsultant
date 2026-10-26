import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { AoOfferRow } from '@/lib/ao/filters'
import { loadAoView } from '@/lib/ao/platform-view'
import { canUseAoSourcing } from '@/lib/ao/tenancy'
import type { AoEmail } from '@/lib/ao/types'
import { AoOffersDashboard, type MailboxIssue } from '@/components/ao/ao-offers-dashboard'
import {
  addRecruiterAoOfferComment, deleteRecruiterAoOffer, deleteRecruiterAoOfferComment, listRecruiterAoOfferComments,
  previewRecruiterAoPublication, publishRecruiterAoOffer, recruiterAoOfferSourcing, retryRecruiterAoEmail, setRecruiterAoOfferStatus,
} from './actions'

// Appels d'offres reçus dans les boîtes de l'organisation du recruteur (ADR 0005, phase C) : même tableau que
// /admin/candidats, limité à ses boîtes ; tous ses recruteurs le voient. Boîtes : ./boites.
// « Réessayer » (Server Action de cette page) traite un e-mail tout de suite (150 s au plus). « Publier » répond tout de
// suite, la diffusion sur les réseaux et le sourcing continuent après la réponse (after()) dans ce même délai.
// « Synchroniser maintenant » passe par /api/recruiter/ao/sync, enchaîné par AoSyncProvider (layout recruteur).
export const maxDuration = 300

export default async function RecruiterAoOffersPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  let rows: AoOfferRow[] = []
  let emails: AoEmail[] = []
  let inboxConfigured = false
  let mailboxIssues: MailboxIssue[] = []
  let accessAlert: string | undefined
  let loadError = ''
  try {
    const { databases } = createAdminClient()
    const [tenant, view] = await Promise.all([databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId), loadAoView(user.tenantId)])
    if (!canUseAoSourcing(tenant.$id, typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null)) {
      accessAlert = 'Votre abonnement n’est pas actif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation (page « Abonnement »).'
    }
    rows = view.rows
    emails = view.recentEmails
    const enabled = view.sources.filter(s => s.enabled)
    inboxConfigured = enabled.length > 0
    mailboxIssues = enabled.filter(s => s.lastError).map(s => ({ label: s.label, error: s.lastError, at: s.lastSyncAt }))
  } catch (err) {
    console.error('AO: tableau de l\'organisation illisible', user.tenantId, err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger vos appels d’offres pour le moment : rechargez la page dans quelques instants.'
  }

  return (
    <AoOffersDashboard
      rows={rows}
      recentEmails={emails}
      inboxConfigured={inboxConfigured}
      mailboxIssues={mailboxIssues}
      loadError={loadError}
      accessAlert={accessAlert}
      actions={{
        retryEmail: retryRecruiterAoEmail, deleteOffer: deleteRecruiterAoOffer,
        previewPublication: previewRecruiterAoPublication, publish: publishRecruiterAoOffer, setStatus: setRecruiterAoOfferStatus,
        sourcing: recruiterAoOfferSourcing,
        listComments: listRecruiterAoOfferComments, addComment: addRecruiterAoOfferComment, deleteComment: deleteRecruiterAoOfferComment,
      }}
      paths={{
        statistics: '/recruiter/parametres/boites-ao/statistiques',
        mailboxes: '/recruiter/parametres/boites-ao/boites',
        exportApi: '/api/recruiter/ao/export',
        originalApi: '/api/recruiter/ao/original',
        jobs: '/recruiter/annonces',
      }}
      copy={{
        eyebrow: 'ESPACE RECRUTEUR',
        title: 'Appels d’offres',
        scope: 'de votre organisation',
        publishNote: 'Comme pour vos autres offres, la publication déclenche la diffusion sur les réseaux et le sourcing automatiques s’ils sont activés.',
        back: { href: '/recruiter/dashboard', label: 'Retour à l’espace recruteur' },
      }}
    />
  )
}
