'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, Mail, Lock, ShieldCheck, ArrowRight } from 'lucide-react'
import { loginAction } from '../actions'
import { GoogleIcon, LinkedInIcon } from '@/components/shared/oauth-icons'

interface Props {
  googleUrl: string
  linkedinUrl: string
  oauthError?: boolean
  oauthReason?: string
}

export function LoginForm({ googleUrl, linkedinUrl, oauthError, oauthReason }: Props) {
  const [error, setError] = useState<string | null>(
    oauthError
      ? `La connexion via ce service a échoué. ${oauthReason ? `(${oauthReason})` : 'Réessayez ou utilisez votre email.'}`
      : null,
  )
  const [isPending, startTransition] = useTransition()

  function submit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await loginAction(formData)
      if (result && 'error' in result) setError(result.error)
    })
  }

  const inpStyle = {
    background: 'rgba(11,29,81,0.035)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16 overflow-hidden"
      style={{ background: 'radial-gradient(ellipse 120% 90% at 50% -10%, #142a6e 0%, #0B1D51 45%, #060e2c 100%)' }}>

      {/* Ambient glow orbs */}
      <div className="mbc-orb absolute rounded-full pointer-events-none"
        style={{ width: 480, height: 480, top: '-12%', left: '-8%', background: 'radial-gradient(circle, rgba(184,134,11,0.28), transparent 70%)', animationDelay: '0s' }} />
      <div className="mbc-orb-slow absolute rounded-full pointer-events-none"
        style={{ width: 560, height: 560, bottom: '-18%', right: '-12%', background: 'radial-gradient(circle, rgba(124,58,237,0.22), transparent 70%)', animationDelay: '-4s' }} />
      <div className="mbc-orb absolute rounded-full pointer-events-none"
        style={{ width: 320, height: 320, top: '30%', right: '8%', background: 'radial-gradient(circle, rgba(196,181,253,0.14), transparent 70%)', animationDelay: '-8s' }} />

      {/* Faint grid texture */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />

      <div className="relative w-full max-w-sm mbc-rise">

        {/* Brand mark */}
        <div className="text-center mb-7">
          <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 300, fontSize: '1.65rem', color: 'white', letterSpacing: '0.3px' }}>
            My Best Consultant
          </span>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: '#E8A33D' }} />
            Connexion sécurisée
          </div>
        </div>

        {/* Card */}
        <div className="relative rounded-3xl overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            boxShadow: '0 40px 90px -24px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)',
          }}>
          {/* Gold accent line */}
          <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, transparent, #E8A33D, #f0c95a, #E8A33D, transparent)' }} />

          {/* Header */}
          <div className="px-8 pt-7 pb-5 text-center">
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
              Connexion
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Accédez à votre espace MyBestConsultant
            </p>
          </div>

          {/* OAuth */}
          <div className="px-8 space-y-2.5">
            <a href={googleUrl}
              className="group w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 no-underline transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', boxShadow: '0 1px 2px rgba(11,29,81,0.04)' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(66,133,244,0.35)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 2px rgba(11,29,81,0.04)')}>
              <GoogleIcon /> Continuer avec Google
            </a>
            <a href={linkedinUrl}
              className="group w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 no-underline transition-all duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', boxShadow: '0 1px 2px rgba(11,29,81,0.04)' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(10,102,194,0.35)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 1px 2px rgba(11,29,81,0.04)')}>
              <LinkedInIcon /> Continuer avec LinkedIn
            </a>
          </div>

          {/* Divider */}
          <div className="px-8 pt-6 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--color-border))' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>ou</span>
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-border), transparent)' }} />
          </div>

          {/* Form */}
          <form action={submit} className="px-8 py-6 space-y-4">
            {/* Email */}
            <div className="relative mbc-field">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors" style={{ color: 'var(--color-text-muted)' }} />
              <input
                name="email"
                type="email"
                required
                placeholder="votre@email.fr"
                autoComplete="email"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all duration-200 mbc-input"
                style={inpStyle}
              />
            </div>

            {/* Password */}
            <div className="relative mbc-field">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors" style={{ color: 'var(--color-text-muted)' }} />
              <input
                name="password"
                type="password"
                required
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all duration-200 mbc-input"
                style={inpStyle}
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="group w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-70 disabled:translate-y-0"
              style={{ background: 'linear-gradient(135deg, #0B1D51, #16276b)', color: 'white', boxShadow: '0 14px 30px -12px rgba(11,29,81,0.55)' }}>
              {isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Connexion…</>
                : <>Se connecter <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>

            {/* Links */}
            <div className="text-center pt-1 space-y-2">
              <p className="text-sm">
                <Link href="/forgot-password" className="text-xs transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                  Mot de passe oublié ?
                </Link>
              </p>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Pas encore de compte ?{' '}
                <Link href="/register" className="font-semibold transition-opacity hover:opacity-70" style={{ color: '#E8A33D' }}>
                  S&apos;inscrire
                </Link>
              </p>
            </div>
          </form>
        </div>

        {/* Role CTAs */}
        <div className="mt-6 grid grid-cols-2 gap-3 text-center">
          <Link href="/register?role=candidate"
            className="group p-4 rounded-2xl no-underline transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: 'white', border: '1px solid rgba(11,29,81,0.1)', boxShadow: '0 8px 20px -8px rgba(0,0,0,0.3)' }}>
            <p className="text-xs font-semibold" style={{ color: '#0B1D51' }}>Vous cherchez une mission ?</p>
            <p className="text-xs mt-0.5 font-bold" style={{ color: '#E8A33D' }}>Compte candidat →</p>
          </Link>
          <Link href="/register?role=recruiter"
            className="group p-4 rounded-2xl no-underline transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: 'white', border: '1px solid rgba(11,29,81,0.1)', boxShadow: '0 8px 20px -8px rgba(0,0,0,0.3)' }}>
            <p className="text-xs font-semibold" style={{ color: '#0B1D51' }}>Vous recrutez ?</p>
            <p className="text-xs mt-0.5 font-bold" style={{ color: '#E8A33D' }}>Compte recruteur →</p>
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes mbc-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.08); } }
        @keyframes mbc-float-slow { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-24px, 24px) scale(1.05); } }
        @keyframes mbc-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        .mbc-orb { animation: mbc-float 14s ease-in-out infinite; }
        .mbc-orb-slow { animation: mbc-float-slow 18s ease-in-out infinite; }
        .mbc-rise { animation: mbc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .mbc-field:focus-within svg { color: #E8A33D !important; }
        .mbc-input:focus { border-color: #E8A33D !important; background: white !important; box-shadow: 0 0 0 4px rgba(37,99,235,0.1); }
      `}</style>
    </div>
  )
}
