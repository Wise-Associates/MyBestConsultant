'use client'

import { useState, useTransition } from 'react'
import { AlertCircle, FileSignature, Loader2, X } from 'lucide-react'
import { DAILY_QUOTAS, DAILY_QUOTA_LABEL, FEATURES, FEATURE_LABEL, STANDARD_ENTITLEMENTS, type DailyQuota, type Feature } from '@/lib/plans'
import { saveCustomOfferAction, withdrawCustomOfferAction, type AdminOffer, type Subscriber } from './actions'
import { fieldLabel, inputStyle } from './form-styles'

const STATE_LABEL: Record<AdminOffer['state'], string> = {
  proposed: 'Proposée', expired: 'Expirée', accepted: 'Acceptée', withdrawn: 'Retirée',
}

/** Date AAAA-MM-JJ dans `days` jours (validité proposée par défaut). */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

// Offre sur mesure d'une organisation (ADR 0034) : l'admin la prépare et la propose ; le propriétaire ou un
// administrateur de l'organisation l'accepte depuis sa page « Abonnement ». Acceptée, elle est figée.
export function CustomOfferModal({ sub, onClose, onChanged }: { sub: Subscriber; onClose: () => void; onChanged: (offer: AdminOffer | null) => void }) {
  const initial = sub.offer?.input
  const locked = !!sub.offer?.lockedReason
  const [name, setName] = useState(initial?.name ?? `Offre ${sub.companyName}`.slice(0, 120))
  const [price, setPrice] = useState(initial ? String(initial.priceCents / 100) : '')
  const [period, setPeriod] = useState<'monthly' | 'annual'>(initial?.period ?? 'monthly')
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'invoice'>(initial?.paymentMethod ?? 'invoice')
  const [daysUntilDue, setDaysUntilDue] = useState(String(initial?.daysUntilDue ?? 30))
  const [maxUsers, setMaxUsers] = useState(String(initial?.maxUsers ?? STANDARD_ENTITLEMENTS.maxUsers))
  const [maxActiveJobs, setMaxActiveJobs] = useState(initial?.maxActiveJobs != null ? String(initial.maxActiveJobs) : '')
  const [features, setFeatures] = useState<Set<Feature>>(new Set(initial?.features ?? FEATURES))
  const [quotas, setQuotas] = useState<Record<DailyQuota, string>>(
    Object.fromEntries(DAILY_QUOTAS.map(q => [q, String(initial?.dailyQuotas[q] ?? STANDARD_ENTITLEMENTS.dailyQuotas[q])])) as Record<DailyQuota, string>,
  )
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? inDays(30))
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function toggleFeature(f: Feature) {
    setFeatures(prev => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  function propose() {
    setError('')
    // Les valeurs sont revalidées côté serveur (offerInputSchema) ; ici, seulement converties en nombres.
    const euros = Number(price.replace(',', '.'))
    startTransition(async () => {
      const res = await saveCustomOfferAction(sub.tenantId, {
        name,
        priceCents: Math.round(euros * 100),
        period,
        paymentMethod,
        daysUntilDue: Number(daysUntilDue),
        maxUsers: Number(maxUsers),
        maxActiveJobs: maxActiveJobs.trim() === '' ? null : Number(maxActiveJobs),
        features: [...features],
        dailyQuotas: Object.fromEntries(DAILY_QUOTAS.map(q => [q, Number(quotas[q])])),
        validUntil,
      })
      if (res.error) { setError(res.error); return }
      onChanged(res.offer ?? null)
    })
  }

  function withdraw() {
    setError('')
    startTransition(async () => {
      const res = await withdrawCustomOfferAction(sub.tenantId)
      if (res.error) { setError(res.error); return }
      onChanged(sub.offer ? { ...sub.offer, state: 'withdrawn' } : null)
    })
  }

  const field = (id: string, label: string, input: React.ReactNode) => (
    <div>
      <label htmlFor={id} style={{ ...fieldLabel, display: 'block' }}>{label}</label>
      {input}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)' }}>
      <div role="dialog" aria-modal="true" aria-label={`Offre sur mesure — ${sub.companyName}`}
        style={{ width: '94vw', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden', background: '#0c0e14', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 40px 120px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <FileSignature size={16} color="#B8860B" aria-hidden />
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>Offre sur mesure</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
              {sub.companyName}{sub.offer ? ` · ${STATE_LABEL[sub.offer.state]}${sub.offer.acceptedAt ? ` le ${new Date(sub.offer.acceptedAt).toLocaleDateString('fr-FR')}` : ''}` : ''}
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Fermer" style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <fieldset disabled={locked || isPending} style={{ padding: 20, display: 'grid', gap: 12, overflowY: 'auto', border: 'none', margin: 0 }}>
          {locked && <p style={{ fontSize: 12, color: '#f59e0b', margin: 0 }}>{sub.offer?.lockedReason}</p>}
          {field('offer-name', 'Nom de l’offre', <input id="offer-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} style={inputStyle} />)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {field('offer-price', 'Prix (€)', <input id="offer-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} style={inputStyle} />)}
            {field('offer-period', 'Période', (
              <select id="offer-period" value={period} onChange={e => setPeriod(e.target.value as 'monthly' | 'annual')} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="monthly" style={{ background: '#0a0c10' }}>Par mois</option>
                <option value="annual" style={{ background: '#0a0c10' }}>Par an</option>
              </select>
            ))}
            {field('offer-payment', 'Paiement', (
              <select id="offer-payment" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as 'card' | 'invoice')} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="invoice" style={{ background: '#0a0c10' }}>Facture Stripe (virement)</option>
                <option value="card" style={{ background: '#0a0c10' }}>Carte bancaire</option>
              </select>
            ))}
            {paymentMethod === 'invoice' && field('offer-due', 'Délai de paiement (jours)', <input id="offer-due" type="number" min={1} max={90} value={daysUntilDue} onChange={e => setDaysUntilDue(e.target.value)} style={inputStyle} />)}
            {field('offer-users', 'Utilisateurs', <input id="offer-users" type="number" min={1} max={500} value={maxUsers} onChange={e => setMaxUsers(e.target.value)} style={inputStyle} />)}
            {field('offer-jobs', 'Offres actives (vide : sans limite)', <input id="offer-jobs" type="number" min={1} max={1000} value={maxActiveJobs} onChange={e => setMaxActiveJobs(e.target.value)} style={inputStyle} />)}
            {field('offer-valid', 'Valable jusqu’au', <input id="offer-valid" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={inputStyle} />)}
          </div>

          <div>
            <p style={fieldLabel}>Fonctions comprises</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {FEATURES.map(f => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.8)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={features.has(f)} onChange={() => toggleFeature(f)} />
                  {FEATURE_LABEL[f]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p style={fieldLabel}>Quotas par jour</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {DAILY_QUOTAS.map(q => (
                <label key={q} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  <span>{DAILY_QUOTA_LABEL[q]}</span>
                  <input type="number" min={0} max={10000} value={quotas[q]} onChange={e => setQuotas(prev => ({ ...prev, [q]: e.target.value }))}
                    style={{ ...inputStyle, width: 90 }} />
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={15} color="#f87171" />
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
            </div>
          )}
        </fieldset>

        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' }}>
          {!locked && sub.offer && sub.offer.state !== 'withdrawn' && (
            <button onClick={withdraw} disabled={isPending}
              style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', fontSize: 13, cursor: isPending ? 'default' : 'pointer' }}>
              Retirer l&apos;offre
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
            Fermer
          </button>
          {!locked && (
            <button onClick={propose} disabled={isPending}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0B1D51, #162466)', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1 }}>
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {sub.offer && sub.offer.state !== 'withdrawn' ? 'Enregistrer et proposer' : 'Proposer l’offre'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
