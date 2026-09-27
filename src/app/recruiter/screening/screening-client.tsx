'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  Brain, Loader2, Check, X, ChevronDown, ChevronUp,
  Download, ArrowLeft, Star, AlertTriangle, TrendingUp, TrendingDown,
  CheckCircle2, XCircle, MinusCircle, Users, Target, SlidersHorizontal,
  Briefcase, Clock, Globe, Zap, Search, FileText,
} from 'lucide-react'
import { screenAllApplications, exportScreeningCSV, type ScreeningScore, type ApplicationRow } from './actions'
import { useLoading } from '@/components/shared/loading-provider'
import { ResultActions } from './result-actions'
import { Pagination } from '@/components/shared/pagination'
import { CvPreviewModal } from '@/components/shared/cv-preview-modal'

const PAGE_SIZE = 50

// ── Types ─────────────────────────────────────────────────────────

export interface ScreeningCriteria {
  experienceLevel: 'any' | 'junior' | 'senior' | 'expert'
  availability: 'any' | 'immediate' | 'one_month' | 'flexible'
  languages: 'any' | 'fr' | 'en' | 'bilingual'
  prioritySkills: string  // free text
  extraInstructions: string
}

const DEFAULT_CRITERIA: ScreeningCriteria = {
  experienceLevel: 'any',
  availability: 'any',
  languages: 'any',
  prioritySkills: '',
  extraInstructions: '',
}

// ── Constants ─────────────────────────────────────────────────────

