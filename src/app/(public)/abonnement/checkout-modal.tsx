'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { X, Loader2, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react'
import { startSubscriptionCheckout } from './actions'
import type { PaidPlanId } from '@/lib/stripe'

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

const PLAN_LABEL: Record<PaidPlanId, string> = { essentiel: 'Essentiel — 99 €/mois', pro: 'Pro — 199 €/mois' }

function CardForm({ planId, onDone }: { planId: PaidPlanId; onDone: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError('')
    const { error: payErr } = await stripe.confirmPayment({ elements, redirect: 'if_required' })
    setSubmitting(false)
    if (payErr) { setError(payErr.message ?? 'Le paiement a été refusé.'); return }
    setDone(true)
    setTimeout(onDone, 2000)
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 8px' }}>
        <CheckCircle2 style={{ width: 48, height: 48, color: '#34d399', margin: '0 auto 16px' }} />
        <p style={{ color: 'white', fontWeight: 700, fontSize: '1.05rem', margin: '0 0 6px' }}>Paiement confirmé !</p>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem' }}>Votre abonnement {PLAN_LABEL[planId]} est actif.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f87171', background: 'rgba(239,68,68,0.1)', padding: '10px 14px', borderRadius: 10 }}>
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      <button type="submit" disabled={!stripe || submitting}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg,#E8A33D,#F0B860)', color: '#1a1305' }}>
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Paiement en cours…</> : `Payer ${PLAN_LABEL[planId].split(' — ')[1]}`}
      </button>
      <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
        <ShieldCheck className="h-3.5 w-3.5" /> Paiement sécurisé par Stripe
      </p>
    </form>
  )
}

export function CheckoutModal({ planId, onClose }: { planId: PaidPlanId; onClose: () => void }) {
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    startSubscriptionCheckout(planId).then(res => {
      if (cancelled) return
      if (res.error) setError(res.error)
      else if (res.clientSecret) setClientSecret(res.clientSecret)
    })
    return () => { cancelled = true }
  }, [planId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: '#1C1C1E', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="font-semibold text-white text-sm">Abonnement — {PLAN_LABEL[planId]}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">
          {error ? (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f87171', background: 'rgba(239,68,68,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          ) : !clientSecret || !stripePromise ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 0', color: 'rgba(255,255,255,0.5)' }}>
              <Loader2 className="h-5 w-5 animate-spin" /> Préparation du paiement…
            </div>
          ) : (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#E8A33D', colorBackground: '#1C1C1E' } } }}>
              <CardForm planId={planId} onDone={onClose} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  )
}
