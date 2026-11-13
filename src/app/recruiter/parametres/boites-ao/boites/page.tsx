import Link from 'next/link'
import { BackLink } from '@/components/recruiter/back-link'
import { redirect } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listMailboxes } from '@/lib/ao/mailboxes'
import { aoRefusal } from '@/lib/ao/tenancy'
import { featureDenial } from '@/lib/plans'
import { loadTenantAccess } from '@/lib/tenant-access'
import { MailboxesManager } from '@/components/ao/mailboxes-manager'
import { deleteMailboxAction, saveMailboxAction, setMailboxEnabledAction, testMailboxAction } from './actions'

// Boîtes de réception des appels d'offres de l'organisation : tous ses recruteurs les voient et les gèrent.
export default async function MailboxesPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const [access, mailboxes] = await Promise.all([loadTenantAccess(user.tenantId), listMailboxes(user.tenantId)])
  const refusal = aoRefusal(user.tenantId, access.subscriptionStatus, access.entitlements)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <BackLink fallbackHref="/recruiter/parametres/boites-ao" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'var(--hero-fg-muted)' }} />
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <Inbox className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'var(--hero-fg)', fontWeight: 300, fontSize: '1.75rem' }}>Boîtes d&apos;appels d&apos;offres</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--hero-fg-muted)' }}>
                Les e-mails reçus dans ces boîtes sont lus automatiquement : chaque appel d&apos;offres devient une offre à valider.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {refusal && (
          <p role="status" className="text-sm p-4 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {refusal === 'inactive'
              ? <>Votre abonnement n&apos;est pas actif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation (<Link href="/abonnement">voir les offres</Link>).</>
              : <>{featureDenial(access.entitlements, 'aoSourcing')} Vos boîtes ne sont pas lues.</>}
          </p>
        )}
        <MailboxesManager
          initial={mailboxes}
          actions={{ test: testMailboxAction, save: saveMailboxAction, setEnabled: setMailboxEnabledAction, remove: deleteMailboxAction }}
        />
      </div>
    </div>
  )
}
