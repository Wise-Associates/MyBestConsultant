'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Brain, ChevronRight, ListChecks, Mic, Play, ScanSearch, Search, Video, X } from 'lucide-react'
import { Pagination } from '@/components/shared/pagination'
import type { InterviewSession } from './actions'

// Liste des entretiens IA du recruteur (refonte du 2026-11-21) : en-tête d'une ligne comme les autres pages de l'espace
// recruteur, onglets de statut avec leur nombre, recherche, puis une liste dense — tableau à partir de 1024 px (candidat,
// format, questions, avis de l'IA, statut, date), lignes empilées en dessous. Le score de l'IA est l'élément mis en avant.

const PAGE_SIZE = 50

type Status = InterviewSession['status']
/** « Passés » : entretiens réellement démarrés (vue par défaut) ; les invitations jamais ouvertes sont à part. */
type Tab = 'done' | Status

const STATUS_STYLE: Record<Status, { label: string; color: string; bg: string }> = {
  pending: { label: 'En attente', color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  in_progress: { label: 'En cours', color: '#1d4ed8', bg: 'rgba(59,130,246,0.12)' },
  completed: { label: 'Terminé', color: '#047857', bg: 'rgba(16,185,129,0.12)' },
  analysed: { label: 'Analysé', color: 'var(--hero-accent)', bg: 'rgba(232,163,61,0.14)' },
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'done', label: 'Passés' },
  { key: 'pending', label: 'En attente' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'completed', label: 'Terminés' },
  { key: 'analysed', label: 'Analysés' },
]

const RECO_LABEL = { hire: 'À recruter', consider: 'À considérer', reject: 'À rejeter' } as const

const inTab = (s: InterviewSession, tab: Tab) => (tab === 'done' ? s.status !== 'pending' : s.status === tab)

/** Couleur du score de l'IA : 70 et plus, 50 à 69, moins de 50. */
function scoreColor(score: number): { color: string; bg: string } {
  if (score >= 70) return { color: '#047857', bg: 'rgba(16,185,129,0.12)' }
  if (score >= 50) return { color: '#b45309', bg: 'rgba(245,158,11,0.12)' }
  return { color: '#b91c1c', bg: 'rgba(239,68,68,0.10)' }
}

