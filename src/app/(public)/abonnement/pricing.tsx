import Link from 'next/link'
import { Check, Sparkles, ShieldCheck } from 'lucide-react'
import type { UserRole } from '@/types'
import { CUSTOM_PLAN_CARD, PLAN_CARDS, QUOTE_REQUEST_HREF, type PlanCard } from '@/lib/plan-catalog'

// Page publique des formules (ADR 0034, étape 3) : présentation seulement. Un recruteur connecté choisit et paie sa
// formule dans son espace (/recruiter/abonnement), où ses droits sont vérifiés ; une organisation qui veut plus demande
// un devis (« Sur mesure »).

const RECRUITER_SPACE = '/recruiter/abonnement'

function Card({ name, tagline, priceLabel, period, highlight, features, action }: {
  name: string; tagline: string; priceLabel: string; period: string; highlight: boolean; features: readonly string[]; action: React.ReactNode
}) {
  return (
    <div className="rounded-2xl p-8 flex flex-col relative h-full"
      style={{
        background: 'var(--color-surface)',
        border: highlight ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
        boxShadow: highlight ? 'var(--shadow-card)' : 'none',
      }}>
      {highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-3 py-1 rounded-full"
          style={{ background: 'var(--color-accent)', color: '#fff' }}>
          Le plus choisi
        </span>
      )}

      <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{name}</p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{tagline}</p>

      <div className="mt-6 mb-2">
        <span className="text-4xl font-bold" style={{ color: 'var(--color-text)' }}>{priceLabel}</span>
        <span className="text-sm ml-1.5" style={{ color: 'var(--color-text-muted)' }}>{period}</span>
      </div>

      {action}

      <ul className="space-y-3 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--color-text)' }}>
            <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
            {f}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionLink({ href, label, strong }: { href: string; label: string; strong: boolean }) {
  return (
    <Link href={href}
      className="mt-4 mb-8 w-full py-3 rounded-xl font-semibold text-sm text-center no-underline transition-opacity hover:opacity-90"
      style={{ background: strong ? 'var(--color-primary)' : 'var(--color-secondary)', color: strong ? '#fff' : 'var(--color-text)' }}>
      {label}
    </Link>
  )
}

const ADMIN_NOTE = (
  <div className="mt-4 mb-8 w-full py-3 rounded-xl font-semibold text-sm text-center"
    style={{ background: 'var(--color-secondary)', color: 'var(--color-text-muted)' }}>
    Compte administrateur
  </div>
)

/**
 * Bouton d'une formule : visiteur → inscription recruteur ; recruteur connecté → son espace, où il choisit et paie ;
 * candidat ou chasseur connecté → contact (une formule est celle d'une organisation de recruteurs).
 */
function planAction(card: PlanCard, userRole: UserRole | null): React.ReactNode {
  if (userRole === 'admin') return ADMIN_NOTE
  if (userRole === 'recruiter') return <ActionLink href={RECRUITER_SPACE} label="Gérer mon abonnement" strong={card.highlight} />
  if (userRole) return <ActionLink href="/contact" label={card.cta} strong={card.highlight} />
  return <ActionLink href={`/register?role=recruiter&plan=${card.id}`} label={card.cta} strong={card.highlight} />
}

export function Pricing({ userRole }: { userRole: UserRole | null }) {
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

      {/* Plan cards : trois formules et l'offre sur mesure */}
      <div className="px-4 lg:px-8 pt-10 pb-14">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-stretch">
          {PLAN_CARDS.map(card => (
            <Card key={card.id} name={card.name} tagline={card.tagline} priceLabel={card.priceLabel} period={card.period}
              highlight={card.highlight} features={card.features} action={planAction(card, userRole)} />
          ))}
          <Card name={CUSTOM_PLAN_CARD.name} tagline={CUSTOM_PLAN_CARD.tagline} priceLabel={CUSTOM_PLAN_CARD.priceLabel}
            period={CUSTOM_PLAN_CARD.period} highlight={false} features={CUSTOM_PLAN_CARD.features}
            action={userRole === 'admin' ? ADMIN_NOTE : <ActionLink href={QUOTE_REQUEST_HREF} label="Demander un devis" strong={false} />} />
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
