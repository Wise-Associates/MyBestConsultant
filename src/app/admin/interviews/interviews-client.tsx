'use client'

import { useState } from 'react'
import {
  Search, Clock, CheckCircle2, Brain,
  TrendingUp, Users, Activity, Calendar,
  ExternalLink,
} from 'lucide-react'
import type { AdminInterviewRow, AdminInterviewStats } from './actions'
import { InterviewDetailModal } from './interview-detail-modal'

// ── Status config ─────────────────────────────────────────────────
const STATUS = {
  pending:     { label: 'En attente',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Clock },
  in_progress: { label: 'En cours',    color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  icon: Activity },
  completed:   { label: 'Terminé',     color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: CheckCircle2 },
  analysed:    { label: 'Analysé',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', icon: Brain },
}

// ── Stat card ─────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon: Icon, wide }: {
  label: string; value: string | number; sub?: string
  color: string; icon: React.ElementType; wide?: boolean
}) {
  return (
    <div style={{
      gridColumn: wide ? 'span 2' : undefined,
      borderRadius: 16, padding: '1.25rem 1.5rem',
      background: 'white',
      border: '1px solid rgba(11,29,81,0.07)',
      boxShadow: '0 1px 4px rgba(11,29,81,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(11,29,81,0.4)', marginBottom: '0.5rem' }}>
            {label}
          </p>
          <p style={{ fontSize: '2rem', fontWeight: 700, color: '#0B1D51', lineHeight: 1 }}>{value}</p>
          {sub && <p style={{ fontSize: 11, color: 'rgba(11,29,81,0.4)', marginTop: '0.4rem' }}>{sub}</p>}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon style={{ width: 18, height: 18, color }} />
        </div>
      </div>
    </div>
  )
}

