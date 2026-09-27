'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Mail, Lock, User, Building2, Phone } from 'lucide-react'
import { registerAction } from '../actions'
import { GoogleIcon, LinkedInIcon } from '@/components/shared/oauth-icons'

interface Props {
  googleUrl: string
  linkedinUrl: string
}

export function RegisterForm({ googleUrl, linkedinUrl }: Props) {
  const searchParams = useSearchParams()
  const roleParam = searchParams.get('role')
  const defaultRole = (roleParam === 'recruiter' || roleParam === 'hunter' ? roleParam : 'candidate') as 'candidate' | 'recruiter' | 'hunter'

  const [role, setRole] = useState<'candidate' | 'recruiter' | 'hunter'>(defaultRole)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(formData: FormData) {
    formData.set('role', role)
    setError(null)
    startTransition(async () => {
      const result = await registerAction(formData)
      if (result && 'error' in result) setError(result.error)
    })
  }

  const inp = `w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-colors`
  const inpStyle = {
    background: 'rgba(11,29,81,0.04)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12"
      style={{ background: 'var(--color-background)' }}>
      <div className="w-full max-w-sm">

        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

          {/* Header */}
          <div className="px-8 py-6 text-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              Créer un compte
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Rejoignez MyBestConsultant.fr
            </p>
          </div>

          {/* Role switcher */}
          <div className="px-8 pt-6">
            <div className="flex rounded-xl overflow-hidden p-1 gap-1"
              style={{ background: 'rgba(11,29,81,0.05)', border: '1px solid var(--color-border)' }}>
              {(['candidate', 'recruiter', 'hunter'] as const).map(r => (
                <button key={r} type="button"
                  onClick={() => setRole(r)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: role === r ? 'var(--color-primary)' : 'transparent',
                    color: role === r ? 'white' : 'var(--color-text-muted)',
                  }}>
                  {r === 'candidate' ? '🔍 Candidat' : r === 'recruiter' ? '📋 Recruteur' : '🎯 Chasseur'}
                </button>
              ))}
            </div>
          </div>

          {/* OAuth — candidate only: a social signup always creates a candidate account */}
          {role === 'candidate' && (
            <>
              <div className="px-8 pt-6 space-y-2.5">
                <a href={googleUrl}
                  className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 no-underline transition-colors hover:bg-black/[0.02]"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  <GoogleIcon /> Continuer avec Google
                </a>
                <a href={linkedinUrl}
                  className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 no-underline transition-colors hover:bg-black/[0.02]"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  <LinkedInIcon /> Continuer avec LinkedIn
                </a>
              </div>
              <div className="px-8 pt-6 flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>ou</span>
                <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
              </div>
            </>
          )}

          {/* Form */}
          <form action={submit} className="px-8 py-6 space-y-3">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input name="firstName" required placeholder="Prénom" className={inp} style={inpStyle} />
              </div>
              <input name="lastName" required placeholder="Nom"
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={inpStyle} />
            </div>

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <input name="email" type="email" required placeholder="votre@email.fr" autoComplete="email"
                className={inp} style={inpStyle} />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <input name="password" type="password" required placeholder="••••••••" autoComplete="new-password"
                className={inp} style={inpStyle} />
              <p className="text-[11px] mt-1 pl-1" style={{ color: 'var(--color-text-muted)' }}>8 caractères minimum</p>
            </div>

            {/* Chasseur : téléphone (joignable par les recruteurs) */}
            {role === 'hunter' && (
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <input name="phone" type="tel" required placeholder="+33 6 12 34 56 78" className={inp} style={inpStyle} />
              </div>
            )}

            {/* Company + Phone (recruiter only) */}
            {role === 'recruiter' && (
              <>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                  <input name="companyName" required placeholder="Nom de l'entreprise"
                    className={inp} style={inpStyle} />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                  <input name="phone" type="tel" required placeholder="+33 6 12 34 56 78"
                    className={inp} style={inpStyle} />
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <p className="text-sm px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </p>
            )}

            {/* Submit */}
            <button type="submit" disabled={isPending}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: 'white' }}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? 'Création…' : 'Créer mon compte'}
            </button>

            <p className="text-center text-sm pt-1" style={{ color: 'var(--color-text-muted)' }}>
              Déjà un compte ?{' '}
              <Link href="/login" className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Se connecter
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
