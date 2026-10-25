import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Inbox } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { listMailboxes } from '@/lib/ao/mailboxes'
import { canUseAoSourcing } from '@/lib/ao/tenancy'
import { MailboxesManager } from '@/components/ao/mailboxes-manager'
import { deleteMailboxAction, saveMailboxAction, setMailboxEnabledAction, testMailboxAction } from './actions'

// Boîtes de réception des appels d'offres de l'organisation : tous ses recruteurs les voient, son propriétaire les gère.
export default async function MailboxesPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { databases } = createAdminClient()
  const [tenant, mailboxes] = await Promise.all([
    databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId),
    listMailboxes(user.tenantId),
  ])
  const isOwner = tenant.recruiterId === user.userId
  const entitled = canUseAoSourcing(tenant.$id, typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/recruiter/parametres/boites-ao" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Appels d&apos;offres
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <Inbox className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Boîtes d&apos;appels d&apos;offres</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Les e-mails reçus dans ces boîtes sont lus automatiquement : chaque appel d&apos;offres devient une offre à valider.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {!entitled && (
          <p role="status" className="text-sm p-4 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            Votre abonnement n&apos;est pas actif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation (<Link href="/abonnement">voir les offres</Link>).
          </p>
        )}
        {!isOwner && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Seul le propriétaire du compte peut ajouter ou modifier les boîtes.</p>
        )}
        <MailboxesManager
          initial={mailboxes}
          canEdit={isOwner}
          actions={{ test: testMailboxAction, save: saveMailboxAction, setEnabled: setMailboxEnabledAction, remove: deleteMailboxAction }}
        />
      </div>
    </div>
  )
}
