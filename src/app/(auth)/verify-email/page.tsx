import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MailCheck, CheckCircle2, ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { ResendButton } from './resend-button'
import type { UserRole } from '@/types'

const DASHBOARD_PATH: Record<UserRole, string> = {
  admin: '/admin/dashboard',
  recruiter: '/recruiter/dashboard',
  candidate: '/candidate/dashboard',
  hunter: '/hunter/dashboard',
}

export default async function VerifyEmailPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12"
      style={{ background: 'var(--color-background)' }}>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

          <div className="px-8 py-6 text-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              Vérification de l&apos;email
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {user.email}
            </p>
          </div>

          {user.emailVerification ? (
            <div className="px-8 py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(16,185,129,0.1)' }}>
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                Votre email est déjà vérifié
              </p>
              <Link href={DASHBOARD_PATH[user.role]}
                className="inline-flex items-center gap-2 text-sm font-semibold"
                style={{ color: '#B8860B' }}>
                <ArrowLeft className="h-4 w-4" /> Retour à mon espace
              </Link>
            </div>
          ) : (
            <div className="px-8 py-6 space-y-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(184,134,11,0.1)' }}>
                <MailCheck className="h-8 w-8" style={{ color: '#B8860B' }} />
              </div>
              <p className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                Un email de vérification a été envoyé à cette adresse. Cliquez sur le lien qu&apos;il contient pour confirmer votre compte.
              </p>
              <ResendButton />
              <p className="text-center text-sm pt-1" style={{ color: 'var(--color-text-muted)' }}>
                <Link href={DASHBOARD_PATH[user.role]} className="font-semibold flex items-center justify-center gap-1"
                  style={{ color: '#B8860B' }}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Continuer sans vérifier
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
