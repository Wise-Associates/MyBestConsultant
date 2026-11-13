'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileSignature, Loader2, Minus } from 'lucide-react'
import { CheckoutModal } from '@/app/(public)/abonnement/checkout-modal'
import { acceptCustomOfferAction } from './actions'

/** Offre sur mesure telle que la page la montre (préparée côté serveur, page.tsx). */
export interface CustomOfferView {
  name: string
  priceText: string
  paymentMethod: 'card' | 'invoice'
  paymentText: string
  /** `active` : offre acceptée et formule « custom » en cours ; `unpaid` : acceptée, paiement par carte pas abouti. */
  state: 'proposed' | 'expired' | 'unpaid' | 'active'
  validUntil: string
  acceptedAt: string | null
  limits: string[]
  features: { label: string; included: boolean }[]
  quotas: { label: string; value: number }[]
}

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const
// Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes.
const subheading = { color: 'var(--color-text-muted)', fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.4, marginBottom: '0.5rem' } as const

const STATE_TEXT: Record<CustomOfferView['state'], string> = {
  proposed: 'Proposée',
  expired: 'Expirée',
  unpaid: 'Paiement à finaliser',
  active: 'En cours',
}

// Offre sur mesure de l'organisation (ADR 0034) : conditions, puis acceptation par le propriétaire ou un administrateur
// (case à cocher, puis paiement par carte ou facture Stripe). Le serveur relit l'offre et revérifie chaque droit.
export function CustomOfferCard({ offer, canAccept }: { offer: CustomOfferView; canAccept: boolean }) {
  const router = useRouter()
  const [agreed, setAgreed] = useState(false)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [isPending, startTransition] = useTransition()
  const acceptable = canAccept && (offer.state === 'proposed' || offer.state === 'unpaid')

  function accept() {
    setError('')
    if (offer.paymentMethod === 'card') { setPaying(true); return }
    startTransition(async () => {
      const res = await acceptCustomOfferAction()
      if (res.error) { setError(res.error); return }
      setDone('Offre acceptée : votre formule sur mesure est active. Stripe vous envoie la facture par e-mail.')
      router.refresh()
    })
  }

  return (
    <section className="rounded-2xl p-5 sm:p-6 space-y-5 lg:col-span-2" style={surface} aria-labelledby="custom-offer">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <FileSignature className="h-5 w-5 mt-1 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Votre offre sur mesure</p>
            <h2 id="custom-offer" style={{ color: 'var(--color-text)', fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 }}>{offer.name}</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>{offer.priceText} · {offer.paymentText}</p>
          </div>
        </div>
        <span className="inline-flex items-center text-sm font-semibold px-3 py-1 rounded-full" style={{ background: 'var(--color-background)', color: 'var(--color-text)' }}>
          {STATE_TEXT[offer.state]}
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3 text-sm">
        <div>
          <h3 style={subheading}>Limites</h3>
          <ul className="space-y-1" style={{ color: 'var(--color-text)' }}>
            {offer.limits.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
        <div>
          <h3 style={subheading}>Fonctions</h3>
          <ul className="space-y-1">
            {offer.features.map(f => (
              <li key={f.label} className="flex items-center gap-2" style={{ color: f.included ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {f.included ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : <Minus className="h-4 w-4 shrink-0" aria-hidden />}
                <span>{f.label}<span className="sr-only">{f.included ? ' : comprise' : ' : non comprise'}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 style={subheading}>Par jour</h3>
          <dl className="space-y-1">
            {offer.quotas.map(q => (
              <div key={q.label} className="flex justify-between gap-3">
                <dt style={{ color: 'var(--color-text-muted)' }}>{q.label}</dt>
                <dd style={{ color: 'var(--color-text)' }}>{q.value.toLocaleString('fr-FR')}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {offer.state === 'active' && offer.acceptedAt && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Acceptée le {offer.acceptedAt}.</p>
      )}
      {offer.state === 'expired' && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Cette offre a expiré le {offer.validUntil} : contactez-nous pour la renouveler.</p>
      )}

      {acceptable && !done && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: 'var(--color-background)' }}>
          {offer.state === 'proposed' && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Offre valable jusqu’au {offer.validUntil}.</p>
          )}
          <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" className="mt-1" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
            <span>J’accepte cette offre et ses conditions pour mon organisation ({offer.priceText} — {offer.paymentText}).</span>
          </label>
          <button type="button" onClick={accept} disabled={!agreed || isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {offer.paymentMethod === 'card' ? 'Accepter et payer par carte' : 'Accepter l’offre'}
          </button>
        </div>
      )}
      {!canAccept && (offer.state === 'proposed' || offer.state === 'unpaid') && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Le propriétaire et les administrateurs de l’organisation peuvent accepter cette offre.</p>
      )}
      {error && <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      {done && <p role="status" className="text-sm" style={{ color: '#047857' }}>{done}</p>}

      {paying && (
        <CheckoutModal
          title={`Offre sur mesure — ${offer.name}`}
          payLabel={`Payer ${offer.priceText}`}
          paidText="Votre formule sur mesure est active dès la confirmation du paiement (quelques secondes)."
          doneText="Votre formule sur mesure est active. La différence au prorata figurera sur votre prochaine facture."
          start={acceptCustomOfferAction}
          onClose={() => { setPaying(false); router.refresh() }}
        />
      )}
    </section>
  )
}
