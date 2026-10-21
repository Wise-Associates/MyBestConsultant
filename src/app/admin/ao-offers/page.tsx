import { requireAdmin } from '@/lib/appwrite/auth'
import type { AoOfferRow } from '@/lib/ao/filters'
import type { AoEmail } from '@/lib/ao/types'
import { loadPlatformAoView } from '@/lib/ao/platform-view'
import { AoOffersDashboard, type MailboxIssue } from './ao-offers-dashboard'

// La synchronisation manuelle (Server Action de cette page) lit et analyse jusqu'à 5 e-mails.
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
  return <AoOffersDashboard rows={rows} recentEmails={emails} inboxConfigured={inboxConfigured} mailboxIssues={mailboxIssues} loadError={loadError} />
}
