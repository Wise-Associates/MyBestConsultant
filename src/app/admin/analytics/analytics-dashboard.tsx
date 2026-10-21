'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Activity, Users, Eye, Clock, TrendingDown, RefreshCw, Settings, Loader2,
  AlertCircle, ExternalLink, Globe, Smartphone, Monitor, Tablet,
  ChevronRight, X, KeyRound,
} from 'lucide-react'
import { saveAnalyticsConfig, fetchDashboardData, fetchRealtimeData } from './actions'
import type { DashboardData, RealtimeData } from '@/lib/google-analytics'

type FetchResult<T> = { error: string } | { data: T }

// ── Formatting helpers ──────────────────────────────────────────────
function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}
function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}
function fmtNum(v: number): string {
  return v.toLocaleString('fr-FR')
}
function friendlyPath(p: string): string {
  if (!p || p === '/') return 'Accueil'
  return p.length > 40 ? p.slice(0, 37) + '…' : p
}
const DEVICE_ICON: Record<string, React.ElementType> = { desktop: Monitor, mobile: Smartphone, tablet: Tablet }
const DEVICE_LABEL: Record<string, string> = { desktop: 'Ordinateur', mobile: 'Mobile', tablet: 'Tablette' }

// ── KPI card ─────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
      <div className={`inline-flex p-2.5 rounded-lg mb-4 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-sm font-medium text-white/70">{label}</div>
      {sub && <div className="text-xs text-white/30 mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Horizontal bar list (traffic sources, devices) ──────────────────
function BarList({ items, colorClass }: { items: { label: string; value: number; icon?: React.ElementType }[]; colorClass: string }) {
  const max = Math.max(1, ...items.map(i => i.value))
  if (items.length === 0) return <p className="text-sm text-white/25 py-4 text-center">Aucune donnée sur cette période.</p>
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const Icon = item.icon
        return (
          <div key={i}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white/60 flex items-center gap-1.5">
                {Icon && <Icon className="h-3 w-3 text-white/30" />}
                {item.label}
              </span>
              <span className="text-xs font-semibold text-white/80">{fmtNum(item.value)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Daily trend mini bar chart ──────────────────────────────────────
function TrendChart({ data }: { data: DashboardData['dailyTrend'] }) {
  if (data.length === 0) return <p className="text-sm text-white/25 py-4 text-center">Pas encore de données.</p>
  const max = Math.max(1, ...data.map(d => d.users))
  return (
    <div className="flex items-end gap-2 h-32 pt-2">
      {data.map((d, i) => {
        const day = d.date.length === 8
          ? new Date(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`).toLocaleDateString('fr-FR', { weekday: 'short' })
          : d.date
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group">
            <span className="text-[10px] text-white/40 opacity-0 group-hover:opacity-100 transition-opacity">{d.users}</span>
            <div className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-violet-500 transition-all"
              style={{ height: `${Math.max(4, (d.users / max) * 88)}px` }} />
            <span className="text-[10px] text-white/30 capitalize">{day}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Setup / connection screen ────────────────────────────────────────