// ── Donut completion ──────────────────────────────────────────────
function CompletionDonut({ rate }: { rate: number }) {
  const r = 42
  const circ = 2 * Math.PI * r
  const dash = (rate / 100) * circ
  return (
    <div style={{ borderRadius: 16, padding: '1.25rem 1.5rem', background: 'white', border: '1px solid rgba(11,29,81,0.07)', boxShadow: '0 1px 4px rgba(11,29,81,0.05)', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(11,29,81,0.06)" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="#10b981" strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" transform="rotate(-90 50 50)" />
        <text x="50" y="54" textAnchor="middle" fontSize="18" fontWeight="700" fill="#0B1D51">{rate}%</text>
      </svg>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(11,29,81,0.4)', marginBottom: '0.5rem' }}>Taux de complétion</p>
        <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0B1D51' }}>Entretiens complétés</p>
        <p style={{ fontSize: 11, color: 'rgba(11,29,81,0.4)', marginTop: '0.25rem' }}>Terminés + analysés / Total</p>
      </div>
    </div>
  )
}

// ── Bar chart by job ──────────────────────────────────────────────
function JobBars({ data }: { data: AdminInterviewStats['byJob'] }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div style={{ borderRadius: 16, padding: '1.25rem 1.5rem', background: 'white', border: '1px solid rgba(11,29,81,0.07)', boxShadow: '0 1px 4px rgba(11,29,81,0.05)', gridColumn: 'span 2' }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(11,29,81,0.4)', marginBottom: '1.25rem' }}>Entretiens par poste</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {data.map(d => (
          <div key={d.title}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#0B1D51', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>{d.completedCount} ✓</span>
                <span style={{ fontSize: 11, color: 'rgba(11,29,81,0.4)' }}>{d.count} total</span>
              </div>
            </div>
            <div style={{ height: 6, borderRadius: 6, background: 'rgba(11,29,81,0.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#B8860B,#d4a017)', width: `${(d.count / max) * 100}%`, transition: 'width 0.6s ease' }} />
            </div>
          </div>
        ))}
        {data.length === 0 && <p style={{ color: 'rgba(11,29,81,0.3)', fontSize: 13 }}>Aucune donnée</p>}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────
export function InterviewsClient({
  rows, stats,
}: {
  rows: AdminInterviewRow[]
  stats: AdminInterviewStats
}) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [selectedRow, setSelectedRow] = useState<AdminInterviewRow | null>(null)

  const filtered = rows.filter(r => {
    const matchSearch = !search ||
      r.candidateName.toLowerCase().includes(search.toLowerCase()) ||
      r.candidateEmail.toLowerCase().includes(search.toLowerCase()) ||
      r.jobTitle.toLowerCase().includes(search.toLowerCase())
    // "Tous" ne montre que les candidats réellement passés en entretien — les
    // invitations jamais démarrées restent visibles via le filtre "En attente" dédié.
    const matchStatus = filterStatus === 'all' ? r.status !== 'pending' : r.status === filterStatus
    return matchSearch && matchStatus
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fc' }}>

      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid rgba(11,29,81,0.08)', padding: '1.75rem 2.5rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#B8860B', marginBottom: '0.35rem' }}>
            Recrutement IA
          </p>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 300, color: '#0B1D51', lineHeight: 1.2 }}>
            Entretiens <strong style={{ fontWeight: 700 }}>candidats</strong>
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(11,29,81,0.45)', marginTop: '0.35rem' }}>
            {stats.total} entretien{stats.total > 1 ? 's' : ''} · {stats.last7days} cette semaine
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 2.5rem' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          <StatCard label="Total" value={stats.total} sub={`+${stats.last7days} cette semaine`} color="#0B1D51" icon={Users} />
          <StatCard label="En attente" value={stats.pending} color="#f59e0b" icon={Clock} />
          <StatCard label="Terminés" value={stats.completed + stats.analysed} color="#10b981" icon={CheckCircle2} />
          <StatCard label="Analysés IA" value={stats.analysed} color="#a78bfa" icon={Brain} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '1rem', marginBottom: '2rem' }}>
          <CompletionDonut rate={stats.completionRate} />
          <StatCard label="Réponses moy." value={stats.avgTranscriptLength} sub="échanges par entretien" color="#B8860B" icon={TrendingUp} />
          <JobBars data={stats.byJob} />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: 'rgba(11,29,81,0.35)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher candidat, email, poste…"
              style={{ width: '100%', padding: '0.65rem 0.75rem 0.65rem 2.5rem', borderRadius: 12, border: '1.5px solid rgba(11,29,81,0.1)', background: 'white', fontSize: '0.875rem', color: '#0B1D51', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Status filter */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { key: 'all', label: 'Tous' },
              { key: 'pending', label: 'En attente' },
              { key: 'in_progress', label: 'En cours' },
              { key: 'completed', label: 'Terminés' },
              { key: 'analysed', label: 'Analysés' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilterStatus(f.key)}
                style={{
                  padding: '0.5rem 1rem', borderRadius: 10, border: `1.5px solid ${filterStatus === f.key ? '#B8860B' : 'rgba(11,29,81,0.1)'}`,
                  background: filterStatus === f.key ? 'rgba(184,134,11,0.08)' : 'white',
                  color: filterStatus === f.key ? '#B8860B' : 'rgba(11,29,81,0.5)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid rgba(11,29,81,0.07)', boxShadow: '0 1px 4px rgba(11,29,81,0.05)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1fr 1fr 40px', gap: '0', padding: '0.75rem 1.5rem', background: 'rgba(11,29,81,0.03)', borderBottom: '1px solid rgba(11,29,81,0.06)' }}>
            {['Candidat', 'Poste', 'Statut', 'Date', 'Réponses', ''].map(col => (
              <p key={col} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(11,29,81,0.4)' }}>{col}</p>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'rgba(11,29,81,0.3)' }}>
              <p style={{ fontSize: 14 }}>Aucun entretien trouvé</p>
            </div>
          ) : (
            filtered.map((row, i) => {
              const st = STATUS[row.status] ?? STATUS.pending
              const Icon = st.icon
              const date = new Date(row.createdAt)
              const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })
              return (
                <div key={row.id}
                  onClick={() => setSelectedRow(row)}
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1fr 1fr 40px',
                    gap: 0, padding: '0.875rem 1.5rem',
                    borderTop: i > 0 ? '1px solid rgba(11,29,81,0.05)' : 'none',
                    alignItems: 'center',
                    transition: 'background 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(184,134,11,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                  {/* Candidat */}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#0B1D51', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.candidateName}
                    </p>
                    <p style={{ fontSize: 11, color: 'rgba(11,29,81,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.candidateEmail || '—'}
                    </p>
                  </div>

                  {/* Poste */}
                  <p style={{ fontSize: 12, color: 'rgba(11,29,81,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '1rem' }}>
                    {row.jobTitle}
                  </p>

                  {/* Statut */}
                  <div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: st.bg, color: st.color }}>
                      <Icon style={{ width: 11, height: 11 }} />{st.label}
                    </span>
                  </div>

                  {/* Date */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Calendar style={{ width: 12, height: 12, color: 'rgba(11,29,81,0.3)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'rgba(11,29,81,0.5)' }}>{dateStr}</span>
                  </div>

                  {/* Réponses */}
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: row.transcriptLength > 0 ? '#0B1D51' : 'rgba(11,29,81,0.25)' }}>
                      {row.transcriptLength > 0 ? `${row.transcriptLength} éch.` : '—'}
                    </span>
                    {row.questionCount > 0 && (
                      <span style={{ fontSize: 10, color: 'rgba(11,29,81,0.3)', marginLeft: 4 }}>/ {row.questionCount}Q</span>
                    )}
                  </div>

                  {/* Action */}
                  <a href={`/interview/${row.id}`}
                    target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, color: 'rgba(11,29,81,0.3)', border: '1px solid rgba(11,29,81,0.1)', textDecoration: 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#B8860B'; e.currentTarget.style.borderColor = '#B8860B' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'rgba(11,29,81,0.3)'; e.currentTarget.style.borderColor = 'rgba(11,29,81,0.1)' }}>
                    <ExternalLink style={{ width: 13, height: 13 }} />
                  </a>
                </div>
              )
            })
          )}
        </div>

        {filtered.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(11,29,81,0.3)', marginTop: '1rem' }}>
            {filtered.length} entretien{filtered.length > 1 ? 's' : ''} · cliquez sur une ligne pour voir les détails
          </p>
        )}
      </div>

      {selectedRow && (
        <InterviewDetailModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  )
}
