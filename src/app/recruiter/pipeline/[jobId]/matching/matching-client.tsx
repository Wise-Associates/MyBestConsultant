'use client'

import { useEffect, useState, useTransition, type CSSProperties } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { BackLink } from '@/components/recruiter/back-link'
import {
  RefreshCw, Loader2, Brain, Users, FolderOpen, Send, Check, FileText,
  ExternalLink, UserPlus, CheckCircle2, Kanban, Clock, Target, Search,
} from 'lucide-react'
import { LocalTime } from '@/components/shared/local-time'
import { getMatchesAction, refreshPoolMatchingAction, addToFunnelAction, runApplicationMatchingAction } from '../matching-actions'
import type { JobMatchResult } from '@/lib/matching-core'
import {
  EMPTY_MATCHING_FILTERS, filterMatches, isFilteringMatches, matchingFiltersFromSearchParams, withMatchingFilters,
  type MatchingFilters, type MatchScoreFilter, type MatchSourceFilter,
} from '@/lib/matching-filters'
import { initialUrlListSync, noteListWrite, syncFromUrl } from '@/lib/url-list-state'

const PAGE_SIZE = 25

// Barre de filtres : mêmes champs que « Mes offres » du tableau de bord (jobs-list-client.tsx).
const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const field = 'h-11 sm:h-10 px-3 rounded-xl text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)'
const fieldStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const SCORE_OPTIONS: Record<MatchScoreFilter, string> = {
  all: 'Tous les scores', match: 'Correspond (65 et plus)', below: 'Moins de 65', pending: 'Non analysés',
}

function scoreColor(s: number) {
  return s >= 85 ? '#10b981' : s >= 70 ? '#3b82f6' : s >= 55 ? '#f59e0b' : '#ef4444'
}

// Trois types : candidature reçue, base candidats de la plateforme, vivier du recruteur (son nom ; un vivier est personnel).
const SOURCE_LABEL: Record<JobMatchResult['source'], { label: string; icon: typeof Users; color: string }> = {
  pool: { label: 'Base candidats', icon: Users, color: '#3b82f6' },
  vivier: { label: 'Vivier', icon: FolderOpen, color: '#E8A33D' },
  application: { label: 'Candidature', icon: Send, color: '#10b981' },
}

const sourceLabel = (m: JobMatchResult) => m.source === 'vivier' && m.vivierOwner ? `Vivier de ${m.vivierOwner}` : SOURCE_LABEL[m.source].label

function cvHref(m: JobMatchResult): string | null {
  if (!m.cvFileId) return null
  return m.cvBucket === 'vivier' ? `/api/vivier-cv/${m.cvFileId}` : `/api/cv/${m.cvFileId}`
}

function profileHref(m: JobMatchResult): string | null {
  if (m.source === 'application') return m.applicationId ? `/recruiter/candidates/${m.applicationId}` : null
  if (m.source === 'pool') return m.candidateId ? `/recruiter/candidate-preview/pool/${m.candidateId}` : null
  return `/recruiter/candidate-preview/vivier/${m.id}`
}