const RECO: Record<string, { label: string; color: string; bg: string; darkBg: string; icon: React.ElementType }> = {
  top:     { label: 'Top profil',    color: '#10b981', bg: 'rgba(16,185,129,0.1)', darkBg: '#065f46', icon: Star },
  good:    { label: 'Bon profil',    color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', darkBg: '#1e3a8a', icon: CheckCircle2 },
  average: { label: 'Profil moyen', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', darkBg: '#78350f', icon: MinusCircle },
  weak:    { label: 'Profil faible', color: '#e8a33d', bg: 'rgba(232,163,61,0.1)', darkBg: '#7c2d12', icon: TrendingDown },
  reject:  { label: 'À rejeter',    color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   darkBg: '#7f1d1d', icon: XCircle },
}

// ── Sub-components ────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 85 ? '#10b981' : score >= 70 ? '#3b82f6' : score >= 55 ? '#f59e0b' : score >= 40 ? '#e8a33d' : '#ef4444'
  return (
    <div className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(11,29,81,0.08)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${score} 100`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  )
}

function SkillTag({ name, match }: { name: string; match: 'yes' | 'partial' | 'no' }) {
  const styles = {
    yes:     { bg: 'rgba(16,185,129,0.12)',  color: '#10b981', Icon: Check },
    partial: { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', Icon: MinusCircle },
    no:      { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', Icon: X },
  }
  const s = styles[match]
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}>
      <s.Icon className="h-3 w-3" />{name}
    </span>
  )
}

interface ResultCardProps {
  result: ScreeningScore
  jobId: string
  jobDescription: string
  jobSkills: string[]
}

function ResultCard({ result, jobId, jobDescription, jobSkills }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showCv, setShowCv] = useState(false)
  const reco = RECO[result.recommendation] ?? RECO.average

  return (
    <div className="rounded-3xl overflow-hidden transition-all duration-300"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
      <div className="flex items-start gap-4 p-5">
        <ScoreBadge score={result.score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/recruiter/candidates/${result.applicationId}`}
              className="font-bold no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
              {result.candidateName}
            </Link>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: reco.bg, color: reco.color }}>
              <reco.icon className="h-3 w-3" />{reco.label}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{result.candidateEmail}</p>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-text)' }}>{result.summary}</p>

          <ResultActions
            applicationId={result.applicationId}
            jobId={jobId}
            jobTitle={result.jobTitle}
            jobDescription={jobDescription}
            jobSkills={jobSkills}
            candidateName={result.candidateName}
            candidateEmail={result.candidateEmail}
            screeningSummary={result.summary}
          />
        </div>

        {/* CV preview */}
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          {result.cvFileId ? (
            <button onClick={() => setShowCv(true)}
              className="w-16 h-20 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-300 hover:-translate-y-0.5"
              style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 6px 16px -4px rgba(124,58,237,0.25)' }}>
              <FileText className="h-5 w-5" style={{ color: '#7c3aed' }} />
              <span className="text-[10px] font-bold" style={{ color: '#7c3aed' }}>Voir CV</span>
            </button>
          ) : (
            <div className="w-16 h-20 rounded-xl flex flex-col items-center justify-center gap-1"
              style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)' }}>
              <FileText className="h-5 w-5 opacity-30" style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-[9px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Pas de CV</span>
            </div>
          )}
        </div>

        <button onClick={() => setExpanded(v => !v)}
          className="p-2 rounded-xl transition-all shrink-0 mt-0.5"
          style={{ color: 'var(--color-text-muted)' }}>
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
      </div>

      {showCv && result.cvFileId && (
        <CvPreviewModal fileId={result.cvFileId} candidateName={result.candidateName} onClose={() => setShowCv(false)} />
      )}

      {expanded && (
        <div className="px-5 pb-5 space-y-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          {result.skills.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest mt-4 mb-3" style={{ color: 'var(--color-text-muted)' }}>Compétences</p>
              <div className="flex flex-wrap gap-2">
                {result.skills.map((s, i) => <SkillTag key={i} name={s.name} match={s.match} />)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {result.strengths.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-muted)' }}>Points forts</p>
                <ul className="space-y-1.5">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#10b981' }} />{s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.concerns.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-muted)' }}>Vigilance</p>
                <ul className="space-y-1.5">
                  {result.concerns.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />{s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
            Analysé par {result.provider} · {new Date(result.scoredAt).toLocaleString('fr-FR')}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Criteria panel ────────────────────────────────────────────────

function CriteriaChip<T extends string>({
  label, value, active, onClick,
}: { label: string; value: T; active: boolean; onClick: (v: T) => void }) {
  return (
    <button onClick={() => onClick(value)}
      className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
      style={{
        background: active ? 'rgba(124,58,237,0.14)' : 'rgba(11,29,81,0.03)',
        color: active ? '#7c3aed' : 'var(--color-text-muted)',
        border: active ? '1px solid rgba(124,58,237,0.35)' : '1px solid var(--color-border)',
      }}>
      {label}
    </button>
  )
}

function CriteriaPanel({ criteria, onChange }: { criteria: ScreeningCriteria; onChange: (c: ScreeningCriteria) => void }) {
  const [open, setOpen] = useState(false)

  const set = <K extends keyof ScreeningCriteria>(key: K, val: ScreeningCriteria[K]) =>
    onChange({ ...criteria, [key]: val })

  const hasCustom = criteria.experienceLevel !== 'any' || criteria.availability !== 'any' ||
    criteria.languages !== 'any' || criteria.prioritySkills || criteria.extraInstructions

  return (
    <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left transition-all">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="h-4 w-4" style={{ color: hasCustom ? '#7c3aed' : 'var(--color-text-muted)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Critères de scoring
          </span>
          {hasCustom && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(124,58,237,0.14)', color: '#7c3aed' }}>
              Personnalisés
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
               : <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* Expérience */}
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Niveau d&apos;expérience
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Peu importe', value: 'any' },
                { label: '< 3 ans (Junior)', value: 'junior' },
                { label: '3–7 ans (Senior)', value: 'senior' },
                { label: '7+ ans (Expert)', value: 'expert' },
              ].map(o => (
                <CriteriaChip key={o.value} label={o.label} value={o.value as ScreeningCriteria['experienceLevel']}
                  active={criteria.experienceLevel === o.value}
                  onClick={v => set('experienceLevel', v)} />
              ))}
            </div>
          </div>

          {/* Disponibilité */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Disponibilité souhaitée
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Flexible', value: 'any' },
                { label: 'Immédiate', value: 'immediate' },
                { label: 'Sous 1 mois', value: 'one_month' },
                { label: 'À négocier', value: 'flexible' },
              ].map(o => (
                <CriteriaChip key={o.value} label={o.label} value={o.value as ScreeningCriteria['availability']}
                  active={criteria.availability === o.value}
                  onClick={v => set('availability', v)} />
              ))}
            </div>
          </div>

          {/* Langues */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Langue(s) requise(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Indifférent', value: 'any' },
                { label: 'Français', value: 'fr' },
                { label: 'Anglais', value: 'en' },
                { label: 'Bilingue FR/EN', value: 'bilingual' },
              ].map(o => (
                <CriteriaChip key={o.value} label={o.label} value={o.value as ScreeningCriteria['languages']}
                  active={criteria.languages === o.value}
                  onClick={v => set('languages', v)} />
              ))}
            </div>
          </div>

          {/* Compétences prioritaires */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
                Compétences prioritaires (bonus)
              </p>
            </div>
            <input
              value={criteria.prioritySkills}
              onChange={e => set('prioritySkills', e.target.value)}
              placeholder="ex: React, TypeScript, Docker…"
              className="w-full px-4 py-2.5 rounded-xl text-sm"
              style={{
                background: 'rgba(11,29,81,0.03)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                outline: 'none',
              }}
            />
          </div>

          {/* Instructions libres */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Instructions personnalisées
            </p>
            <textarea
              value={criteria.extraInstructions}
              onChange={e => set('extraInstructions', e.target.value)}
              placeholder="ex: Favoriser les profils avec expérience SaaS, exclure les profils sans expérience en startup…"
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl text-sm resize-none"
              style={{
                background: 'rgba(11,29,81,0.03)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                outline: 'none',
                lineHeight: 1.6,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────

export function ScreeningClient({
  jobId, jobTitle, jobDescription, jobSkills, applications, existingResults = [],
}: {
  jobId: string
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  applications: ApplicationRow[]
  existingResults?: ScreeningScore[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(applications.map(a => a.applicationId)))
  const [criteria, setCriteria] = useState<ScreeningCriteria>(DEFAULT_CRITERIA)
  const [results, setResults] = useState<ScreeningScore[]>(existingResults)
  const [errors, setErrors] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(existingResults.length > 0)
  const { withLoading } = useLoading()

  const [appSearch, setAppSearch] = useState('')
  const [appPage, setAppPage] = useState(1)
  const [resultSearch, setResultSearch] = useState('')
  const [recoFilter, setRecoFilter] = useState<ScreeningScore['recommendation'] | null>(null)
  const [resultPage, setResultPage] = useState(1)

  const sorted = [...results].sort((a, b) => b.score - a.score)

  const filteredApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase()
    if (!q) return applications
    return applications.filter(a => `${a.candidateName} ${a.candidateEmail}`.toLowerCase().includes(q))
  }, [applications, appSearch])
  const appTotalPages = Math.max(1, Math.ceil(filteredApps.length / PAGE_SIZE))
  const pagedApps = filteredApps.slice((appPage - 1) * PAGE_SIZE, appPage * PAGE_SIZE)
  useEffect(() => { setAppPage(1) }, [appSearch])

  const filteredResults = useMemo(() => {
    const q = resultSearch.trim().toLowerCase()
    return sorted.filter(r => {
      if (recoFilter && r.recommendation !== recoFilter) return false
      if (!q) return true
      return `${r.candidateName} ${r.candidateEmail}`.toLowerCase().includes(q)
    })
  }, [sorted, resultSearch, recoFilter])
  const resultTotalPages = Math.max(1, Math.ceil(filteredResults.length / PAGE_SIZE))
  const pagedResults = filteredResults.slice((resultPage - 1) * PAGE_SIZE, resultPage * PAGE_SIZE)
  useEffect(() => { setResultPage(1) }, [resultSearch, recoFilter])

  function toggleApp(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleAll() {
    setSelected(selected.size === applications.length ? new Set() : new Set(applications.map(a => a.applicationId)))
  }

  function runScreening() {
    setDone(false); setResults([]); setErrors([])
    withLoading(() => new Promise<void>(resolve => {
      startTransition(async () => {
        const { results: res, errors: errs } = await screenAllApplications(jobId, [...selected], criteria)
        setResults(res); setErrors(errs); setDone(true)
        resolve()
      })
    }), 'Analyse IA en cours…')
  }

  async function downloadCSV() {
    const csv = await exportScreeningCSV(sorted)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `screening-${jobId}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            {/* Header */}
      <div className="sticky top-0 z-10" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link href="/recruiter/dashboard"
            className="p-2 rounded-xl no-underline transition-all shrink-0"
            style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              Screening IA
            </p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {jobTitle}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {sorted.length > 0 && (
              <button onClick={downloadCSV}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            )}
            <button onClick={runScreening} disabled={selected.size === 0 || isPending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
              {isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyse…</>
                : <><Brain className="h-4 w-4" /> Analyser {selected.size} CV</>}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">

        {/* Criteria */}
        <CriteriaPanel criteria={criteria} onChange={setCriteria} />

        {/* Candidate list (pre-run) */}
        {!done && (
          <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
            <div className="flex items-center justify-between px-5 py-3 gap-3 flex-wrap"
              style={{ background: 'rgba(11,29,81,0.02)', borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {applications.length} candidature{applications.length > 1 ? 's' : ''}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  · {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {applications.length > 5 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    <input value={appSearch} onChange={e => setAppSearch(e.target.value)}
                      placeholder="Rechercher un candidat…"
                      className="text-xs w-40 focus:outline-none"
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-text)' }} />
                  </div>
                )}
                <button onClick={toggleAll}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all shrink-0"
                  style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                  {selected.size === applications.length ? 'Tout désélect.' : 'Tout sélect.'}
                </button>
              </div>
            </div>

            {applications.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune candidature pour cette offre.</p>
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun candidat ne correspond à cette recherche.</p>
              </div>
            ) : (
              pagedApps.map(app => {
                const isSelected = selected.has(app.applicationId)
                return (
                  <div key={app.applicationId}
                    className="flex items-center gap-4 px-5 py-3.5 transition-all cursor-pointer hover:bg-[rgba(11,29,81,0.02)]"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                    onClick={() => toggleApp(app.applicationId)}>
                    {/* Checkbox */}
                    <div className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                      style={{
                        borderColor: isSelected ? '#7c3aed' : 'var(--color-border)',
                        background: isSelected ? '#7c3aed' : 'transparent',
                      }}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>

                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}>
                      {app.candidateName.slice(0, 2).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        {app.candidateName}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {app.candidateEmail || 'Email non disponible'}
                      </p>
                    </div>

                    {/* Right */}
                    <div className="flex items-center gap-2 shrink-0">
                      {app.existingScore !== undefined && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: 'rgba(124,58,237,0.14)', color: '#7c3aed' }}>
                          Déjà scoré: {app.existingScore}
                        </span>
                      )}
                      {!app.cvFileId && (
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                          Sans CV
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                        {new Date(app.appliedAt).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
        {!done && appTotalPages > 1 && (
          <Pagination page={appPage} totalPages={appTotalPages} onChange={setAppPage} accentColor="#7c3aed" />
        )}

        {/* Loading */}
        {isPending && (
          <div className="text-center py-16 space-y-4">
            <div className="relative w-16 h-16 mx-auto">
              <div className="w-16 h-16 rounded-full border-2 animate-spin"
                style={{ borderColor: 'rgba(124,58,237,0.15)', borderTopColor: '#7c3aed' }} />
              <Brain className="h-6 w-6 absolute inset-0 m-auto" style={{ color: '#7c3aed' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Analyse IA en cours…
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {selected.size} CV analysé{selected.size > 1 ? 's' : ''} contre les critères du poste
            </p>
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="p-4 rounded-xl space-y-1"
            style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            {errors.map((e, i) => <p key={i} className="text-sm" style={{ color: '#ef4444' }}>{e}</p>)}
          </div>
        )}

        {/* Results */}
        {sorted.length > 0 && (
          <>
            {/* Stats — click to filter */}
            <div className="grid grid-cols-5 gap-2">
              {(['top', 'good', 'average', 'weak', 'reject'] as const).map(r => {
                const count = sorted.filter(s => s.recommendation === r).length
                const info = RECO[r]
                const active = recoFilter === r
                return (
                  <button key={r} onClick={() => setRecoFilter(active ? null : r)}
                    className="text-center p-3 rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                    style={{
                      background: info.darkBg,
                      boxShadow: active ? `0 8px 20px -4px ${info.color}90` : '0 6px 16px -6px rgba(0,0,0,0.4)',
                      outline: active ? `2px solid ${info.color}` : 'none',
                      outlineOffset: -2,
                    }}>
                    <p className="text-lg font-bold" style={{ color: info.color }}>{count}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>{info.label}</p>
                  </button>
                )
              })}
            </div>

            {/* Avg score + search */}
            <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl flex-wrap"
              style={{ background: 'var(--color-surface)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 8px 24px -6px rgba(124,58,237,0.25)' }}>
              <Target className="h-4 w-4" style={{ color: '#7c3aed' }} />
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Score moyen :</span>
              <span className="text-base font-bold" style={{ color: '#7c3aed' }}>
                {Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length)}
              </span>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>/100</span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {sorted.length} candidat{sorted.length > 1 ? 's' : ''} analysé{sorted.length > 1 ? 's' : ''}
              </span>
              <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
                <Search className="h-3.5 w-3.5 shrink-0" style={{ color: '#7c3aed' }} />
                <input value={resultSearch} onChange={e => setResultSearch(e.target.value)}
                  placeholder="Rechercher un résultat…"
                  className="text-xs w-44 focus:outline-none"
                  style={{ background: 'transparent', border: 'none', color: 'var(--color-text)' }} />
              </div>
              {recoFilter && (
                <button onClick={() => setRecoFilter(null)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-all"
                  style={{ background: RECO[recoFilter].bg, color: RECO[recoFilter].color }}>
                  <X className="h-3 w-3 inline mr-1" />{RECO[recoFilter].label}
                </button>
              )}
            </div>

            {filteredResults.length === 0 ? (
              <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
                <p className="text-sm">Aucun résultat ne correspond à cette recherche.</p>
              </div>
            ) : (
              <>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {(resultPage - 1) * PAGE_SIZE + 1}–{Math.min(resultPage * PAGE_SIZE, filteredResults.length)} sur {filteredResults.length} résultat{filteredResults.length > 1 ? 's' : ''}
                </p>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1 py-1 rounded-3xl"
                  style={{ scrollbarWidth: 'thin' }}>
                  {pagedResults.map(r => (
                    <ResultCard
                      key={r.applicationId}
                      result={r}
                      jobId={jobId}
                      jobDescription={jobDescription}
                      jobSkills={jobSkills}
                    />
                  ))}
                </div>
                <Pagination page={resultPage} totalPages={resultTotalPages} onChange={setResultPage} accentColor="#7c3aed" />
              </>
            )}
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
