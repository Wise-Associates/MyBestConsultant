'use client'

import { useMemo, useState, useTransition, type CSSProperties } from 'react'
import {
  CreditCard, Users, TrendingUp, Ban, Search, Edit2, Gift, Power, PowerOff,
  AlertCircle, Loader2, X, Building2,
} from 'lucide-react'
import {
  updateSubscription, setSubscriptionStatus, grantFreeMonth,
  type Subscriber, type PlanId, type SubStatus, type BillingPeriod,
} from './actions'

const PLAN_LABELS: Record<PlanId, string> = { free: 'Free', gold: 'Gold', max: 'Max' }
const PLAN_AMOUNTS: Record<PlanId, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  gold: { monthly: 42, annual: 42 * 12 },
  max: { monthly: 120, annual: 120 * 12 },
}
const STATUS_CFG: Record<SubStatus, { label: string; color: string }> = {
  active: { label: 'Actif', color: '#34d399' },
  trialing: { label: 'Essai', color: '#60a5fa' },
  past_due: { label: 'Paiement en retard', color: '#f59e0b' },
  suspended: { label: 'Suspendu', color: '#f87171' },
  cancelled: { label: 'Résilié', color: 'rgba(255,255,255,0.4)' },
  refunded: { label: 'Remboursé', color: '#a78bfa' },
}

const fieldLabel: CSSProperties = { fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }
const inputStyle: CSSProperties = { width: '100%', height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)', fontSize: 13, padding: '0 10px', outline: 'none' }

