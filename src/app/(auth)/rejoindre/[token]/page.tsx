import Link from 'next/link'
import type { Metadata } from 'next'
import { Users } from 'lucide-react'
import { getInviteInfo } from '@/lib/team'
import { JoinForm } from './join-form'

export const metadata: Metadata = { title: 'Rejoindre une équipe | MyBestConsultant', robots: { index: false } }

export default async function JoinTeamPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await getInviteInfo(decodeURIComponent(token))

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12" style={{ background: 'var(--color-background)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="px-8 py-6 text-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(232,163,61,0.14)' }}>
            <Users className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
          </div>
          {info ? (
            <>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Bienvenue {info.firstName} !</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {info.invitedBy} vous invite à rejoindre l&apos;équipe recrutement de <strong>{info.company}</strong>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Invitation invalide</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Ce lien a expiré ou a déjà été utilisé.</p>
            </>
          )}
        </div>
        <div className="px-8 py-6">
          {info ? (
            <>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Choisissez le mot de passe de votre compte <strong>{info.email}</strong>.</p>
              <JoinForm token={decodeURIComponent(token)} />
            </>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Demandez un nouveau lien au propriétaire du compte, ou connectez-vous si vous avez déjà activé le vôtre.</p>
              <Link href="/login" className="inline-block text-sm font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Aller à la connexion →</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
