'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { CUSTOM_PLAN_CARD, PAID_PLAN_CARDS, QUOTE_REQUEST_HREF, checkoutLabel } from '@/lib/plan-catalog'
import type { PaidPlanId } from '@/lib/plans'
import { startSubscriptionCheckout } from './actions'
import { CheckoutModal } from './checkout-modal'

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const

// Choix d'une formule par le propriétaire ou un administrateur (ADR 0034, étape 3) : carte bancaire (Stripe Elements),
// ou changement sur l'abonnement en cours. Le serveur revérifie le rôle, la suspension et l'abonnement Stripe
// (startSubscriptionCheckout) ; `blockedReason` évite seulement d'ouvrir un paiement qui serait refusé.
export function PlanChoice({ currentPlan, canChoose, blockedReason, hasCustomOffer }: {
  currentPlan: string | null
  canChoose: boolean
  blockedReason: string | null
  hasCustomOffer: boolean
}) {
  const router = useRouter()
  const [paying, setPaying] = useState<PaidPlanId | null>(null)

  return (
    <section id="formules" className="rounded-2xl p-5 sm:p-6 space-y-5 lg:col-span-2 scroll-mt-20" style={surface} aria-labelledby="plans-title">
      <div>
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h2 id="plans-title" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Formules</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {!canChoose
            ? 'Le propriétaire et les administrateurs de l’organisation peuvent changer de formule.'
            : blockedReason ?? 'Paiement mensuel par carte, sans engagement ; un changement de formule est calculé au prorata.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PAID_PLAN_CARDS.map(card => {
          const current = currentPlan === card.id
          return (
            <div key={card.id} className="rounded-xl p-4 flex flex-col gap-3" style={{ border: current ? '2px solid var(--color-brand-orange)' : '1px solid var(--color-border)' }}>
              <div>
                <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{card.name}</p>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{card.tagline}</p>
              </div>
              <p style={{ color: 'var(--color-text)' }}>
                <span className="text-2xl font-semibold">{card.priceLabel}</span>
                <span className="text-sm ml-1" style={{ color: 'var(--color-text-muted)' }}>{card.period}</span>
              </p>
              <ul className="space-y-1.5 text-sm flex-1">
                {card.features.map(f => (
                  <li key={f} className="flex items-start gap-2" style={{ color: 'var(--color-text)' }}>
                    <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />{f}
                  </li>
                ))}
              </ul>
              {current ? (
                <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-orange)' }}>Votre formule</p>
              ) : canChoose && !blockedReason ? (
                <button type="button" onClick={() => setPaying(card.id)}
                  className="w-full py-2 rounded-xl text-sm font-semibold"
                  style={{ background: card.highlight ? 'var(--color-primary)' : 'var(--color-background)', color: card.highlight ? 'var(--color-primary-fg)' : 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                  Choisir {card.name}
                </button>
              ) : null}
            </div>
          )
        })}

        <div className="rounded-xl p-4 flex flex-col gap-3" style={{ border: '1px dashed var(--color-border)' }}>
          <div>
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{CUSTOM_PLAN_CARD.name}</p>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{CUSTOM_PLAN_CARD.tagline}</p>
          </div>
          <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{CUSTOM_PLAN_CARD.priceLabel}</p>
          <ul className="space-y-1.5 text-sm flex-1">
            {CUSTOM_PLAN_CARD.features.map(f => (
              <li key={f} className="flex items-start gap-2" style={{ color: 'var(--color-text)' }}>
                <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />{f}
              </li>
            ))}
          </ul>
          {currentPlan === 'custom' ? (
            <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-orange)' }}>Votre formule</p>
          ) : hasCustomOffer ? (
            <a href="#custom-offer" className="text-sm font-semibold no-underline hover:underline" style={{ color: 'var(--color-brand-orange)' }}>Voir votre offre</a>
          ) : (
            <Link href={QUOTE_REQUEST_HREF} className="w-full py-2 rounded-xl text-sm font-semibold text-center no-underline"
              style={{ background: 'var(--color-background)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              Demander un devis
            </Link>
          )}
        </div>
      </div>

      {paying && (
        <CheckoutModal
          title={`Abonnement — ${checkoutLabel(paying)}`}
          payLabel={`Payer ${checkoutLabel(paying).split(' — ')[1]}`}
          paidText={`Votre abonnement ${checkoutLabel(paying)} est actif dès la confirmation du paiement (quelques secondes).`}
          doneText={`Votre abonnement passe à ${checkoutLabel(paying)}. La différence au prorata figurera sur votre prochaine facture.`}
          start={() => startSubscriptionCheckout(paying)}
          onClose={() => { setPaying(null); router.refresh() }}
        />
      )}
    </section>
  )
}
