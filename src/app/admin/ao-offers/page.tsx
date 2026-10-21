import { requireAdmin } from '@/lib/appwrite/auth'
import { listSources } from '@/lib/ao/sources'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { listAoOfferRows, listRecentAoEmails } from '@/lib/ao/repo'
import type { AoOfferRow } from '@/lib/ao/filters'
import type { AoEmail } from '@/lib/ao/types'
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
    // Boîtes de la plateforme seulement : celles des organisations ont leur propre page (ADR 0005).
    const sources = await listSources(PLATFORM_TENANT_ID)
    const ids = sources.map(s => s.$id)
    ;[rows, emails] = await Promise.all([listAoOfferRows(ids), listRecentAoEmails(ids, 50)])
    const enabled = sources.filter(s => s.enabled)
    inboxConfigured = enabled.length > 0
    mailboxIssues = enabled.filter(s => s.lastError).map(s => ({ label: s.label, error: s.lastError, at: s.lastSyncAt }))
  } catch (err) {
    console.error('AO Offers: chargement impossible', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO. Vérifiez que les collections AO existent (npm run ao:setup) et que APPWRITE_COLLECTION_AO_EMAILS / _AO_OFFERS / _AO_SOURCES sont définies.'
  }
  return <AoOffersDashboard rows={rows} recentEmails={emails} inboxConfigured={inboxConfigured} mailboxIssues={mailboxIssues} loadError={loadError} />
}
