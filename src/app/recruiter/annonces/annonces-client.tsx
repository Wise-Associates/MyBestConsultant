'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Layers, Search, Download, FileText, MapPin, Users, Video, Brain, Star, TrendingUp, Briefcase,
  ChevronDown, ChevronLeft, ChevronRight, Kanban, ExternalLink, Clock, CheckCircle2, Printer,
} from 'lucide-react'
import { withOrphanStages, resolveStatus } from '@/lib/funnel-stage-utils'

export interface AnnoncesData {
  jobs: { id: string; title: string; location: string; contractType: string | null; remote: string | null; isActive: boolean; createdAt: string; expiresAt: string | null }[]
  stages: { slug: string; label: string; color: string; order: number; autoAction?: string | null }[]
  apps: { id: string; jobId: string; name: string; status: string; score: number | null; createdAt: string }[]
  interviews: { appId: string; status: string }[]
  matchCountByJob: Record<string, number>
  generatedAt: string
}

const DAY = 86_400_000
const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Sur site', hybrid: 'Hybride', remote: 'Télétravail' }
const DONE_INTERVIEW = new Set(['completed', 'analysed'])
const PAGE_SIZE = 5

type Filter = 'all' | 'active' | 'archived'
type Sort = 'recent' | 'candidates' | 'score' | 'todo'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const scoreColor = (s: number) => (s >= 75 ? '#10b981' : s >= 55 ? '#f59e0b' : '#ef4444')

