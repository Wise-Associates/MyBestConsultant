import { requireAdmin } from '@/lib/appwrite/auth'
import { aoInboxSettings } from '@/lib/ao/imap'
import { listAoOfferRows, listRecentAoEmails } from '@/lib/ao/repo'
import type { AoOfferRow } from '@/lib/ao/filters'
import type { AoEmail } from '@/lib/ao/types'
import { AoOffersDashboard } from './ao-offers-dashboard'

// La synchronisation manuelle (Server Action de cette page) lit et analyse jusqu'à 5 e-mails.
export const maxDuration = 300

export default async function AdminAoOffersPage() {
  await requireAdmin()
  let rows: AoOfferRow[] = []
  let emails: AoEmail[] = []
  let loadError = ''
  try {
    ;[rows, emails] = await Promise.all([listAoOfferRows(), listRecentAoEmails(50)])
  } catch (err) {
    console.error('AO Offers: chargement impossible', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les offres AO. Vérifiez que les collections AO existent (scripts/setup-ao-collections.mjs) et que APPWRITE_COLLECTION_AO_EMAILS / APPWRITE_COLLECTION_AO_OFFERS sont définies.'
  }
  return <AoOffersDashboard rows={rows} recentEmails={emails} inboxConfigured={aoInboxSettings() !== null} loadError={loadError} />
}