/** `now` : heure du rendu par le serveur (ISO), avancée à chaque actualisation de la liste. */
export function MatchingClient({ jobId, jobTitle, initialMatches, now }: { jobId: string; jobTitle: string; initialMatches: JobMatchResult[]; now: string }) {
  const [matches, setMatches] = useState(initialMatches)
  const [nowMs, setNowMs] = useState(() => new Date(now).getTime())
  const [page, setPage] = useState(1)
  // Filtres repris de l'adresse (« Retour » depuis un profil les retrouve) ; adresse changée sans la liste : reprise.
  const searchParams = useSearchParams()
  const urlFilters = matchingFiltersFromSearchParams(searchParams)
  const urlQuery = withMatchingFilters(new URLSearchParams(), urlFilters).toString()
  const [filters, setFilters] = useState<MatchingFilters>(urlFilters)
  const [urlSync, setUrlSync] = useState(() => initialUrlListSync(urlQuery))
  if (urlQuery !== urlSync.seen) {
    const step = syncFromUrl(urlSync, urlQuery)
    setUrlSync(step.sync)
    if (step.adopt) {
      setFilters(urlFilters)
      setPage(1)
    }
  }
  const update = (patch: Partial<MatchingFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setPage(1)
    setUrlSync(sync => noteListWrite(sync, withMatchingFilters(new URLSearchParams(), next).toString()))
    // Adresse mise à jour sans relire la page ni ajouter d'étape à l'historique.
    const query = withMatchingFilters(new URLSearchParams(window.location.search), next).toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isRefreshing, startRefreshing] = useTransition()
  const [isAdding, startAdding] = useTransition()
  const [flash, setFlash] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState(false)
  const [running, setRunning] = useState<Set<string>>(new Set())

  // Candidature très récente non encore analysée : le matching tourne (automatiquement dès la réception).
  // On actualise la liste toutes les 8 s (2 min max) pour afficher le résultat sans recharger la page.
  const analysing = (m: JobMatchResult) => m.source === 'application' && m.score === null && !!m.receivedAt && nowMs - new Date(m.receivedAt).getTime() < 10 * 60_000
  const anyAnalysing = matches.some(analysing)
  useEffect(() => {
    if (!anyAnalysing) return
    let tries = 0
    const t = setInterval(async () => {
      if (++tries > 15) { clearInterval(t); return }
      setNowMs(Date.now())
      try { setMatches(await getMatchesAction(jobId)) } catch { /* on réessaie au prochain tour */ }
    }, 8000)
    return () => clearInterval(t)
  }, [anyAnalysing, jobId])

  async function runMatching(m: JobMatchResult) {
    if (!m.applicationId) return
    setRunning(prev => new Set(prev).add(m.applicationId!))
    const res = await runApplicationMatchingAction(jobId, m.applicationId)
    if (res.matches) setMatches(res.matches)
    else if (res.error) setFlash(res.error)
    setRunning(prev => { const n = new Set(prev); n.delete(m.applicationId!); return n })
  }

  const shown = filterMatches(matches, filters)
  const filtering = isFilteringMatches(filters)
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageItems = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const types: { source: MatchSourceFilter; label: string; n: number }[] = [
    { source: 'all', label: 'Tous', n: matches.length },
    { source: 'application', label: 'Candidatures', n: matches.filter(m => m.source === 'application').length },
    { source: 'pool', label: 'Base candidats', n: matches.filter(m => m.source === 'pool').length },
    { source: 'vivier', label: 'Vivier', n: matches.filter(m => m.source === 'vivier').length },
  ]

  function toggle(m: JobMatchResult) {
    if (m.alreadyInFunnel) return
    setSelected(prev => {
      const s = new Set(prev)
      s.has(m.id) ? s.delete(m.id) : s.add(m.id)
      return s
    })
  }

  // « Rafraîchir » recalcule tout (demande du 2026-11-04 ; plus de bouton « Recalculer tout » ni de confirmation) : les
  // scores déjà calculés de la base candidats, puis les candidats pas encore notés. Deux requêtes, chacune dans les 300 s
  // de la page (page.tsx) : réunies, jusqu'à 150 notations n'y tiendraient pas. Une candidature se recalcule sur sa
  // carte (« Relancer »).
  function refresh() {
    setFlash(null)
    startRefreshing(async () => {
      try {
        const rescored = await refreshPoolMatchingAction(jobId, 'all')
        // Premier passage en échec complet (IA indisponible, aucun CV) : le second échouerait de même.
        let added: { matched?: number; error?: string } = {}
        if (rescored.matched || !rescored.error) added = await refreshPoolMatchingAction(jobId, 'new')
        const s = (n: number) => (n > 1 ? 's' : '')
        const done = [
          rescored.matched ? `${rescored.matched} score${s(rescored.matched)} recalculé${s(rescored.matched)}` : '',
          added.matched ? `${added.matched} nouveau${added.matched > 1 ? 'x' : ''} candidat${s(added.matched)} noté${s(added.matched)}` : '',
        ].filter(Boolean).join(', ')
        setFlash([done && `${done}.`, rescored.error, added.error].filter(Boolean).join(' ') || null)
        setMatches(await getMatchesAction(jobId))
        setPage(1)
      } catch (e) {
        setFlash(`Le recalcul n’a pas abouti (${e instanceof Error ? e.message : 'erreur inconnue'}). Réessayez dans quelques minutes.`)
      }
    })
  }

  function addToFunnel() {
    const selections = matches
      .filter(m => selected.has(m.id))
      .map(m => ({ source: m.source, id: m.id, candidateId: m.candidateId }))
    if (selections.length === 0) return

    startAdding(async () => {
      const result = await addToFunnelAction(jobId, selections)
      setFlash(
        result.errors.length > 0
          ? `${result.added} candidat(s) ajouté(s), ${result.errors.length} erreur(s) : ${result.errors[0]}`
          : `${result.added} candidat(s) ajouté(s) au funnel avec succès`
      )
      setJustAdded(result.added > 0)
      setSelected(new Set())
      setMatches(await getMatchesAction(jobId))
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)', paddingBottom: selected.size > 0 ? 88 : 0 }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-[1000px] mx-auto px-6 py-6">
          <BackLink fallbackHref={`/recruiter/pipeline/${jobId}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-3 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }} />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                <Brain className="h-3.5 w-3.5" /> Matching IA
              </p>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.5rem' }}>{jobTitle}</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={refresh} disabled={isRefreshing}
                title="Recalcule les scores de la base candidats pour cette offre, puis note les nouveaux candidats. Une candidature se recalcule sur sa carte (« Relancer »)."
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.15)' }}>
                {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                Rafraîchir
              </button>
              <Link href={`/recruiter/pipeline/${jobId}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold no-underline transition-opacity hover:opacity-85"
                style={{ background: '#10b981', color: 'white', boxShadow: '0 6px 16px -6px rgba(16,185,129,0.6)' }}>
                <Kanban className="h-3.5 w-3.5" /> Passer au pipeline
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1000px] mx-auto px-6 py-8">
        <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
          L&apos;IA a comparé cette offre aux candidatures reçues, à la base de candidats et à votre vivier (celui de l&apos;offre et votre vivier général). Sélectionnez qui vous intéresse puis lancez (ou relancez) le screening.
        </p>

        {flash && (
          <div role="status" className="mb-4 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'rgba(232,163,61,0.1)', color: '#b8862f' }}>
            {flash}
          </div>
        )}

        {matches.length === 0 ? (
          <div className="text-center py-16 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
            <p style={{ color: 'var(--color-text-muted)' }}>Aucune correspondance pour l&apos;instant.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Ajoutez des CV à votre vivier ou cliquez sur « Rafraîchir ».</p>
          </div>
        ) : (
          <>
            <div role="search" aria-label="Filtrer les correspondances" className="mb-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5">
              <label className="relative block flex-1 min-w-0 sm:min-w-56">
                <span className="sr-only">Rechercher un candidat</span>
                <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={muted} />
                <input type="search" value={filters.q} onChange={e => update({ q: e.target.value })}
                  placeholder="Rechercher un nom, un e-mail…" className={`${field} w-full pl-9 font-normal text-sm`} style={fieldStyle} />
              </label>
              <div role="group" aria-label="Type de candidat" className="grid grid-cols-2 sm:flex gap-0.5 p-0.75 rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                {types.map(t => {
                  const on = filters.source === t.source
                  return (
                    <button key={t.source} type="button" aria-pressed={on} onClick={() => update({ source: t.source })}
                      className="h-9.5 sm:h-8.5 px-3 rounded-lg border-0 inline-flex items-center justify-center gap-1.5 text-[13px] whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-(--color-text)"
                      style={{
                        background: on ? 'var(--color-surface)' : 'transparent', color: 'var(--color-text)', fontWeight: on ? 600 : 500,
                        boxShadow: on ? '0 1px 2px rgba(28,28,30,0.08), 0 0 0 1px rgba(28,28,30,0.04)' : undefined,
                      }}>
                      {t.label} <span className="text-xs tabular-nums" style={muted}>{t.n}</span>
                    </button>
                  )
                })}
              </div>
              <select aria-label="Score" value={filters.score} onChange={e => update({ score: e.target.value as MatchScoreFilter })} className={field} style={fieldStyle}>
                {Object.entries(SCORE_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {filtering && (
              <p className="mb-3 text-[13px] flex items-center gap-2 flex-wrap" style={muted}>
                {shown.length} correspondance{shown.length > 1 ? 's' : ''} sur {matches.length}
                <button type="button" onClick={() => update(EMPTY_MATCHING_FILTERS)}
                  className="font-semibold underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={{ color: 'var(--color-text)' }}>
                  Réinitialiser les filtres
                </button>
              </p>
            )}
            {shown.length === 0 ? (
              <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <p className="text-sm" style={muted}>Aucune correspondance pour ces filtres.</p>
              </div>
            ) : (
            <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-2.5">
              {pageItems.map(m => {
                const src = SOURCE_LABEL[m.source]
                const isSelected = selected.has(m.id)
                const cv = cvHref(m)
                const profile = profileHref(m)
                const disabled = m.alreadyInFunnel
                return (
                  <div key={`${m.source}-${m.id}`} onClick={() => toggle(m)}
                    className="flex items-start gap-3 rounded-2xl p-4 transition-all"
                    style={{
                      background: disabled ? 'rgba(0,0,0,0.02)' : 'var(--color-surface)',
                      border: isSelected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      boxShadow: disabled ? 'none' : '0 4px 14px rgba(11,29,81,0.06)',
                      opacity: disabled ? 0.55 : 1,
                      cursor: disabled ? 'default' : 'pointer',
                    }}>
                    {disabled ? (
                      <span className="flex items-center gap-1 shrink-0 mt-0.5 text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ background: 'rgba(16,185,129,0.14)', color: '#10b981' }}>
                        <CheckCircle2 className="h-3 w-3" /> Dans le funnel
                      </span>
                    ) : (
                      <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: isSelected ? 'var(--color-primary)' : 'rgba(0,0,0,0.05)', border: '1px solid var(--color-border)' }}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {profile ? (
                          <a href={profile} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="text-sm font-semibold no-underline hover:underline flex items-center gap-1"
                            style={{ color: 'var(--color-text)' }}>
                            {m.name} <ExternalLink className="h-3 w-3 opacity-50" />
                          </a>
                        ) : (
                          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                        )}
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${src.color}18`, color: src.color }}>
                          <src.icon className="h-2.5 w-2.5" /> {sourceLabel(m)}
                        </span>
                        {m.score != null ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${scoreColor(m.score)}18`, color: scoreColor(m.score) }}>
                            {m.score}/100
                          </span>
                        ) : analysing(m) || (m.applicationId && running.has(m.applicationId)) ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.12)', color: '#3b82f6' }}>
                            <Loader2 className="h-3 w-3 animate-spin" /> Matching en cours…
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(107,114,128,0.12)', color: '#9ca3af' }}>
                            Non analysé
                          </span>
                        )}
                        {m.recommendation ? (
                          <span title={m.recommendation.matched.map(x => `${x.expertise} ×${x.count}`).join(', ')} className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,163,61,0.16)', color: '#8a6a1f' }}>
                            ★ Recommandé +{m.recommendation.points}
                          </span>
                        ) : null}
                        {m.hunterName && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(20,184,166,0.14)', color: '#0d9488' }} title="Profil proposé par un chasseur de têtes">
                            <Target className="h-2.5 w-2.5" /> Proposé par un chasseur · {m.hunterName}
                          </span>
                        )}
                        {cv && (
                          <a href={cv} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 text-[11px] font-semibold no-underline hover:underline"
                            style={{ color: 'var(--color-primary)' }}>
                            <FileText className="h-3 w-3" /> Voir le CV
                          </a>
                        )}
                      </div>
                      {m.email && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{m.email}</p>}
                      {(m.receivedAt || m.matchedAt || (m.source === 'application' && m.score === null)) && (
                        <p className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          {m.receivedAt && (
                            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{m.source === 'application' ? (m.hunterName ? 'Proposé le' : 'Reçue le') : 'Importé le'} <LocalTime iso={m.receivedAt} className="font-semibold" style={{ color: 'var(--color-text)' }} /></span>
                          )}
                          {m.matchedAt ? (
                            <span className="inline-flex items-center gap-1"><Brain className="h-3 w-3" />Matching le <LocalTime iso={m.matchedAt} className="font-semibold" style={{ color: 'var(--color-text)' }} />
                              {/* Score d'une candidature calculé avant une évolution de la notation : se recalcule ici, sans
                                  nouvel e-mail au candidat (envoyé à la première analyse seulement). */}
                              {m.source === 'application' && m.applicationId && (
                                <button type="button" disabled={running.has(m.applicationId)} onClick={e => { e.stopPropagation(); void runMatching(m) }}
                                  className="ml-1 font-bold underline disabled:opacity-50" style={{ color: 'var(--color-primary)' }}>
                                  {running.has(m.applicationId) ? 'Matching en cours…' : 'Relancer'}
                                </button>
                              )}
                            </span>
                          ) : m.source === 'application' && m.score === null && !analysing(m) && m.applicationId ? (
                            <button type="button" disabled={running.has(m.applicationId)} onClick={e => { e.stopPropagation(); void runMatching(m) }}
                              className="inline-flex items-center gap-1 font-bold underline disabled:opacity-50" style={{ color: 'var(--color-primary)' }}>
                              <Brain className="h-3 w-3" />Lancer le matching
                            </button>
                          ) : null}
                        </p>
                      )}
                      {m.reason && <p className="text-xs mt-1.5 leading-snug" style={{ color: 'var(--color-text-muted)' }}>{m.reason}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
            )}

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-5">
                <button onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-30"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  Précédent
                </button>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Page {currentPage} / {pageCount}</span>
                <button onClick={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage === pageCount}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-30"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {(selected.size > 0 || justAdded) && (
        <div className="fixed bottom-0 left-0 right-0 px-6 py-4 z-30" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', boxShadow: '0 -8px 24px rgba(11,29,81,0.1)' }}>
          <div className="max-w-[1000px] mx-auto flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {selected.size > 0
                ? <><span className="font-bold" style={{ color: 'var(--color-text)' }}>{selected.size}</span> candidat{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</>
                : 'Ajout terminé.'}
            </p>
            <div className="flex items-center gap-3">
              {selected.size > 0 && (
                <button onClick={addToFunnel} disabled={isAdding}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  {isAdding ? <><Loader2 className="h-4 w-4 animate-spin" /> Ajout…</> : <><UserPlus className="h-4 w-4" /> Ajouter dans le funnel</>}
                </button>
              )}
              {justAdded && selected.size === 0 && (
                <Link href={`/recruiter/pipeline/${jobId}`}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold no-underline transition-opacity hover:opacity-85"
                  style={{ background: '#10b981', color: 'white' }}>
                  <Kanban className="h-4 w-4" /> Passer au pipeline
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