function MiniKpi({ label, value, sub, color, icon, title }: { label: string; value: string; sub?: string; color: string; icon: React.ReactNode; title?: string }) {
  return (
    <div title={title} className="flex items-center gap-2.5 rounded-xl px-3 py-2 min-w-[150px] sm:min-w-0 shrink-0 sm:shrink"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18`, color }}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide truncate" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        <p className="text-base font-bold leading-tight whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
          {value}{sub && <span className="ml-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{sub}</span>}
        </p>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      <p className="text-lg font-bold leading-tight" style={{ color: color ?? 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
    </div>
  )
}

/** 1 … 4 5 6 … 12 : première, dernière et voisins de la page courante. */
function pageNumbers(current: number, total: number): (number | '…')[] {
  const keep = new Set([1, total, current - 1, current, current + 1].filter(p => p >= 1 && p <= total))
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push('…'); out.push(p) })
  return out
}

export function AnnoncesClient({ data }: { data: AnnoncesData }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const listRef = useRef<HTMLDivElement>(null)

  const now = useMemo(() => new Date(data.generatedAt).getTime(), [data.generatedAt])
  const allApps = useMemo(() => data.apps.map(a => ({ ...a, status: resolveStatus(data.stages, a.status) })), [data.apps, data.stages])
  const stages = useMemo(() => withOrphanStages(data.stages, allApps.map(a => a.status)), [data.stages, allApps])
  const stageBySlug = useMemo(() => new Map(stages.map(s => [s.slug, s])), [stages])
  const firstStage = [...data.stages].sort((a, b) => a.order - b.order)[0]?.slug ?? 'pending'

  const rows = useMemo(() => {
    const interviewsByApp = new Map<string, string[]>()
    for (const i of data.interviews) interviewsByApp.set(i.appId, [...(interviewsByApp.get(i.appId) ?? []), i.status])

    return data.jobs.map(job => {
      const apps = allApps.filter(a => a.jobId === job.id).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.createdAt.localeCompare(a.createdAt))
      const counts = stages.map(s => ({ stage: s, count: apps.filter(a => a.status === s.slug).length }))
      const scored = apps.filter(a => a.score !== null)
      const ivs = apps.flatMap(a => interviewsByApp.get(a.id) ?? [])
      const accepted = apps.filter(a => a.status === 'accepted').length
      const last = apps.reduce<string | null>((m, a) => (!m || a.createdAt > m ? a.createdAt : m), null)
      const expired = !!job.expiresAt && new Date(job.expiresAt).getTime() < now
      return {
        job, apps, counts,
        total: apps.length,
        todo: apps.filter(a => a.status === firstStage).length,
        avgScore: scored.length ? Math.round(scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length) : null,
        ivTotal: ivs.length, ivDone: ivs.filter(s => DONE_INTERVIEW.has(s)).length,
        accepted, matches: data.matchCountByJob[job.id] ?? 0,
        lastAt: last, expired,
        state: !job.isActive ? 'archived' as const : expired ? 'expired' as const : 'active' as const,
      }
    })
  }, [data, allApps, stages, firstStage, now])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = rows.filter(r =>
      (filter === 'all' || (filter === 'active' ? r.state === 'active' : r.state !== 'active')) &&
      (!q || r.job.title.toLowerCase().includes(q) || r.job.location.toLowerCase().includes(q) || r.apps.some(a => a.name.toLowerCase().includes(q))),
    )
    const by: Record<Sort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
      recent: (a, b) => b.job.createdAt.localeCompare(a.job.createdAt),
      candidates: (a, b) => b.total - a.total,
      score: (a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1),
      todo: (a, b) => b.todo - a.todo,
    }
    return [...list].sort(by[sort])
  }, [rows, filter, sort, query])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageIds = useMemo(() => new Set(visible.slice(pageStart, pageStart + PAGE_SIZE).map(r => r.job.id)), [visible, pageStart])
  const goTo = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages))
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const totals = useMemo(() => {
    const active = rows.filter(r => r.state === 'active').length
    const apps = rows.reduce((s, r) => s + r.total, 0)
    const accepted = rows.reduce((s, r) => s + r.accepted, 0)
    const ivTotal = rows.reduce((s, r) => s + r.ivTotal, 0)
    const ivDone = rows.reduce((s, r) => s + r.ivDone, 0)
    const todo = rows.reduce((s, r) => s + r.todo, 0)
    const scored = allApps.filter(a => a.score !== null)
    const avg = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length) : null
    return { active, apps, accepted, ivTotal, ivDone, todo, avg }
  }, [rows, allApps])

  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  function exportCsv() {
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Annonce', 'Statut annonce', 'Candidat', 'Étape', 'Score IA', 'Date de candidature']
    const stateLabel = { active: 'Active', archived: 'Archivée', expired: 'Expirée' }
    const lines = visible.flatMap(r => r.apps.map(a => [
      r.job.title, stateLabel[r.state], a.name, stageBySlug.get(a.status)?.label ?? a.status, a.score, fmtDate(a.createdAt),
    ]))
    const csv = [head, ...lines].map(l => l.map(esc).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const el = document.createElement('a')
    el.href = url; el.download = `suivi-annonces-${new Date().toISOString().slice(0, 10)}.csv`; el.click()
    URL.revokeObjectURL(url)
  }

  const heroBtn = { background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.18)' }
  const generated = new Date(data.generatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      {/* ── En-tête écran ── */}
      <div className="no-print" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Link href="/recruiter/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <Layers className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Suivi des annonces</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Toutes vos offres et leur avancement, au même endroit</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-85" style={heroBtn}>
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-90" style={{ background: 'var(--color-primary)', color: 'white' }}>
                <Printer className="h-3.5 w-3.5" /> Exporter en PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── En-tête imprimé ── */}
      <div className="hidden print-only px-6 pt-8 pb-2">
        <h1 style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.5rem' }}>Rapport de suivi des annonces</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Généré le {generated} · {visible.length} annonce{visible.length > 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Indicateurs globaux + filtres : fixés en haut au défilement (sous la navigation) ── */}
      <div className="mbc-sticky-bar sticky z-30" style={{ top: 68, background: 'rgba(248,247,244,0.94)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 12px 24px -18px rgba(11,29,81,0.35)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 space-y-3">
          <div className="flex sm:grid sm:grid-cols-5 gap-2 sm:gap-3 overflow-x-auto sm:overflow-visible" style={{ scrollbarWidth: 'none' }}>
            <MiniKpi label="Annonces actives" value={String(totals.active)} sub={`sur ${rows.length}`} color="#6366f1" icon={<Briefcase className="h-4 w-4" />} />
            <MiniKpi label="Candidatures" value={String(totals.apps)} sub={totals.todo > 0 ? `${totals.todo} à trier` : 'triées'} color="#0ea5e9" icon={<Users className="h-4 w-4" />} />
            <MiniKpi label="Entretiens IA" value={`${totals.ivDone}/${totals.ivTotal}`} sub="terminés" color="#3b82f6" icon={<Video className="h-4 w-4" />} title="Entretiens terminés / envoyés" />
            <MiniKpi label="Acceptés" value={String(totals.accepted)} sub={`${pct(totals.accepted, totals.apps)}%`} color="#10b981" icon={<CheckCircle2 className="h-4 w-4" />} title="Part des candidatures acceptées" />
            <MiniKpi label="Score IA moyen" value={totals.avg !== null ? `${totals.avg}/100` : '—'} color="#e8a33d" icon={<Star className="h-4 w-4" />} title="Toutes annonces confondues" />
          </div>

          <div className="no-print flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-3.5 rounded-xl flex-1 min-w-[200px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
              <input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="Rechercher une annonce, un lieu, un candidat…"
                className="w-full py-2 text-sm outline-none bg-transparent" style={{ color: 'var(--color-text)' }} />
            </div>
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              {([['all', 'Toutes'], ['active', 'Actives'], ['archived', 'Archivées']] as [Filter, string][]).map(([v, l]) => (
                <button key={v} onClick={() => { setFilter(v); setPage(1) }} className="px-3.5 py-2 text-xs font-semibold transition-colors"
                  style={{ background: filter === v ? 'var(--hero-bg)' : 'transparent', color: filter === v ? 'white' : 'var(--color-text-muted)' }}>{l}</button>
              ))}
            </div>
            <select value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1) }} className="px-3 py-2 rounded-xl text-xs font-semibold outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value="recent">Plus récentes</option>
              <option value="todo">Le plus à trier</option>
              <option value="candidates">Plus de candidatures</option>
              <option value="score">Meilleur score IA</option>
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div ref={listRef} style={{ scrollMarginTop: 250 }} />

        {/* ── Annonces ── */}
        {visible.length === 0 ? (
          <div className="rounded-3xl py-16 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {rows.length === 0 ? 'Aucune annonce pour le moment.' : 'Aucune annonce ne correspond à ces filtres.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visible.map(r => {
              const inPage = pageIds.has(r.job.id)
              const isOpen = open.has(r.job.id)
              const stateStyle = {
                active: { l: 'Active', bg: 'rgba(16,185,129,0.12)', c: '#059669' },
                archived: { l: 'Archivée', bg: 'rgba(107,114,128,0.12)', c: '#6b7280' },
                expired: { l: 'Expirée', bg: 'rgba(245,158,11,0.14)', c: '#b45309' },
              }[r.state]
              const ageDays = Math.max(0, Math.floor((now - new Date(r.job.createdAt).getTime()) / DAY))
              return (
                <article key={r.job.id} className="mbc-annonce rounded-3xl overflow-hidden" style={{ display: inPage ? undefined : 'none', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -18px rgba(11,29,81,0.2)' }}>
                  <div className="p-5 sm:p-6">
                    {/* Titre + statut + actions */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/recruiter/pipeline/${r.job.id}`} className="no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                            <h2 className="leading-snug" style={{ fontWeight: 700, fontSize: '1.1rem' }}>{r.job.title}</h2>
                          </Link>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: stateStyle.bg, color: stateStyle.c }}>{stateStyle.l}</span>
                          {r.todo > 0 && (
                            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(232,163,61,0.16)', color: '#b8862f' }}>
                              {r.todo} à trier
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.job.location}</span>
                          {r.job.contractType && <span>{CONTRACT[r.job.contractType] ?? r.job.contractType}</span>}
                          {r.job.remote && <span>{REMOTE[r.job.remote] ?? r.job.remote}</span>}
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />Publiée le {fmtDate(r.job.createdAt)} · {ageDays === 0 ? "aujourd'hui" : `il y a ${ageDays} j`}</span>
                        </div>
                      </div>
                      <div className="no-print flex items-center gap-2 flex-wrap">
                        <Link href={`/recruiter/pipeline/${r.job.id}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold no-underline transition-opacity hover:opacity-90" style={{ background: 'var(--hero-bg)', color: 'white' }}>
                          <Kanban className="h-3.5 w-3.5" /> Pipeline
                        </Link>
                        <Link href={`/recruiter/pipeline/${r.job.id}/matching`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold no-underline transition-opacity hover:opacity-90" style={{ background: 'rgba(139,92,246,0.1)', color: '#7c3aed' }}>
                          <Brain className="h-3.5 w-3.5" /> Matching
                        </Link>
                        <Link href={`/recruiter/annonces/${r.job.id}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold no-underline transition-opacity hover:opacity-90" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>
                          <FileText className="h-3.5 w-3.5" /> Rapport
                        </Link>
                      </div>
                    </div>

                    {/* Barre d'avancement par étape */}
                    <div className="mt-5">
                      {r.total === 0 ? (
                        <div className="h-2.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)' }} />
                      ) : (
                        <div className="flex h-2.5 rounded-full overflow-hidden gap-px" style={{ background: 'rgba(0,0,0,0.06)' }}>
                          {r.counts.filter(c => c.count > 0).map(c => (
                            <div key={c.stage.slug} title={`${c.count} ${c.stage.label}`} style={{ width: `${(c.count / r.total) * 100}%`, background: c.stage.color }} />
                          ))}
                        </div>
                      )}
                      {r.total > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {r.counts.filter(c => c.count > 0).map(c => (
                            <span key={c.stage.slug} className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${c.stage.color}16`, color: c.stage.color }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.stage.color }} />{c.count} {c.stage.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Indicateurs */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-4 mt-5 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <Metric label="Candidatures" value={String(r.total)} sub={r.lastAt ? `dernière le ${fmtDate(r.lastAt)}` : 'aucune pour le moment'} />
                      <Metric label="Matching IA" value={String(r.matches)} sub="profils suggérés" color="#7c3aed" />
                      <Metric label="Entretiens IA" value={`${r.ivDone}/${r.ivTotal}`} sub="terminés / envoyés" color="#3b82f6" />
                      <Metric label="Score IA moyen" value={r.avgScore !== null ? `${r.avgScore}/100` : '—'} color={r.avgScore !== null ? scoreColor(r.avgScore) : undefined} />
                      <Metric label="Acceptés" value={String(r.accepted)} sub={r.total ? `${pct(r.accepted, r.total)}% des candidatures` : undefined} color="#10b981" />
                    </div>
                  </div>

                  {/* Liste des candidats (repliable à l'écran, toujours dépliée à l'impression) */}
                  {r.total > 0 && (
                    <>
                      <button onClick={() => toggle(r.job.id)} aria-expanded={isOpen}
                        className="no-print w-full flex items-center justify-center gap-1.5 py-3 text-xs font-bold transition-colors hover:bg-[rgba(11,29,81,0.04)]"
                        style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>
                        {isOpen ? 'Masquer les candidats' : `Voir les ${r.total} candidat${r.total > 1 ? 's' : ''}`}
                        <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                      </button>
                      <div className="mbc-cand-list" style={{ display: isOpen ? 'block' : 'none', borderTop: '1px solid var(--color-border)', background: 'rgba(11,29,81,0.02)' }}>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs" style={{ minWidth: 520 }}>
                            <thead>
                              <tr style={{ color: 'var(--color-text-muted)' }}>
                                <th className="text-left font-semibold px-5 sm:px-6 py-2.5">Candidat</th>
                                <th className="text-left font-semibold px-3 py-2.5">Étape</th>
                                <th className="text-left font-semibold px-3 py-2.5">Score IA</th>
                                <th className="text-left font-semibold px-3 py-2.5">Candidature</th>
                                <th className="no-print px-5 sm:px-6 py-2.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {r.apps.map(a => {
                                const st = stageBySlug.get(a.status)
                                const color = st?.color ?? '#6b7280'
                                return (
                                  <tr key={a.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                                    <td className="px-5 sm:px-6 py-2.5 font-semibold" style={{ color: 'var(--color-text)' }}>
                                      <Link href={`/recruiter/candidates/${a.id}`} className="no-underline hover:underline" style={{ color: 'inherit' }}>{a.name}</Link>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${color}16`, color }}>
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{st?.label ?? a.status}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      {a.score === null ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : (
                                        <span className="inline-flex items-center gap-2">
                                          <span className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
                                            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, a.score)}%`, background: scoreColor(a.score) }} />
                                          </span>
                                          <span className="font-bold" style={{ color: scoreColor(a.score) }}>{a.score}</span>
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{fmtDate(a.createdAt)}</td>
                                    <td className="no-print px-5 sm:px-6 py-2.5 text-right whitespace-nowrap">
                                      <Link href={`/recruiter/candidates/${a.id}?print=1`} target="_blank"
                                        className="inline-flex items-center gap-1 font-bold no-underline transition-opacity hover:opacity-75" style={{ color: 'var(--color-primary)' }}>
                                        Rapport PDF <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </article>
              )
            })}
          </div>
        )}

        {visible.length > PAGE_SIZE && (
          <nav aria-label="Pagination" className="no-print flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              Annonces {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visible.length)} sur {visible.length}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1} aria-label="Page précédente"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-35"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageNumbers(currentPage, totalPages).map((p, i) => p === '…'
                ? <span key={`e${i}`} className="w-6 text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>…</span>
                : (
                  <button key={p} onClick={() => goTo(p)} aria-current={p === currentPage ? 'page' : undefined}
                    className="min-w-9 h-9 px-2 rounded-lg text-xs font-bold transition-colors"
                    style={p === currentPage
                      ? { background: 'var(--hero-bg)', color: 'white', border: '1px solid var(--hero-bg)' }
                      : { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>{p}</button>
                ))}
              <button onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Page suivante"
                className="w-9 h-9 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-35"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
        )}

        <p className="no-print text-[11px] text-center flex items-center justify-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
          <TrendingUp className="h-3 w-3" /> Données au {generated}. Pour l&apos;analyse détaillée (délais, conversion, emails), ouvrez le <Link href="/recruiter/reporting" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Reporting</Link>.
        </p>
      </div>

      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .mbc-cand-list { display: block !important; }
          .mbc-annonce { display: block !important; break-inside: avoid; box-shadow: none !important; }
          .mbc-sticky-bar { position: static !important; backdrop-filter: none !important; box-shadow: none !important; background: transparent !important; }
        }
      `}</style>
    </div>
  )
}
