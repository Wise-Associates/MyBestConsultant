'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Mail, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { forgotPasswordAction } from './actions'

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inp = `w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-colors`
  const inpStyle = {
    background: 'rgba(11,29,81,0.04)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  function submit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await forgotPasswordAction(formData)
      if (result.error) setError(result.error)
      else setSent(true)
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
              Mot de passe oublié
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Recevez un lien de réinitialisation par email
            </p>
          </div>

          {sent ? (
            <div className="px-8 py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(16,185,129,0.1)' }}>
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Email envoyé !</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Si un compte existe avec cet email, vous recevrez un lien de réinitialisation dans quelques instants.
                </p>
              </div>
              <Link href="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold"
                style={{ color: '#B8860B' }}>
                <ArrowLeft className="h-4 w-4" /> Retour à la connexion
              </Link>
            </div>
          ) : (
            <form action={submit} className="px-8 py-6 space-y-4">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input name="email" type="email" required placeholder="votre@email.fr"
                  autoComplete="email" className={inp} style={inpStyle} />
              </div>

              {error && (
                <p className="text-sm px-4 py-2.5 rounded-xl"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                  {error}
                </p>
              )}

              <button type="submit" disabled={isPending}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                style={{ background: '#B8860B', color: 'white' }}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? 'Envoi…' : 'Envoyer le lien'}
              </button>

              <p className="text-center text-sm pt-1" style={{ color: 'var(--color-text-muted)' }}>
                <Link href="/login" className="font-semibold flex items-center justify-center gap-1"
                  style={{ color: '#B8860B' }}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