function shortDate(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

function formatOf(s: InterviewSession): 'video' | 'audio' | null {
  if (s.recordings.length === 0) return null
  return s.recordings.some(r => r.mediaType === 'video') ? 'video' : 'audio'
}

export function InterviewsIndexClient({ sessions }: { sessions: InterviewSession[] }) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('done')
  const [page, setPage] = useState(1)

  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, sessions.filter(s => inTab(s, t.key)).length])) as Record<Tab, number>, [sessions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sessions.filter(s => inTab(s, tab) && (!q || `${s.candidateName} ${s.jobTitle}`.toLowerCase().includes(q)))
  }, [sessions, search, tab])

  // Recherche ou onglet changés : retour à la première page (ajusté pendant le rendu, sans effet).
  const filterKey = `${search}|${tab}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 flex-wrap min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Brain className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        <div className="flex-1 min-w-[10rem]">
          {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
          <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: 0 }}>Entretiens IA</h1>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {sessions.length} entretien{sessions.length > 1 ? 's' : ''} · questions générées, réponses analysées par l’IA
          </p>
        </div>
        <nav aria-label="Actions des entretiens" className="flex items-center gap-2 flex-wrap">
          {/* Le screening des CV est rangé avec les entretiens (rubrique « Entretiens IA » du menu). */}
          <Link href="/recruiter/screening"
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium no-underline transition-colors hover:bg-[var(--color-background)]"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <ScanSearch className="h-4 w-4" aria-hidden />Screening CV
          </Link>
          <Link href="/recruiter/interviews/questions"
            className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm font-medium no-underline transition-colors hover:bg-[var(--color-background)]"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <ListChecks className="h-4 w-4" aria-hidden />Questions par défaut
          </Link>
          <Link href="/recruiter/interviews/new"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold no-underline transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
            <Play className="h-4 w-4" aria-hidden />Nouvel entretien
          </Link>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {sessions.length === 0 ? (
          <div className="rounded-2xl px-6 py-16 text-center" style={{ border: '1px dashed var(--color-border)' }}>
            <Brain className="h-9 w-9 mx-auto mb-3" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} aria-hidden />
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Aucun entretien pour le moment</p>
            <p className="text-sm mt-1 mb-5" style={{ color: 'var(--color-text-muted)' }}>
              Lancez-en un ici, ou depuis la carte d’un candidat dans le pipeline d’une offre.
            </p>
            <Link href="/recruiter/interviews/new"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold no-underline"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
              <Play className="h-4 w-4" aria-hidden />Nouvel entretien
            </Link>
          </div>
        ) : (<>
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div role="group" aria-label="Filtrer par statut" className="flex items-center gap-1 overflow-x-auto p-1 rounded-xl"
              style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
              {TABS.map(t => {
                const active = tab === t.key
                return (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={active}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    style={active
                      ? { background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
                      : { color: 'var(--color-text-muted)' }}>
                    {t.label}
                    <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{counts[t.key]}</span>
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1 lg:max-w-sm lg:ml-auto"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
              <span className="sr-only">Rechercher un candidat ou un poste</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Candidat, poste…"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none" style={{ color: 'var(--color-text)' }} />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche" style={{ color: 'var(--color-text-muted)' }}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl px-6 py-12 text-center" style={{ border: '1px dashed var(--color-border)' }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {search ? 'Aucun entretien ne correspond à cette recherche.' : `Aucun entretien « ${TABS.find(t => t.key === tab)?.label.toLowerCase()} ».`}
              </p>
              {(search || tab !== 'done') && (
                <button type="button" onClick={() => { setSearch(''); setTab('done') }}
                  className="mt-3 text-sm font-semibold underline" style={{ color: 'var(--color-text)' }}>
                  Voir tous les entretiens passés
                </button>
              )}
            </div>
          ) : (<>
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="iv-grid iv-head text-xs font-semibold uppercase tracking-wider px-4 py-2.5"
                style={{ color: 'var(--color-text-muted)', background: 'var(--color-background)', borderBottom: '1px solid var(--color-border)' }}>
                <span>Candidat</span><span>Format</span><span>Questions</span><span>Avis de l’IA</span><span>Statut</span><span>Date</span><span aria-hidden />
              </div>
              <ul>
                {paged.map((s, i) => {
                  const status = STATUS_STYLE[s.status]
                  const format = formatOf(s)
                  const score = s.analysis?.overallScore
                  const reco = s.analysis ? RECO_LABEL[s.analysis.recommendation] : null
                  return (
                    <li key={s.$id} style={i > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}>
                      <Link href={`/recruiter/interviews/${s.$id}`}
                        className="iv-grid iv-row px-4 py-3 no-underline transition-colors hover:bg-[var(--color-background)] focus-visible:outline-none focus-visible:bg-[var(--color-background)]">
                        <span className="iv-who flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold"
                            style={{ background: 'var(--color-background)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }} aria-hidden>
                            {s.candidateName.trim().slice(0, 1).toUpperCase() || '?'}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{s.candidateName || 'Candidat sans nom'}</span>
                            <span className="block text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{s.jobTitle}</span>
                          </span>
                        </span>
                        <span className="iv-format inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {format === 'video' ? <><Video className="h-3.5 w-3.5" aria-hidden />Vidéo</>
                            : format === 'audio' ? <><Mic className="h-3.5 w-3.5" aria-hidden />Audio</>
                            : <span className="iv-desktop">—</span>}
                        </span>
                        <span className="iv-questions text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                          {s.questions.length} question{s.questions.length > 1 ? 's' : ''}
                        </span>
                        <span className="iv-ai inline-flex items-center gap-2 min-w-0">
                          {typeof score === 'number' ? (<>
                            <span className="inline-flex items-center justify-center min-w-9 h-7 px-1.5 rounded-lg text-sm font-bold tabular-nums"
                              style={scoreColor(score)} aria-label={`Score de l’IA : ${score} sur 100`}>{score}</span>
                            {reco && <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{reco}</span>}
                          </>) : (
                            <span className="iv-desktop text-xs" style={{ color: 'var(--color-text-muted)' }}>
                              {s.status === 'completed' ? 'Analyse à lancer' : '—'}
                            </span>
                          )}
                        </span>
                        <span className="iv-status">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: status.bg, color: status.color }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />{status.label}
                          </span>
                        </span>
                        <span className="iv-date text-xs whitespace-nowrap tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                          <time dateTime={s.createdAt}>{shortDate(s.createdAt)}</time>
                        </span>
                        <ChevronRight className="iv-chevron h-4 w-4" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} sur {filtered.length}
              </p>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} accentColor="var(--color-primary)" />
            </div>
          </>)}
        </>)}
      </div>

      {/* Lignes : empilées sur mobile (nom, puis statut, score, format, date), tableau à 7 colonnes à partir de 1024 px. */}
      <style>{`
        .iv-head { display: none; }
        .iv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
        .iv-row .iv-who { flex: 1 1 100%; }
        .iv-row .iv-chevron, .iv-row .iv-questions, .iv-row .iv-desktop { display: none; }
        .iv-row .iv-status { order: 1; }
        .iv-row .iv-ai { order: 2; }
        .iv-row .iv-format { order: 3; }
        .iv-row .iv-date { order: 4; margin-left: auto; }
        @media (min-width: 1024px) {
          .iv-grid { display: grid; grid-template-columns: minmax(0, 2.4fr) 5.5rem 6.5rem minmax(0, 1.6fr) 7rem 5.5rem 1rem; column-gap: 1rem; align-items: center; }
          .iv-row .iv-who { flex: none; }
          .iv-row .iv-status, .iv-row .iv-ai, .iv-row .iv-format, .iv-row .iv-date { order: 0; margin-left: 0; }
          .iv-row .iv-chevron { display: block; }
          .iv-row .iv-questions, .iv-row .iv-desktop { display: inline; }
        }
      `}</style>
    </div>
  )
}
