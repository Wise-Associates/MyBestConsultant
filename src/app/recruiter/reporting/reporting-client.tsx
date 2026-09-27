'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, BarChart3, Users, Video, Clock, Mail, Brain, Download, AlertTriangle, TrendingUp, CheckCircle2,
} from 'lucide-react'

export interface ReportData {
  jobs: { id: string; title: string }[]
  stages: { slug: string; label: string; color: string; order: number }[]
  apps: { id: string; jobId: string; candidateId: string; name: string; status: string; score: number | null; createdAt: string }[]
  events: { appId: string; stage: string; at: string }[]
  interviews: { appId: string; status: string; createdAt: string; completedAt: string | null; overall: number | null; reco: string | null }[]
  emails: { appId: string; createdAt: string; repliedAt: string | null; hasReply: boolean }[]
  matches: { jobId: string; candidateId: string | null; score: number; createdAt: string; source: 'pool' | 'vivier' }[]
  generatedAt: string
}

const DAY = 86_400_000
const TERMINAL = new Set(['accepted', 'rejected', 'on_hold'])
const PERIODS = [{ v: 7, l: '7 jours' }, { v: 30, l: '30 jours' }, { v: 90, l: '90 jours' }, { v: 0, l: 'Tout' }]

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const fmtDays = (d: number | null) => (d === null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1)} j`)

function Kpi({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 relative overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px -10px rgba(11,29,81,0.12)' }}>
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full" style={{ background: `radial-gradient(circle, ${color}22, transparent 70%)` }} />
      <div className="flex items-center justify-between mb-2 relative">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <p className="text-2xl font-bold relative" style={{ color: 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5 relative" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -20px rgba(11,29,81,0.14)' }}>
      <h2 className="flex items-center gap-2 font-bold mb-4" style={{ color: 'var(--color-text)', fontSize: '0.95rem' }}>
        <span style={{ color: 'var(--color-primary)' }}>{icon}</span>{title}
      </h2>
      {children}
    </section>
  )
}

function Bar({ label, value, max, color, right, showValue = true }: { label: string; value: number; max: number; color: string; right?: string; showValue?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 sm:w-44 shrink-0 text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{label}</span>
      <div className="flex-1 h-6 rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.05)' }}>
        <div className="h-full rounded-lg flex items-center justify-end pr-2 text-[11px] font-bold text-white transition-all duration-500"
          style={{ width: `${Math.max(max > 0 ? (value / max) * 100 : 0, value > 0 ? 6 : 0)}%`, background: color }}>
          {showValue && value > 0 ? value : ''}
        </div>
      </div>
      <span className="w-14 shrink-0 text-right text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{right ?? ''}</span>
    </div>
  )
}

export function ReportingClient({ data }: { data: ReportData }) {
  const [jobId, setJobId] = useState('all')
  const [period, setPeriod] = useState(0)

  const r = useMemo(() => {
    const now = new Date(data.generatedAt).getTime()
    const since = period ? now - period * DAY : 0
    const apps = data.apps.filter(a => (jobId === 'all' || a.jobId === jobId) && new Date(a.createdAt).getTime() >= since)
    const ids = new Set(apps.map(a => a.id))
    const interviews = data.interviews.filter(i => ids.has(i.appId))
    const emails = data.emails.filter(e => ids.has(e.appId))
    const matches = data.matches.filter(m => (jobId === 'all' || m.jobId === jobId) && new Date(m.createdAt).getTime() >= since)

    const interviewedApps = new Set(interviews.map(i => i.appId))
    const doneApps = new Set(interviews.filter(i => i.status === 'completed' || i.status === 'analysed').map(i => i.appId))
    const funnel = [
      { label: 'Sélectionnés', value: apps.length, color: '#6b7280' },
      { label: 'Screenés', value: apps.filter(a => a.score !== null).length, color: '#8b5cf6' },
      { label: 'Entretien envoyé', value: interviewedApps.size, color: '#3b82f6' },
      { label: 'Entretien terminé', value: doneApps.size, color: '#0ea5e9' },
      { label: 'Acceptés', value: apps.filter(a => a.status === 'accepted').length, color: '#10b981' },
    ]
    const rejected = apps.filter(a => a.status === 'rejected').length
    const onHold = apps.filter(a => a.status === 'on_hold').length

    const stageCounts = [...data.stages].sort((x, y) => x.order - y.order)
      .map(s => ({ ...s, count: apps.filter(a => a.status === s.slug).length }))

    // Interviews
    const iStatus = (s: string) => interviews.filter(i => i.status === s).length
    const completed = iStatus('completed') + iStatus('analysed')
    const scores = interviews.map(i => i.overall).filter((x): x is number => x !== null)
    const hoursToComplete = interviews.filter(i => i.completedAt)
      .map(i => (new Date(i.completedAt!).getTime() - new Date(i.createdAt).getTime()) / 3_600_000).filter(h => h >= 0)
    const reco = { hire: interviews.filter(i => i.reco === 'hire').length, consider: interviews.filter(i => i.reco === 'consider').length, reject: interviews.filter(i => i.reco === 'reject').length }

    // Time per stage — timeline per application: creation (initial stage), then each event.
    const eventsByApp = new Map<string, { stage: string; at: number }[]>()
    for (const e of data.events) {
      if (!ids.has(e.appId)) continue
      if (!eventsByApp.has(e.appId)) eventsByApp.set(e.appId, [])
      eventsByApp.get(e.appId)!.push({ stage: e.stage, at: new Date(e.at).getTime() })
    }
    const perStage = new Map<string, number[]>()
    const decisionDays: number[] = []
    const stuck: { id: string; name: string; jobId: string; stage: string; days: number }[] = []
    for (const a of apps) {
      const created = new Date(a.createdAt).getTime()
      const evs = (eventsByApp.get(a.id) ?? []).filter(e => e.at >= created).sort((x, y) => x.at - y.at)
      const timeline: { stage: string; at: number }[] = [{ stage: 'pending', at: created }]
      for (const e of evs) if (timeline[timeline.length - 1].stage !== e.stage) timeline.push(e)
      for (let i = 0; i < timeline.length; i++) {
        const isLast = i === timeline.length - 1
        if (isLast && TERMINAL.has(timeline[i].stage)) continue
        const end = isLast ? now : timeline[i + 1].at
        if (!perStage.has(timeline[i].stage)) perStage.set(timeline[i].stage, [])
        perStage.get(timeline[i].stage)!.push((end - timeline[i].at) / DAY)
      }
      const enteredCurrent = [...timeline].reverse().find(t => t.stage === a.status)?.at ?? created
      if (a.status === 'accepted' || a.status === 'rejected') decisionDays.push((enteredCurrent - created) / DAY)
      else if (!TERMINAL.has(a.status)) {
        const days = (now - enteredCurrent) / DAY
        if (days >= 7) stuck.push({ id: a.id, name: a.name, jobId: a.jobId, stage: a.status, days })
      }
    }
    stuck.sort((x, y) => y.days - x.days)
    const stageTimes = [...data.stages].sort((x, y) => x.order - y.order)
      .filter(s => !TERMINAL.has(s.slug) && perStage.has(s.slug))
      .map(s => ({ ...s, days: avg(perStage.get(s.slug)!), n: perStage.get(s.slug)!.length }))

    // Emails
    const replied = emails.filter(e => e.repliedAt)
    const replyHours = replied.map(e => (new Date(e.repliedAt!).getTime() - new Date(e.createdAt).getTime()) / 3_600_000).filter(h => h >= 0)

    // Matching
    const pool = matches.filter(m => m.source === 'pool')
    const applicantKeys = new Set(data.apps.map(a => `${a.jobId}:${a.candidateId}`))
    const poolAdded = pool.filter(m => applicantKeys.has(`${m.jobId}:${m.candidateId}`)).length

    // Per job table
    const jobRows = data.jobs.filter(j => jobId === 'all' || j.id === jobId).map(j => {
      const ja = apps.filter(a => a.jobId === j.id)
      const jIds = new Set(ja.map(a => a.id))
      return {
        id: j.id, title: j.title, apps: ja.length,
        matches: matches.filter(m => m.jobId === j.id).length,
        screened: ja.filter(a => a.score !== null).length,
        interviews: data.interviews.filter(i => jIds.has(i.appId)).length,
        accepted: ja.filter(a => a.status === 'accepted').length,
        rejected: ja.filter(a => a.status === 'rejected').length,
      }
    }).filter(row => row.apps > 0 || row.matches > 0)

    return {
      total: apps.length, funnel, rejected, onHold, stageCounts,
      iTotal: interviews.length, iPending: iStatus('pending'), iProgress: iStatus('in_progress'), iCompleted: iStatus('completed'), iAnalysed: iStatus('analysed'),
      completionRate: pct(completed, interviews.length), avgScore: avg(scores), avgHours: avg(hoursToComplete), reco,
      stageTimes, avgDecision: avg(decisionDays), stuck,
      eTotal: emails.length, eApps: new Set(emails.map(e => e.appId)).size, eReplied: replied.length, eRate: pct(replied.length, emails.length), eHours: avg(replyHours),
      mTotal: matches.length, mPool: pool.length, mVivier: matches.length - pool.length, mAvg: avg(matches.map(m => m.score)), poolAdded, poolRate: pct(poolAdded, pool.length),
      jobRows,
    }
  }, [data, jobId, period])

  const jobTitle = (id: string) => data.jobs.find(j => j.id === id)?.title ?? '—'
  const stageLabel = (slug: string) => data.stages.find(s => s.slug === slug)?.label ?? slug
  const funnelMax = Math.max(1, r.funnel[0].value)

  function exportCsv() {
    const rows = [['Offre', 'Candidatures', 'Correspondances IA', 'Screenés', 'Entretiens', 'Acceptés', 'Refusés'],
      ...r.jobRows.map(j => [j.title, j.apps, j.matches, j.screened, j.interviews, j.accepted, j.rejected])]
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `reporting-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const selectStyle = { background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.18)' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Link href="/recruiter/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <BarChart3 className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Reporting de suivi</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Performance de vos recrutements, du matching à la décision</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={jobId} onChange={e => setJobId(e.target.value)} className="px-3 py-2 rounded-lg text-xs font-semibold outline-none max-w-[220px]" style={selectStyle}>
                <option value="all" style={{ color: '#000' }}>Toutes les offres</option>
                {data.jobs.map(j => <option key={j.id} value={j.id} style={{ color: '#000' }}>{j.title}</option>)}
              </select>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.18)' }}>
                {PERIODS.map(p => (
                  <button key={p.v} onClick={() => setPeriod(p.v)} className="px-3 py-2 text-xs font-semibold transition-colors"
                    style={{ background: period === p.v ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)', color: 'white' }}>{p.l}</button>
                ))}
              </div>
              <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85" style={selectStyle}>
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Candidatures dans le funnel" value={String(r.total)} sub={`${r.onHold} en vivier · ${r.rejected} refusés`} color="#6b7280" icon={<Users className="h-4 w-4" />} />
          <Kpi label="Taux d'acceptation" value={`${pct(r.funnel[4].value, r.total)}%`} sub={`${r.funnel[4].value} accepté${r.funnel[4].value > 1 ? 's' : ''}`} color="#10b981" icon={<CheckCircle2 className="h-4 w-4" />} />
          <Kpi label="Entretiens IA terminés" value={`${r.completionRate}%`} sub={`${r.iTotal} envoyés`} color="#3b82f6" icon={<Video className="h-4 w-4" />} />
          <Kpi label="Délai moyen de décision" value={fmtDays(r.avgDecision)} sub="sélection → accepté/refusé" color="#f59e0b" icon={<Clock className="h-4 w-4" />} />
        </div>

        <Section title="Funnel & conversion" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="space-y-2.5">
            {r.funnel.map((step, i) => (
              <Bar key={step.label} label={step.label} value={step.value} max={funnelMax} color={step.color}
                right={i === 0 ? '' : `${pct(step.value, r.funnel[i - 1].value)}%`} />
            ))}
          </div>
          <p className="text-[11px] mt-3" style={{ color: 'var(--color-text-muted)' }}>Le pourcentage à droite est le taux de passage depuis l&apos;étape précédente.</p>
          <div className="flex flex-wrap gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            {r.stageCounts.map(s => (
              <span key={s.slug} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: `${s.color}16`, color: s.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.count} {s.label}
              </span>
            ))}
          </div>
        </Section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Entretiens IA" icon={<Video className="h-4 w-4" />}>
            {r.iTotal === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun entretien sur cette sélection.</p> : (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[{ l: 'En attente', v: r.iPending, c: '#f59e0b' }, { l: 'En cours', v: r.iProgress, c: '#3b82f6' }, { l: 'Terminés', v: r.iCompleted, c: '#8b5cf6' }, { l: 'Analysés', v: r.iAnalysed, c: '#10b981' }].map(x => (
                    <div key={x.l} className="rounded-xl py-2.5" style={{ background: `${x.c}12` }}>
                      <p className="text-lg font-bold" style={{ color: x.c }}>{x.v}</p>
                      <p className="text-[10px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{x.l}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Score moyen</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{r.avgScore !== null ? `${Math.round(r.avgScore)}/100` : '—'}</p></div>
                  <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Complétion</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{r.completionRate}%</p></div>
                  <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Délai de passage</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{r.avgHours !== null ? fmtDays(r.avgHours / 24) : '—'}</p></div>
                </div>
                <div className="flex gap-2 flex-wrap text-xs font-semibold">
                  <span className="px-2.5 py-1 rounded-full" style={{ background: 'rgba(16,185,129,0.14)', color: '#10b981' }}>{r.reco.hire} recommandé{r.reco.hire > 1 ? 's' : ''}</span>
                  <span className="px-2.5 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}>{r.reco.consider} à considérer</span>
                  <span className="px-2.5 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444' }}>{r.reco.reject} non recommandé{r.reco.reject > 1 ? 's' : ''}</span>
                </div>
              </div>
            )}
          </Section>

          <Section title="Délais & vitesse" icon={<Clock className="h-4 w-4" />}>
            <p className="text-[11px] mb-2.5" style={{ color: 'var(--color-text-muted)' }}>Temps moyen passé dans chaque étape</p>
            {r.stageTimes.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Pas encore assez d&apos;historique.</p> : (
              <div className="space-y-2">
                {r.stageTimes.map(s => (
                  <Bar key={s.slug} label={s.label} value={Math.round((s.days ?? 0) * 10) / 10} max={Math.max(...r.stageTimes.map(x => x.days ?? 0), 1)} color={s.color} right={fmtDays(s.days)} showValue={false} />
                ))}
              </div>
            )}
          </Section>
        </div>

        <Section title={`Candidats bloqués depuis plus de 7 jours (${r.stuck.length})`} icon={<AlertTriangle className="h-4 w-4" />}>
          {r.stuck.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun candidat en attente depuis longtemps — bravo.</p> : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {r.stuck.slice(0, 8).map(s => (
                <Link key={s.id} href={`/recruiter/pipeline/${s.jobId}`} className="flex items-center justify-between gap-3 py-2.5 no-underline transition-colors hover:bg-[rgba(11,29,81,0.025)]">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{s.name}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{jobTitle(s.jobId)} · {stageLabel(s.stage)}</p>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{Math.floor(s.days)} j</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Emails personnalisés" icon={<Mail className="h-4 w-4" />}>
            {r.eTotal === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun email suivi envoyé sur cette sélection.</p> : (
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Emails envoyés</p><p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{r.eTotal}</p><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>à {r.eApps} candidat{r.eApps > 1 ? 's' : ''}</p></div>
                <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Taux de réponse</p><p className="text-2xl font-bold" style={{ color: r.eRate >= 50 ? '#10b981' : '#f59e0b' }}>{r.eRate}%</p><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{r.eReplied} réponse{r.eReplied > 1 ? 's' : ''}</p></div>
                <div className="col-span-2"><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Délai moyen de réponse</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{r.eHours !== null ? fmtDays(r.eHours / 24) : '—'}</p></div>
              </div>
            )}
          </Section>

          <Section title="Matching IA" icon={<Brain className="h-4 w-4" />}>
            {r.mTotal === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune correspondance sur cette sélection.</p> : (
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Correspondances trouvées</p><p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{r.mTotal}</p><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{r.mPool} base · {r.mVivier} vivier</p></div>
                <div><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Score moyen</p><p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{r.mAvg !== null ? Math.round(r.mAvg) : '—'}<span className="text-sm font-medium">/100</span></p></div>
                <div className="col-span-2"><p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Candidats de la base ajoutés au funnel</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{r.poolAdded} / {r.mPool} <span className="text-sm font-semibold" style={{ color: 'var(--color-text-muted)' }}>({r.poolRate}%)</span></p></div>
              </div>
            )}
          </Section>
        </div>

        <Section title="Détail par offre" icon={<BarChart3 className="h-4 w-4" />}>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  {['Offre', 'Candidatures', 'Matchs IA', 'Screenés', 'Entretiens', 'Acceptés', 'Refusés'].map((h, i) => <th key={h} className={`px-2 py-2 font-semibold ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.jobRows.length === 0 ? <tr><td colSpan={7} className="px-2 py-6 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune donnée.</td></tr> : r.jobRows.map(j => (
                  <tr key={j.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-2 py-2.5 max-w-[260px]"><Link href={`/recruiter/pipeline/${j.id}`} className="font-semibold no-underline hover:underline truncate block" style={{ color: 'var(--color-text)' }}>{j.title}</Link></td>
                    {[j.apps, j.matches, j.screened, j.interviews, j.accepted, j.rejected].map((v, i) => <td key={i} className="px-2 py-2.5 text-right font-medium" style={{ color: 'var(--color-text)' }}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <p className="text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
          Données à jour au {new Date(data.generatedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })} — rechargez la page pour actualiser.
        </p>
      </div>
    </div>
  )
}