function SetupScreen({ onConnected, existingPropertyId, embedded = false }: { onConnected: () => void; existingPropertyId: string; embedded?: boolean }) {
  const [propertyId, setPropertyId] = useState(existingPropertyId)
  const [json, setJson] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function connect() {
    setError('')
    if (!propertyId.trim() || !json.trim()) { setError('Renseignez l\'ID de propriété et la clé JSON.'); return }
    try { JSON.parse(json) } catch { setError('La clé JSON collée n\'est pas valide (vérifiez le copier-coller complet).'); return }
    startTransition(async () => {
      const r = await saveAnalyticsConfig({ propertyId: propertyId.trim(), serviceAccountJson: json.trim() })
      if (r.error) setError(r.error)
      else onConnected()
    })
  }

  const content = (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-6 space-y-6">
          <div>
            <div className="text-sm font-semibold text-white/80 mb-3">Étape 1 — Créer un accès technique (une fois)</div>
            <ol className="space-y-2.5 text-sm text-white/50 list-decimal list-inside">
              <li>Allez sur <span className="text-white/70 font-mono text-xs">console.cloud.google.com</span>, créez un projet (ou utilisez un existant).</li>
              <li>Menu <span className="text-white/70">API et services → Bibliothèque</span> → cherchez <span className="text-white/70">&quot;Google Analytics Data API&quot;</span> → Activer.</li>
              <li>Menu <span className="text-white/70">IAM et administration → Comptes de service</span> → Créer un compte de service (nom libre, ex: &quot;dashboard-mbc&quot;).</li>
              <li>Ouvrez ce compte de service → onglet <span className="text-white/70">Clés</span> → Ajouter une clé → JSON → il télécharge un fichier <span className="text-white/70">.json</span>.</li>
              <li>Copiez l&apos;adresse du compte de service (se termine par <span className="text-white/70 font-mono text-xs">@...iam.gserviceaccount.com</span>).</li>
            </ol>
          </div>
          <div className="h-px bg-white/[0.06]" />
          <div>
            <div className="text-sm font-semibold text-white/80 mb-3">Étape 2 — Autoriser cet accès dans Google Analytics</div>
            <ol className="space-y-2.5 text-sm text-white/50 list-decimal list-inside">
              <li>Dans Google Analytics → <span className="text-white/70">Admin</span> (roue crantée) → <span className="text-white/70">Gestion des accès à la propriété</span>.</li>
              <li>Ajoutez l&apos;adresse du compte de service copiée à l&apos;étape 1, avec le rôle <span className="text-white/70">Lecteur (Viewer)</span>.</li>
              <li>Toujours dans Admin → <span className="text-white/70">Informations sur la propriété</span> : notez l&apos;<span className="text-white/70">ID de la propriété</span> (un nombre, différent du <span className="font-mono text-xs">G-XXXX</span>).</li>
            </ol>
          </div>
          <div className="h-px bg-white/[0.06]" />
          <div>
            <div className="text-sm font-semibold text-white/80 mb-3">Étape 3 — Connecter ici</div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-widest">ID de propriété GA4</label>
                <input value={propertyId} onChange={e => setPropertyId(e.target.value)} placeholder="ex: 394857123"
                  className="mt-1 w-full px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-white/20"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }} />
              </div>
              <div>
                <label className="text-[10px] text-white/30 uppercase tracking-widest">Contenu du fichier JSON (compte de service)</label>
                <textarea value={json} onChange={e => setJson(e.target.value)} rows={6} placeholder='{ "type": "service_account", "project_id": ... }'
                  className="mt-1 w-full px-3 py-2 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-white/20"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)' }} />
                <p className="text-[10px] text-white/25 mt-1">Ouvrez le fichier .json téléchargé avec un éditeur de texte et collez tout son contenu ici.</p>
              </div>
              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
              <button onClick={connect} disabled={isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition-colors">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {isPending ? 'Connexion en cours…' : 'Connecter Google Analytics'}
              </button>
            </div>
          </div>
        </div>
  )

  if (embedded) return <div className="px-6 py-6">{content}</div>

  return (
    <div className="min-h-full bg-[#0A0C10] text-white px-8 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="h-5 w-5 text-blue-400" />
          <div className="text-2xl font-semibold tracking-tight">Analytics</div>
        </div>
        <p className="text-sm text-white/40 mb-8">Connectez Google Analytics pour voir le trafic du site en temps réel, directement ici.</p>
        {content}
      </div>
    </div>
  )
}