// ── Edit modal ──────────────────────────────────────────────────────
function EditModal({ sub, onClose, onSaved }: { sub: Subscriber; onClose: () => void; onSaved: (s: Subscriber) => void }) {
  const [plan, setPlan] = useState<PlanId | ''>(sub.plan ?? '')
  const [status, setStatus] = useState<SubStatus | ''>(sub.status ?? '')
  const [period, setPeriod] = useState<BillingPeriod>(sub.period ?? 'monthly')
  const [amount, setAmount] = useState<string>(sub.amount != null ? String(sub.amount) : '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function applyPlanDefaults(p: PlanId | '') {
    setPlan(p)
    if (p) setAmount(String(PLAN_AMOUNTS[p][period]))
  }
  function applyPeriod(p: BillingPeriod) {
    setPeriod(p)
    if (plan) setAmount(String(PLAN_AMOUNTS[plan as PlanId][p]))
  }

  function save() {
    setError('')
    startTransition(async () => {
      const res = await updateSubscription(sub.tenantId, {
        plan: plan || null,
        status: status || null,
        period: plan ? period : null,
        amount: amount ? Number(amount) : null,
      })
      if (res.error) { setError(res.error); return }
      onSaved({ ...sub, plan: plan || null, status: status || null, period: plan ? period : null, amount: amount ? Number(amount) : null })
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1,4,18,0.88)', backdropFilter: 'blur(8px)' }}>
      <div style={{ width: '90vw', maxWidth: 420, borderRadius: 20, overflow: 'hidden', background: '#0c0e14', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 40px 120px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,rgba(11,29,81,0.9),rgba(22,36,102,0.9))', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CreditCard size={15} color="#B8860B" />
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>Gérer l&apos;abonnement</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{sub.companyName}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p style={fieldLabel}>Formule</p>
            <select value={plan} onChange={e => applyPlanDefaults(e.target.value as PlanId | '')} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="" style={{ background: '#0a0c10' }}>Aucune</option>
              {(Object.entries(PLAN_LABELS) as [PlanId, string][]).map(([id, label]) => (
                <option key={id} value={id} style={{ background: '#0a0c10' }}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <p style={fieldLabel}>Statut</p>
              <select value={status} onChange={e => setStatus(e.target.value as SubStatus | '')} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="" style={{ background: '#0a0c10' }}>—</option>
                {(Object.entries(STATUS_CFG) as [SubStatus, typeof STATUS_CFG['active']][]).map(([id, cfg]) => (
                  <option key={id} value={id} style={{ background: '#0a0c10' }}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <p style={fieldLabel}>Périodicité</p>
              <select value={period} onChange={e => applyPeriod(e.target.value as BillingPeriod)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="monthly" style={{ background: '#0a0c10' }}>Mensuel</option>
                <option value="annual" style={{ background: '#0a0c10' }}>Annuel</option>
              </select>
            </div>
          </div>

          <div>
            <p style={fieldLabel}>Montant (€)</p>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} style={inputStyle} />
          </div>

          {error && (
            <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={15} color="#f87171" />
              <p style={{ fontSize: 12, color: '#f87171', margin: 0 }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={save} disabled={isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg, #0B1D51, #162466)', border: '1px solid rgba(184,134,11,0.35)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1 }}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────
export function SubscriptionsDashboard({ initialSubscribers, loadError }: { initialSubscribers: Subscriber[]; loadError?: string }) {
  const [subs, setSubs] = useState(initialSubscribers)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SubStatus | 'all'>('all')
  const [editing, setEditing] = useState<Subscriber | null>(null)
  const [rowError, setRowError] = useState('')
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [, startTransition] = useTransition()

  const stats = useMemo(() => {
    const active = subs.filter(s => s.status === 'active')
    const mrr = active.reduce((sum, s) => {
      if (!s.amount) return sum
      return sum + (s.period === 'annual' ? s.amount / 12 : s.amount)
    }, 0)
    return {
      total: subs.filter(s => s.plan).length,
      active: active.length,
      suspended: subs.filter(s => s.status === 'suspended' || s.status === 'cancelled').length,
      mrr: Math.round(mrr),
    }
  }, [subs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return subs.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (q) {
        const haystack = `${s.companyName} ${s.recruiterName} ${s.recruiterEmail}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [subs, search, statusFilter])

  function withPending(id: string, fn: () => Promise<void>) {
    setRowError('')
    setPendingIds(prev => new Set(prev).add(id))
    startTransition(async () => {
      await fn()
      setPendingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    })
  }

  function toggleSuspend(sub: Subscriber) {
    const next: SubStatus = sub.status === 'suspended' ? 'active' : 'suspended'
    withPending(sub.tenantId, async () => {
      const res = await setSubscriptionStatus(sub.tenantId, next)
      if (res.error) { setRowError(res.error); return }
      setSubs(prev => prev.map(s => s.tenantId === sub.tenantId ? { ...s, status: next } : s))
    })
  }

  function handleFreeMonth(sub: Subscriber) {
    withPending(sub.tenantId, async () => {
      const res = await grantFreeMonth(sub.tenantId)
      if (res.error) { setRowError(res.error); return }
      setSubs(prev => prev.map(s => s.tenantId === sub.tenantId ? { ...s, notes: `${s.notes ? s.notes + '\n' : ''}Mois offert le ${new Date().toLocaleDateString('fr-FR')}` } : s))
    })
  }

  return (
    <div className="min-h-full p-8 space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>

      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>FACTURATION</p>
        <h1 className="text-[28px] font-bold tracking-tight text-white">Abonnements</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Gestion manuelle des abonnements recruteurs — {stats.total} abonné{stats.total > 1 ? 's' : ''}
        </p>
      </div>

      {loadError && (
        <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
          <p className="text-sm" style={{ color: '#f87171' }}>{loadError}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Abonnés', value: stats.total, icon: Users, accent: '#B8860B' },
          { label: 'Actifs', value: stats.active, icon: TrendingUp, accent: '#34d399' },
          { label: 'Suspendus / résiliés', value: stats.suspended, icon: Ban, accent: '#f87171' },
          { label: 'MRR estimé', value: `${stats.mrr} €`, icon: CreditCard, accent: '#60a5fa' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.accent}18` }}>
              <s.icon className="h-5 w-5" style={{ color: s.accent }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par entreprise, recruteur…"
            className="w-full text-sm"
            style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', padding: '0 12px 0 36px', outline: 'none' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as SubStatus | 'all')}
          style={{ height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', padding: '0 12px', fontSize: 13, cursor: 'pointer' }}>
          <option value="all" style={{ background: '#0a0c10' }}>Tous les statuts</option>
          {(Object.entries(STATUS_CFG) as [SubStatus, typeof STATUS_CFG['active']][]).map(([id, cfg]) => (
            <option key={id} value={id} style={{ background: '#0a0c10' }}>{cfg.label}</option>
          ))}
        </select>
      </div>

      {rowError && (
        <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#f87171' }} />
          <p className="text-sm" style={{ color: '#f87171' }}>{rowError}</p>
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-semibold text-sm text-white">Comptes recruteurs</h2>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {['Entreprise', 'Recruteur', 'Formule', 'Statut', 'Montant', ''].map((h, i) => (
                  <th key={i} className="text-left px-6 py-3 text-xs font-medium whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-20" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>Aucun abonné ne correspond à ces filtres</p>
                  </td>
                </tr>
              ) : filtered.map(s => {
                const statusCfg = s.status ? STATUS_CFG[s.status] : null
                const isPending = pendingIds.has(s.tenantId)
                return (
                  <tr key={s.tenantId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
                        <span className="font-medium text-white">{s.companyName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p style={{ color: 'rgba(255,255,255,0.7)' }}>{s.recruiterName}</p>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.recruiterEmail}</p>
                    </td>
                    <td className="px-4 py-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {s.plan ? PLAN_LABELS[s.plan] : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
                    </td>
                    <td className="px-4 py-4">
                      {statusCfg ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{ background: `${statusCfg.color}18`, color: statusCfg.color, border: `1px solid ${statusCfg.color}30` }}>
                          {statusCfg.label}
                        </span>
                      ) : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
                    </td>
                    <td className="px-4 py-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {s.amount != null ? `${s.amount} € / ${s.period === 'annual' ? 'an' : 'mois'}` : '—'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleFreeMonth(s)} disabled={isPending} title="Offrir un mois gratuit"
                          style={{ padding: 7, borderRadius: 8, border: 'none', display: 'flex', background: 'rgba(255,255,255,0.05)', color: '#B8860B', cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.5 : 1 }}>
                          <Gift size={14} />
                        </button>
                        <button onClick={() => toggleSuspend(s)} disabled={isPending} title={s.status === 'suspended' ? 'Réactiver' : 'Suspendre'}
                          style={{ padding: 7, borderRadius: 8, border: 'none', display: 'flex', background: 'rgba(255,255,255,0.05)', color: s.status === 'suspended' ? '#34d399' : '#f59e0b', cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.5 : 1 }}>
                          {isPending ? <Loader2 size={14} className="animate-spin" /> : s.status === 'suspended' ? <Power size={14} /> : <PowerOff size={14} />}
                        </button>
                        <button onClick={() => setEditing(s)} title="Modifier l'abonnement"
                          style={{ padding: 7, borderRadius: 8, border: 'none', display: 'flex', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModal
          sub={editing}
          onClose={() => setEditing(null)}
          onSaved={updated => {
            setSubs(prev => prev.map(s => s.tenantId === updated.tenantId ? updated : s))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
