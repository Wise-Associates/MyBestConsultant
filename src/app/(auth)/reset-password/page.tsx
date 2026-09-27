'use client'

import { useState, useTransition, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { resetPasswordAction } from './actions'

function ResetForm() {
  const searchParams = useSearchParams()
  const userId = searchParams.get('userId') ?? ''
  const secret = searchParams.get('secret') ?? ''

  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inp = `w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-colors`
  const inpStyle = {
    background: 'rgba(11,29,81,0.04)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  function submit(formData: FormData) {
    formData.set('userId', userId)
    formData.set('secret', secret)
    setError(null)
    startTransition(async () => {
      const result = await resetPasswordAction(formData)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12"
      style={{ background: 'var(--color-background)' }}>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

          <div className="px-8 py-6 text-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              Nouveau mot de passe
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Choisissez un mot de passe sécurisé
            </p>
          </div>

          {done ? (
            <div className="px-8 py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(16,185,129,0.1)' }}>
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Mot de passe mis à jour !</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
                </p>
              </div>
              <Link href="/login"
                className="inline-flex items-center justify-center w-full py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: '#B8860B', color: 'white' }}>
                Se connecter
              </Link>
            </div>
          ) : (
            <form action={submit} className="px-8 py-6 space-y-4">
              {(!userId || !secret) && (
                <p className="text-sm px-4 py-2.5 rounded-xl"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                  Lien invalide. Recommencez depuis votre email.
                </p>
              )}

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input name="password" type="password" required minLength={8}
                  placeholder="Nouveau mot de passe" autoComplete="new-password"
                  className={inp} style={inpStyle} />
                <p className="text-[11px] mt-1 pl-1" style={{ color: 'var(--color-text-muted)' }}>8 caractères minimum</p>
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input name="confirm" type="password" required placeholder="Confirmer le mot de passe"
                  autoComplete="new-password" className={inp} style={inpStyle} />
              </div>

              {error && (
                <p className="text-sm px-4 py-2.5 rounded-xl"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error}
                </p>
              )}

              <button type="submit" disabled={isPending || !userId || !secret}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#B8860B', color: 'white' }}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? 'Mise à jour…' : 'Réinitialiser le mot de passe'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
