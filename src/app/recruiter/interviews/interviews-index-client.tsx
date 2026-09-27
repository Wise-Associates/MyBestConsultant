'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Brain, ChevronRight, Clock, Play, ArrowLeft, Search, ListChecks, Mic, Video, MessageSquare, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Pagination } from '@/components/shared/pagination'
import type { InterviewSession } from './actions'

const PAGE_SIZE = 50

const STATUS_STYLE = {
  pending:    { label: 'En attente',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  in_progress:{ label: 'En cours',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  completed:  { label: 'Terminé',    color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  analysed:   { label: 'Analysé IA', color: '#E8A33D', bg: 'rgba(232,163,61,0.12)' },
}

const RECO_STYLE = {
  hire:     { label: 'À recruter',    color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: TrendingUp },
  consider: { label: 'À considérer',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Minus },
  reject:   { label: 'À rejeter',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: TrendingDown },
}

type Status = keyof typeof STATUS_STYLE

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="mbc-search-pill px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
      style={active
        ? { background: 'white', color: 'var(--navbar-bg)', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }
        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.14)' }}>
      {children}
    </button>
  )
}

export function InterviewsIndexClient({ sessions }: { sessions: InterviewSession[] }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | null>(null)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sessions.filter(s => {
      if (statusFilter) {
        if (s.status !== statusFilter) return false
      } else if (s.status === 'pending') {
        // Invitations envoyées mais jamais démarrées par le candidat — masquées par
        // défaut, la liste ne montre que les candidats réellement passés en entretien.
        return false
      }
      if (!q) return true
      return `${s.candidateName} ${s.jobTitle}`.toLowerCase().includes(q)
    })
  }, [sessions, search, statusFilter])

  const filterKey = `${search}|${statusFilter}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <Brain className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Entretiens IA</h1>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Agent autonome · Questions générées · Analyse automatique</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/recruiter/interviews/questions"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.8)' }}>
                <ListChecks className="h-4 w-4" />Questions génériques
              </Link>
              <Link href="/recruiter/interviews/new"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all hover:-translate-y-0.5"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', boxShadow: '0 8px 20px rgba(232,163,61,0.3)' }}>
                <Play className="h-4 w-4" />Nouvel entretien
              </Link>
            </div>
          </div>

          {sessions.length > 5 && (
            <div className="flex items-center gap-3 mt-6 flex-wrap">
              <div className="flex items-center gap-2 px-4 rounded-xl flex-1 min-w-[200px]"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)' }}>
                <Search className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Candidat, poste…"
                  style={{ background: 'transparent', border: 'none', outline: 'none', color: 'white', width: '100%', padding: '0.7rem 0', fontSize: '0.85rem' }} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(Object.keys(STATUS_STYLE) as Status[]).map(s => (
                  <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}>
                    {STATUS_STYLE[s].label}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {sessions.length === 0 ? (
          <div className="rounded-3xl py-20 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.2)' }}>
            <Brain className="h-10 w-10 mx-auto mb-3 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
            <p style={{ color: 'var(--color-text-muted)' }}>Aucun entretien. Créez-en un depuis une candidature.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl py-20 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.2)' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>Aucun entretien ne correspond à cette recherche.</p>
          </div>
        ) : (
          <>
            <p className="text-xs mb-3 font-semibold" style={{ color: 'var(--color-text-muted)' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} sur {filtered.length} entretien{filtered.length > 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {paged.map(s => {
                const style = STATUS_STYLE[s.status]
                const hasVideo = s.recordings.some(r => r.mediaType === 'video')
                const hasAudio = s.recordings.length > 0
                const reco = s.analysis ? RECO_STYLE[s.analysis.recommendation] : null
                const RecoIcon = reco?.icon
                return (
                  <Link key={s.$id} href={`/recruiter/interviews/${s.$id}`}
                    className="flex items-center gap-4 p-5 rounded-3xl no-underline transition-all duration-300 hover:-translate-y-1 flex-wrap sm:flex-nowrap"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.12)' }}>
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm"
                      style={{ background: 'var(--color-background)', color: 'var(--color-text-muted)' }}>
                      {s.candidateName.slice(0, 1).toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{s.candidateName}</h2>
                      <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>{s.jobTitle}</p>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {hasAudio && (
                          <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                            {hasVideo ? <Video className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                            {hasVideo ? 'Vidéo' : 'Audio'}
                          </span>
                        )}
                        {s.transcript.length > 0 && (
                          <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                            <MessageSquare className="h-3 w-3" />{s.transcript.length} éch. · {s.questions.length}Q
                          </span>
                        )}
                        {reco && RecoIcon && (
                          <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: reco.color, background: reco.bg }}>
                            <RecoIcon className="h-3 w-3" />{reco.label}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                      <span className="text-[11px] font-semibold px-3 py-1 rounded-full whitespace-nowrap"
                        style={{ background: style.bg, color: style.color }}>
                        {style.label}
                      </span>
                      <div className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(s.createdAt).toLocaleDateString('fr-FR')}
                      </div>
                      <ChevronRight className="h-5 w-5" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                    </div>
                  </Link>
                )
              })}
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} accentColor="var(--color-primary)" />
          </>
        )}
      </div>

      <style>{`
        @keyframes mbc-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.08); } }
        @keyframes mbc-float-slow { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-24px, 24px) scale(1.05); } }
        .mbc-orb { animation: mbc-float 14s ease-in-out infinite; }
        .mbc-orb-slow { animation: mbc-float-slow 18s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