// ── Main dashboard ───────────────────────────────────────────────────
export function AnalyticsDashboard({ isConfigured, initialPropertyId, initialResult }: {
  isConfigured: boolean
  initialPropertyId: string
  initialResult: FetchResult<DashboardData> | null
}) {
  const [connected, setConnected] = useState(isConfigured)
  const [showSettings, setShowSettings] = useState(false)
  const [result, setResult] = useState(initialResult)
  const [realtime, setRealtime] = useState<RealtimeData | null>(
    initialResult && 'data' in initialResult ? initialResult.data.realtime : null
  )
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [refreshing, startRefresh] = useTransition()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Poll realtime active users every 15s — lightweight, cheap
  useEffect(() => {
    if (!connected) return
    const id = setInterval(async () => {
      const r = await fetchRealtimeData()
      if (mounted.current && 'data' in r) setRealtime(r.data)
    }, 15_000)
    return () => clearInterval(id)
  }, [connected])

  // Refresh the full dashboard every 90s
  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => refreshAll(), 90_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  function refreshAll() {
    startRefresh(async () => {
      const r = await fetchDashboardData()
      if (!mounted.current) return
      setResult(r)
      if ('data' in r) setRealtime(r.data.realtime)
      setLastUpdated(new Date())
    })
  }

  if (!connected) {
    return <SetupScreen existingPropertyId={initialPropertyId} onConnected={() => { setConnected(true); refreshAll() }} />
  }

  if (!result) {
    return (
      <div className="min-h-full bg-[#0A0C10] text-white flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    )
  }

  if ('error' in result) {
    return (
      <div className="min-h-full bg-[#0A0C10] text-white px-8 py-10">
        <div className="max-w-lg mx-auto text-center py-16">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-4" />
          <div className="text-lg font-semibold mb-2">Connexion à Google Analytics impossible</div>
          <p className="text-sm text-white/40 mb-6">{result.error}</p>
          <button onClick={() => setConnected(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/70 hover:text-white transition-all">
            <Settings className="h-4 w-4" /> Reconfigurer
          </button>
        </div>
      </div>
    )
  }

  const d = result.data
  const rt = realtime ?? d.realtime

  return (
    <div className="min-h-full bg-[#0A0C10] text-white">
      {/* Header */}
      <div className="border-b border-white/[0.07] px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Connecté à Google Analytics
              </span>
            </div>
            <div className="text-2xl font-semibold text-white tracking-tight">Analytics</div>
            <p className="text-sm text-white/40 mt-0.5">Mis à jour à {lastUpdated.toLocaleTimeString('fr-FR')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refreshAll} disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-sm font-medium text-white/70 hover:text-white transition-all disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Actualiser
            </button>
            <button onClick={() => setShowSettings(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-white/70 hover:text-white transition-all">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-8 space-y-8">

        {/* ── REALTIME HERO ── */}
        <div className="rounded-2xl border border-white/[0.07] p-6 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(124,58,237,0.06))' }}>
          <div className="flex items-center justify-between flex-wrap gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest text-white/50">En ce moment</span>
              </div>
              <div className="text-5xl font-bold text-white tabular-nums">{rt.activeUsers}</div>
              <div className="text-sm text-white/50 mt-1">{rt.activeUsers <= 1 ? 'visiteur actif sur le site' : 'visiteurs actifs sur le site'}</div>
            </div>
            <div className="flex gap-8 flex-wrap">
              {rt.byPage.length > 0 && (
                <div className="min-w-[180px]">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">Pages consultées</p>
                  <div className="space-y-1.5">
                    {rt.byPage.slice(0, 4).map((p, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-white/60 truncate max-w-[160px]">{friendlyPath(p.page)}</span>
                        <span className="text-white/80 font-semibold shrink-0">{p.users}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rt.byCountry.length > 0 && (
                <div className="min-w-[140px]">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">Pays</p>
                  <div className="space-y-1.5">
                    {rt.byCountry.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-white/60 flex items-center gap-1.5"><Globe className="h-3 w-3 text-white/30" />{c.country}</span>
                        <span className="text-white/80 font-semibold">{c.users}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── KPI ROW ── */}
        <div>
          <div className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Aujourd&apos;hui</div>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <KpiCard icon={Users} label="Utilisateurs" value={fmtNum(d.today.activeUsers)} sub={`7j: ${fmtNum(d.last7Days.activeUsers)}`} color="bg-blue-500/10 text-blue-400" />
            <KpiCard icon={Activity} label="Sessions" value={fmtNum(d.today.sessions)} sub={`7j: ${fmtNum(d.last7Days.sessions)}`} color="bg-violet-500/10 text-violet-400" />
            <KpiCard icon={Eye} label="Pages vues" value={fmtNum(d.today.pageViews)} sub={`7j: ${fmtNum(d.last7Days.pageViews)}`} color="bg-emerald-500/10 text-emerald-400" />
            <KpiCard icon={Clock} label="Durée moyenne" value={fmtDuration(d.today.avgSessionDurationSec)} sub={`7j: ${fmtDuration(d.last7Days.avgSessionDurationSec)}`} color="bg-amber-500/10 text-amber-400" />
            <KpiCard icon={TrendingDown} label="Taux de rebond" value={fmtPct(d.today.bounceRate)} sub={`7j: ${fmtPct(d.last7Days.bounceRate)}`} color="bg-rose-500/10 text-rose-400" />
          </div>
        </div>

        {/* ── TREND + SOURCES ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Utilisateurs — 7 derniers jours</div>
            <TrendChart data={d.dailyTrend} />
          </div>
          <div className="lg:col-span-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Sources de trafic</div>
            <BarList colorClass="bg-gradient-to-r from-blue-600 to-blue-400" items={d.trafficSources.map(s => ({ label: s.source, value: s.sessions }))} />
          </div>
        </div>

        {/* ── TOP PAGES + DEVICES ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <div className="text-sm font-semibold text-white/60 uppercase tracking-widest">Pages les plus vues (7j)</div>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {d.topPages.length === 0 && <p className="text-sm text-white/25 py-8 text-center">Aucune donnée sur cette période.</p>}
              {d.topPages.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-white/70 truncate flex items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 text-white/20 shrink-0" />
                    {friendlyPath(p.page)}
                  </span>
                  <span className="text-sm font-semibold text-white/80 shrink-0 ml-4">{fmtNum(p.views)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-5">
            <div className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">Appareils (7j)</div>
            <BarList colorClass="bg-gradient-to-r from-violet-600 to-violet-400"
              items={d.devices.map(dv => ({ label: DEVICE_LABEL[dv.device] || dv.device, value: dv.users, icon: DEVICE_ICON[dv.device] }))} />
          </div>
        </div>

        <div className="text-center pt-2">
          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-white/25 hover:text-white/50 transition-colors">
            Voir plus de détails sur Google Analytics <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* ── Settings modal ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowSettings(false)}>
          <div className="max-w-2xl w-full max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0A0C10]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
              <div className="text-base font-semibold text-white">Reconfigurer Google Analytics</div>
              <button onClick={() => setShowSettings(false)} className="text-white/40 hover:text-white transition-colors"><X className="h-4 w-4" /></button>
            </div>
            <SetupScreen embedded existingPropertyId={initialPropertyId} onConnected={() => { setShowSettings(false); refreshAll() }} />
          </div>
        </div>
      )}
    </div>
  )
}
