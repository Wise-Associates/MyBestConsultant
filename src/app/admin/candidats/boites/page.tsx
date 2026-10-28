import { requireAdmin } from '@/lib/appwrite/auth'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { listMailboxes, type MailboxView } from '@/lib/ao/mailboxes'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { MailboxesManager } from '@/components/ao/mailboxes-manager'
import { deletePlatformMailboxAction, savePlatformMailboxAction, setPlatformMailboxEnabledAction, testPlatformMailboxAction } from './actions'

// Boîtes de réception de la plateforme lues par AO Offers (page claire, comme /admin/candidats).
export default async function PlatformMailboxesPage() {
  await requireAdmin()
  let mailboxes: MailboxView[] = []
  let loadError = ''
  try {
    mailboxes = await listMailboxes(PLATFORM_TENANT_ID)
  } catch (err) {
    console.error('AO: boîtes de la plateforme illisibles', err instanceof Error ? err.message : err)
    loadError = 'Impossible de charger les boîtes : vérifiez que la collection ao_sources existe (npm run ao:setup) et que APPWRITE_COLLECTION_AO_SOURCES est définie.'
  }
  return (
    <div className="admin-light min-h-full p-8 space-y-6">
      <AdminPageHeader title="Boîtes de réception de la plateforme" back={{ href: '/admin/candidats', label: 'Candidats' }}
        description="N'importe quelle adresse : chaque boîte active est lue à chaque passage. Les organisations gèrent les leurs depuis leur espace recruteur." />
      {loadError ? (
        <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{loadError}</p>
      ) : (
        <MailboxesManager
          initial={mailboxes}
          actions={{ test: testPlatformMailboxAction, save: savePlatformMailboxAction, setEnabled: setPlatformMailboxEnabledAction, remove: deletePlatformMailboxAction }}
        />
      )}
    </div>
  )
}
