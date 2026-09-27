'use client'

import Link from 'next/link'
import { Check, Sparkles, ShieldCheck } from 'lucide-react'
import type { UserRole } from '@/types'

interface Plan {
  id: string
  name: string
  tagline: string
  price: number | null
  priceLabel: string
  period: string
  cta: string
  highlight: boolean
  features: string[]
}

const PLANS: Plan[] = [
  {
    id: 'essai',
    name: 'Essai',
    tagline: 'Découvrez la plateforme sans risque',
    price: 0,
    priceLabel: 'Gratuit',
    period: 'pendant 6 mois',
    cta: 'Démarrer mon essai',
    highlight: false,
    features: [
      'Accès complet à la plateforme pendant 6 mois',
      'Sans engagement',
      'Aucune carte bancaire requise',
    ],
  },
  {
    id: 'essentiel',
    name: 'Essentiel',
    tagline: 'Pour recruter efficacement',
    price: 99,
    priceLabel: '99 €',
    period: 'par mois',
    cta: 'Choisir Essentiel',
    highlight: true,
    features: [
      'Jusqu\'à 3 annonces actives simultanément',
      'Matching automatique des candidats par IA',
      'Screening CV par intelligence artificielle',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Le recrutement piloté par l\'IA, de bout en bout',
    price: 199,
    priceLabel: '199 €',
    period: 'par mois',
    cta: 'Choisir Pro',
    highlight: false,
    features: [
      'Jusqu\'à 5 annonces actives simultanément',
      'Recrutement complet piloté par IA (screening + entretien virtuel)',
      'Sélection automatique des meilleurs profils',
    ],
  },
]

function PlanCard({ plan, userRole }: { plan: Plan; userRole: UserRole | null }) {
  const isAdmin = userRole === 'admin'
  const isConnected = !!userRole && !isAdmin

  return (
    <div className="rounded-2xl p-8 flex flex-col relative"
      style={{
        background: 'var(--color-surface)',
        border: plan.highlight ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
        boxShadow: plan.highlight ? 'var(--shadow-card)' : 'none',
      }}>
      {plan.highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-3 py-1 rounded-full"
          style={{ background: 'var(--color-accent)', color: '#fff' }}>
          Le plus choisi
        </span>
      )}

      <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{plan.name}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{plan.tagline}</p>

      <div className="mt-6 mb-2">
        <span className="text-4xl font-bold" style={{ color: 'var(--color-text)' }}>{plan.priceLabel}</span>
        <span className="text-sm ml-1.5" style={{ color: 'var(--color-text-muted)' }}>{plan.period}</span>
      </div>

      {isAdmin ? (
        <div className="mt-4 mb-8 w-full py-3 rounded-xl font-semibold text-sm text-center"
          style={{ background: 'var(--color-secondary)', color: 'var(--color-text-muted)' }}>
          Compte administrateur
        </div>
      ) : (
        <Link href={isConnected ? '/contact' : `/register?role=recruiter&plan=${plan.id}`}
          className="mt-4 mb-8 w-full py-3 rounded-xl font-semibold text-sm text-center no-underline transition-opacity hover:opacity-90"
          style={{ background: plan.highlight ? 'var(--color-primary)' : 'var(--color-secondary)', color: plan.highlight ? '#fff' : 'var(--color-text)' }}>
          {plan.cta}
        </Link>
      )}

      <ul className="space-y-3 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--color-text)' }}>
            <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
            {f}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PricingClient({ userRole }: { userRole: UserRole | null }) {
  return (
    <div className="mbc-app-dark" style={{ background: 'var(--color-background)' }}>

      {/* Second header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-5"
            style={{ background: 'rgba(232,163,61,0.14)', color: '#E8A33D' }}>
            <Sparkles className="h-3.5 w-3.5" /> Nos formules
          </div>
          <h1 className="text-4xl lg:text-5xl font-light" style={{ color: 'white', fontFamily: 'var(--font-heading)' }}>
            Une formule simple, pour recruter plus vite
          </h1>
          <p className="mt-4 text-base max-w-xl mx-auto" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Faites travailler l&apos;IA MyBestConsultant pour recruter plus vite et mieux.
          </p>
        </div>
      </div>

      {/* Plan cards */}
      <div className="px-4 lg:px-8 pb-14">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {PLANS.map(plan => <PlanCard key={plan.id} plan={plan} userRole={userRole} />)}
        </div>
      </div>

      {/* Trust strip */}
      <div className="px-4 lg:px-8 pb-24">
        <div className="max-w-5xl mx-auto flex items-center justify-center gap-2 text-sm"
          style={{ color: 'var(--color-text-muted)' }}>
          <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          Sans engagement — résiliable à tout moment.
        </div>
      </div>
    </div>
  )
}
