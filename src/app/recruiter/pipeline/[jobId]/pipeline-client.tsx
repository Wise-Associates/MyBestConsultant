'use client'

import { useMemo, useRef, useState, useTransition, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  ArrowLeft, FileText, ArrowDownWideNarrow, ArrowUpWideNarrow, Settings2, Plus, X,
  Brain, Video, Pencil, Trash2, History, Loader2, GripVertical, Tag as TagIcon,
  StickyNote, CheckCircle2, ChevronDown, ChevronUp, Sparkles, AlertCircle,
  Archive, ThumbsUp, ThumbsDown, Mail, Copy, ExternalLink, Edit3, Send, ChevronRight, GitBranch,
} from 'lucide-react'
import {
  moveApplicationStage, saveFunnelStagesAction, updateApplicationCardAction,
  deleteApplicationAction, launchScreeningAction, prepareInterviewAction, sendInterviewInviteAction,
  cancelInterviewAction, renameInterviewAction, getEventsAction, setApplicationStageStatusAction,
} from './actions'
import { sendCandidateEmailAction, setEmailRepliedAction } from './email-actions'
import { WhatsAppContact, WhatsAppIcon } from '@/components/recruiter/whatsapp-contact'
import type { PipelineEmail } from '@/lib/appwrite/application-emails'
import type { InterviewQuestion } from '@/app/recruiter/interviews/actions'
import { InterviewDetailModal } from '@/app/admin/interviews/interview-detail-modal'
import { getInterviewDetailForRecruiter, analyzeInterviewForRecruiter } from './interview-detail-actions'
import type { FunnelStage, FunnelEvent } from '@/types'
import { withOrphanStages } from '@/lib/funnel-stage-utils'
import { FunnelModal } from './funnel-modal'
import { progress as funnelProgress, STEP_TYPES, currentIndex as funnelCurrent, type FunnelStep } from '@/lib/candidate-funnel'

export interface PipelineInterview {
  id: string
  title?: string
  status: string
  score?: number
  recommendation?: string
  summary?: string
  createdAt: string
  completedAt?: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  questionCount: number
  transcriptLength: number
}

export interface PipelineCandidate {
  appId: string
  candidateName: string
  candidateEmail: string
  photoUrl?: string
  /** WhatsApp joignable : celui du candidat (opt-in), ou du chasseur qui le propose. */
  whatsapp?: string
  /** true = numéro WhatsApp confirmé par le candidat ; false = simple numéro de téléphone. */
  whatsappConfirmed?: boolean
  /** Renseigné pour un profil proposé par un chasseur de têtes. */
  hunterName?: string
  cvFileId?: string
  status: string
  /** Statut à l'intérieur de la phase (ex. « Planifié »). */
  stageStatus?: string
  /** Funnel du candidat : ses étapes et leur avancement. */
  funnel?: FunnelStep[]
  aiScore?: number
  aiSummary?: string
  aiRecommendation?: string
  interviews: PipelineInterview[]
  tags: string[]
  note: string
  createdAt: string
}

const INTERVIEW_COLOR: Record<string, string> = {
  pending: '#f59e0b', in_progress: '#3b82f6', completed: '#8b5cf6', analysed: '#10b981',
}

const RECO_LABEL: Record<string, { label: string; color: string }> = {
  top: { label: 'Top profil', color: '#10b981' },
  good: { label: 'Bon profil', color: '#3b82f6' },
  average: { label: 'Profil moyen', color: '#f59e0b' },
  weak: { label: 'Profil faible', color: '#e8a33d' },
  reject: { label: 'À rejeter', color: '#ef4444' },
  hire: { label: 'Recommandé', color: '#10b981' },
  consider: { label: 'À considérer', color: '#f59e0b' },
}

const AUTO_ACTION_LABEL: Record<string, string> = {
  screening: 'Screening', interview: 'Entretien',
}

// Funnels created before "action suggérée" existed have no autoAction saved on their
// stage documents — fall back to the well-known default slugs so drag & drop into
// "Screening IA"/"Entretien" works immediately without the recruiter having to open
// "Étapes" and set it manually first.
function getStageAutoAction(stage: FunnelStage | undefined): FunnelStage['autoAction'] {
  if (!stage) return undefined
  if (stage.autoAction) return stage.autoAction
  if (stage.slug === 'screening') return 'screening'
  if (stage.slug === 'interview') return 'interview'
  return undefined
}

// A card can't be dragged backward past a step it has actually completed — once screened,
// it can no longer sit in the pre-screening column; once an interview was sent, it can no
// longer sit in the pre-interview column. Manual decisions (Accepter/Refuser/Vivier) go
// through onQuickMove instead, which bypasses this gate — those are always allowed.
function minAllowedOrder(candidate: PipelineCandidate, stages: FunnelStage[]): number {
  const interviewStage = stages.find(s => getStageAutoAction(s) === 'interview')
  const screeningStage = stages.find(s => getStageAutoAction(s) === 'screening')
  if (candidate.interviews.length > 0 && interviewStage) return interviewStage.order
  if (candidate.aiScore !== undefined && screeningStage) return screeningStage.order
  return 0
}

const INTERVIEW_STATUS_LABEL: Record<string, string> = {
  pending: 'Invitation envoyée — en attente que le candidat passe l\'entretien',
  in_progress: 'Le candidat est en train de passer l\'entretien',
  completed: 'Entretien terminé — analyse IA en cours…',
  analysed: 'Entretien terminé',
}

function scoreColor(s: number) {
  return s >= 85 ? '#10b981' : s >= 70 ? '#3b82f6' : s >= 55 ? '#f59e0b' : '#ef4444'
}

function slugify(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `stage_${Date.now()}`
}

const EVENT_LABEL: Record<string, string> = {
  stage_change: 'Étape changée', screening: 'Screening IA lancé', interview: 'Entretien lancé',
}

function Initials({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold mt-0.5"
      style={{ background: 'rgba(249,115,22,0.14)', color: '#F97316' }}
    >
      {initials}
    </span>
  )
}

// Interview name with inline rename (pencil → input → Enter/blur saves) — e.g. "Entretien
// test technique" instead of the default "Entretien #1".
function InterviewTitle({ interview, fallback, onRenamed }: {
  interview: PipelineInterview; fallback: string; onRenamed: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(interview.title ?? '')
  const [saving, startSaving] = useTransition()

  function save() {
    const next = value.trim()
    setEditing(false)
    if (next === (interview.title ?? '')) return
    startSaving(async () => {
      const res = await renameInterviewAction(interview.id, next)
      if (!res.error) onRenamed(next)
    })
  }

  if (editing) {
    return (
      <input autoFocus value={value} maxLength={120} placeholder={fallback}
        onChange={e => setValue(e.target.value)} onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(interview.title ?? ''); setEditing(false) } }}
        className="text-[11px] font-bold px-1.5 py-0.5 rounded outline-none min-w-0 flex-1"
        style={{ background: 'var(--color-background)', border: '1px solid var(--color-primary)', color: 'var(--color-text)' }} />
    )
  }
  return (
    <button onClick={() => setEditing(true)} title="Renommer l'entretien" disabled={saving}
      className="group flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide max-w-full"
      style={{ color: 'var(--color-text-muted)' }}>
      <span className="truncate">{interview.title || fallback}</span>
      {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Pencil className="h-2.5 w-2.5 opacity-40 group-hover:opacity-100" />}
    </button>
  )
}

// Covers the whole card while a server action is running on it (screening can take minutes):
// nothing underneath is clickable, and the recruiter sees exactly what's happening.
function CardLoader({ label, color }: { label: string; color: string }) {
  return (
    <div className="absolute inset-0 z-10 rounded-2xl flex flex-col items-center justify-center gap-3 overflow-hidden"
      role="status" aria-live="polite"
      style={{ background: 'rgba(255,255,255,0.86)', backdropFilter: 'blur(3px)', animation: 'mbc-fade-in 0.2s ease-out' }}>
      <div className="relative w-12 h-12 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full"
          style={{ background: `conic-gradient(from 0deg, transparent 0%, ${color} 100%)`, animation: 'mbc-ring 1s linear infinite',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))' }} />
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${color}1f`, boxShadow: `0 0 18px ${color}55` }}>
          <Sparkles className="h-4 w-4" style={{ color }} />
        </div>
      </div>
      <p className="text-[12px] font-bold flex items-center gap-1" style={{ color: 'var(--color-text)' }}>
        {label}
        <span className="flex gap-0.5">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-1 h-1 rounded-full" style={{ background: color, animation: `mbc-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </span>
      </p>
      <div className="w-24 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.08)' }}>
        <div className="h-full w-1/3 rounded-full" style={{ background: color, animation: 'mbc-sweep 1.3s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

function CandidateCard({
  candidate, jobId, jobTitle, stages, stageColor, suggestedAction, autoOpenInterview, onAutoOpened, interviewTargetStage,
  busyLabel, onRunScreening, onInterviewSent, onRenameInterview, onEmailSent, onQuickMove,
  onDragStart, onOpenEdit, onOpenHistory, onDelete, onOpenProcess,
}: {
  candidate: PipelineCandidate
  jobId: string
  jobTitle: string
  stages: FunnelStage[]
  stageColor: string
  suggestedAction?: 'screening' | 'interview'
  autoOpenInterview?: boolean
  onAutoOpened: () => void
  interviewTargetStage: string
  busyLabel?: string
  onRunScreening: (appId: string) => void
  onInterviewSent: (appId: string, targetStage: string, info: SentInterviewInfo) => void
  onRenameInterview: (appId: string, interviewId: string, title: string) => void
  onEmailSent: (email: PipelineEmail) => void
  onQuickMove: (appId: string, stageSlug: string) => void
  onDragStart: (appId: string) => void
  onOpenEdit: () => void
  onOpenHistory: () => void
  onDelete: () => void
  onOpenProcess: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [interviewModalOpen, setInterviewModalOpen] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [viewingInterviewId, setViewingInterviewId] = useState<string | null>(null)

  // Dropping the card into a stage configured with "Suggérer : Entretien" opens the module
  // straight away instead of leaving a suggestion pill to notice — still requires an
  // explicit click inside the modal to actually send anything to the candidate.
  useEffect(() => {
    if (autoOpenInterview) {
      setInterviewModalOpen(true)
      onAutoOpened()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenInterview])

  const hasResults = candidate.aiSummary || candidate.interviews.length > 0
  const screeningDone = candidate.aiScore !== undefined
  const latestInterview = candidate.interviews[0]
  const interviewInProgress = candidate.interviews.some(i => i.status === 'pending' || i.status === 'in_progress' || i.status === 'completed')

  function runScreening() {
    if (screeningDone || busyLabel) return
    onRunScreening(candidate.appId)
  }

  const interviewsPending = candidate.interviews.filter(i => i.status === 'pending').length
  const interviewsInProgress = candidate.interviews.filter(i => i.status === 'in_progress').length
  const interviewsDone = candidate.interviews.filter(i => i.status === 'completed' || i.status === 'analysed').length

  const interviewBadgeColor = INTERVIEW_COLOR[latestInterview?.status ?? ''] ?? '#3b82f6'
  const sortedStages = [...stages].sort((a, b) => a.order - b.order)
  const currentStage = stages.find(s => s.slug === candidate.status)
  const currentStageOrder = currentStage?.order ?? 0
  const phaseStatuses = currentStage?.statuses ?? []
  const [subStatus, setSubStatus] = useState(candidate.stageStatus ?? '')
  const [statusSaving, startStatusSave] = useTransition()
  useEffect(() => { setSubStatus(candidate.stageStatus ?? '') }, [candidate.stageStatus, candidate.status])
  function changeSubStatus(value: string) {
    const previous = subStatus
    setSubStatus(value)
    startStatusSave(async () => {
      const res = await setApplicationStageStatusAction(candidate.appId, jobId, value)
      if (res.error) setSubStatus(previous)
    })
  }

  return (
    <div
      draggable={!busyLabel}
      onDragStart={() => onDragStart(candidate.appId)}
      aria-busy={!!busyLabel}
      className={`mbc-pipe-card relative mb-2.5 rounded-2xl p-3.5 ${busyLabel ? '' : 'cursor-grab active:cursor-grabbing'}`}
      style={{
        background: 'var(--color-surface)', border: `1px solid var(--color-border)`,
        borderLeft: `4px solid ${stageColor}`, boxShadow: '0 1px 2px rgba(11,29,81,0.04), 0 8px 20px -6px rgba(11,29,81,0.08)',
      }}>
      {busyLabel && <CardLoader label={busyLabel} color={stageColor} />}
      <div className="flex items-start gap-2">
        <Initials name={candidate.candidateName || candidate.candidateEmail} />
        <div className="min-w-0 flex-1">
          <Link href={`/recruiter/candidates/${candidate.appId}`}
            className="text-[13.5px] font-semibold no-underline hover:underline block truncate" style={{ color: 'var(--color-text)' }}>
            {candidate.candidateName || candidate.candidateEmail}
          </Link>
          {candidate.hunterName
            ? <p className="text-[11px] truncate font-semibold" style={{ color: '#7c3aed' }} title="Profil proposé par un chasseur de têtes">🎯 Chasseur · {candidate.hunterName}</p>
            : <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{candidate.candidateEmail}</p>}
        </div>
        <GripVertical className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
      </div>

      {/* Progression sur le funnel — une barre segmentée, un segment par étape, colorée
          jusqu'à l'étape actuelle de la carte. */}
      {candidate.funnel && candidate.funnel.length > 0 ? (
        <div className="mt-2.5">
          <div className="flex items-center gap-1">
            {candidate.funnel.map((st, i) => {
              const done = st.status === 'validated' || st.status === 'skipped'
              const isCur = i === funnelCurrent(candidate.funnel!)
              const c = STEP_TYPES[st.type].color
              return <div key={st.id} title={st.label} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: done ? c : isCur ? `${c}88` : 'rgba(0,0,0,0.08)' }} />
            })}
          </div>
          <p className="text-[10.5px] font-semibold mt-1 truncate" style={{ color: 'var(--color-text-muted)' }}>{funnelProgress(candidate.funnel).current ? `Étape ${funnelCurrent(candidate.funnel) + 1}/${candidate.funnel.length} · ${funnelProgress(candidate.funnel).current!.label}` : 'Parcours terminé'}</p>
        </div>
      ) : sortedStages.length > 1 && (
        <div className="flex items-center gap-1 mt-2.5" title={`Étape : ${sortedStages.find(s => s.order === currentStageOrder)?.label ?? ''}`}>
          {sortedStages.map(s => (
            <div key={s.slug} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: s.order <= currentStageOrder ? s.color : 'rgba(0,0,0,0.08)' }} />
          ))}
        </div>
      )}

      {/* Status chips — every launched functionality is a colored pill, visible at a glance */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {candidate.aiScore !== undefined ? (
          <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full"
            style={{ background: `${scoreColor(candidate.aiScore)}16`, color: scoreColor(candidate.aiScore) }}>
            <Brain className="h-2.5 w-2.5" /> {candidate.aiScore}/100
          </span>
        ) : (
          <span className="text-[10px] font-medium px-2 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-muted)' }}>
            Pas encore screené
          </span>
        )}
        {candidate.interviews.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: `${interviewBadgeColor}16`, color: interviewBadgeColor }}>
            <Video className="h-2.5 w-2.5" />
            {latestInterview.status === 'analysed' ? 'Entretien ✓' : latestInterview.status === 'completed' ? 'Analyse…' : 'Entretien…'}
            {candidate.interviews.length > 1 ? ` ×${candidate.interviews.length}` : ''}
          </span>
        )}
        {candidate.cvFileId && (
          <a href={`/api/cv/${candidate.cvFileId}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full no-underline transition-opacity hover:opacity-75"
            style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-muted)' }}>
            <FileText className="h-2.5 w-2.5" /> CV
          </a>
        )}
        <button type="button" onClick={e => { e.stopPropagation(); onOpenProcess() }} title="Funnel de recrutement du candidat : étapes, comptes rendus, personnalisation"
          className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full transition-opacity hover:opacity-80" style={{ background: `${stageColor}16`, color: stageColor }}>
          <GitBranch className="h-2.5 w-2.5" /> Funnel{candidate.funnel ? ` ${funnelProgress(candidate.funnel).done}/${candidate.funnel.length}` : ''}
        </button>
        {/* Contact direct WhatsApp — toujours visible ; grisé quand aucun numéro n'est renseigné */}
        {candidate.whatsapp ? (
          <WhatsAppContact size="chip" name={candidate.candidateName} number={candidate.whatsapp} jobTitle={jobTitle} applicationId={candidate.appId}
            hunter={!!candidate.hunterName} unconfirmed={!candidate.whatsappConfirmed && !candidate.hunterName} />
        ) : (
          <span title="Aucun numéro renseigné pour ce candidat" className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full cursor-not-allowed"
            style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--color-text-muted)', opacity: 0.6 }}>
            <WhatsAppIcon className="h-3.5 w-3.5" /> WhatsApp
          </span>
        )}
      </div>

      {phaseStatuses.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5" onMouseDown={e => e.stopPropagation()}>
          <select value={phaseStatuses.includes(subStatus) ? subStatus : ''} onChange={e => changeSubStatus(e.target.value)} aria-label="Statut dans la phase" disabled={statusSaving || !!busyLabel}
            className="text-[11px] font-semibold px-2 py-1 rounded-full outline-none max-w-full cursor-pointer"
            style={subStatus && phaseStatuses.includes(subStatus)
              ? { background: `${stageColor}18`, color: stageColor, border: `1px solid ${stageColor}55` }
              : { background: 'transparent', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }}>
            <option value="">Statut…</option>
            {phaseStatuses.map(st => <option key={st} value={st}>{st}</option>)}
          </select>
          {statusSaving && <Loader2 className="h-3 w-3 animate-spin" style={{ color: 'var(--color-text-muted)' }} />}
        </div>
      )}

      {candidate.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {candidate.tags.map(t => (
            <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(232,163,61,0.12)', color: '#b8862f' }}>{t}</span>
          ))}
        </div>
      )}
      {candidate.note && (
        <p className="flex items-start gap-1 text-[11px] mt-2 leading-snug" style={{ color: 'var(--color-text-muted)' }}>
          <StickyNote className="h-3 w-3 mt-0.5 shrink-0" /> {candidate.note}
        </p>
      )}

      {suggestedAction && !(suggestedAction === 'screening' && screeningDone) && (
        <button
          onClick={suggestedAction === 'screening' ? runScreening : () => setInterviewModalOpen(true)}
          disabled={suggestedAction === 'screening' && !!busyLabel}
          className="flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: 'rgba(232,163,61,0.12)', color: '#b8862f', border: '1px dashed rgba(232,163,61,0.4)' }}>
          <Sparkles className="h-3 w-3" /> Action suggérée : {AUTO_ACTION_LABEL[suggestedAction]}
        </button>
      )}

      {hasResults && (
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <button onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-text-muted)' }}>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Résultats
          </button>
          {candidate.interviews.length > 0 && (
            <>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-text)' }}>
                {candidate.interviews.length} entretien{candidate.interviews.length > 1 ? 's' : ''} envoyé{candidate.interviews.length > 1 ? 's' : ''}
              </span>
              {interviewsPending > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${INTERVIEW_COLOR.pending}1f`, color: INTERVIEW_COLOR.pending }}>
                  {interviewsPending} en attente
                </span>
              )}
              {interviewsInProgress > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${INTERVIEW_COLOR.in_progress}1f`, color: INTERVIEW_COLOR.in_progress }}>
                  {interviewsInProgress} en cours
                </span>
              )}
              {interviewsDone > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${INTERVIEW_COLOR.analysed}1f`, color: INTERVIEW_COLOR.analysed }}>
                  {interviewsDone} terminé{interviewsDone > 1 ? 's' : ''}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {expanded && hasResults && (
        <div className="mt-2 space-y-2">
          {candidate.aiSummary && (
            <div className="rounded-xl p-2.5" style={{ background: 'var(--color-surface)', boxShadow: '0 1px 2px rgba(11,29,81,0.04), 0 4px 10px -4px rgba(11,29,81,0.12)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-1.5">
                <Brain className="h-3 w-3" style={{ color: '#8b5cf6' }} />
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Screening</span>
                {candidate.aiRecommendation && RECO_LABEL[candidate.aiRecommendation] && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: `${RECO_LABEL[candidate.aiRecommendation].color}18`, color: RECO_LABEL[candidate.aiRecommendation].color }}>
                    {RECO_LABEL[candidate.aiRecommendation].label}
                  </span>
                )}
              </div>
              <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-text)' }}>{candidate.aiSummary}</p>
            </div>
          )}
          {candidate.interviews.map((iv, i) => {
            const isDone = iv.status === 'analysed' || iv.status === 'completed'
            const ivColor = INTERVIEW_COLOR[iv.status] ?? '#6b7280'
            return (
              <div key={i} className="rounded-xl p-2.5" style={{
                background: 'var(--color-surface)', borderLeft: `3px solid ${ivColor}`,
                boxShadow: '0 1px 2px rgba(11,29,81,0.04), 0 4px 10px -4px rgba(11,29,81,0.12)', border: '1px solid var(--color-border)',
              }}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Video className="h-3 w-3" style={{ color: ivColor }} />
                  <InterviewTitle
                    interview={iv}
                    fallback={`Entretien${candidate.interviews.length > 1 ? ` #${candidate.interviews.length - i}` : ''}`}
                    onRenamed={title => onRenameInterview(candidate.appId, iv.id, title)} />
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: `${ivColor}18`, color: ivColor }}>
                    {iv.status === 'analysed' ? 'Terminé' : iv.status === 'completed' ? 'Analyse…' : iv.status === 'in_progress' ? 'En cours' : 'En attente'}
                  </span>
                  {iv.recommendation && RECO_LABEL[iv.recommendation] && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${RECO_LABEL[iv.recommendation].color}18`, color: RECO_LABEL[iv.recommendation].color }}>
                      {RECO_LABEL[iv.recommendation].label}
                    </span>
                  )}
                  {iv.score != null && (
                    <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{iv.score}/100</span>
                  )}
                </div>
                {iv.summary ? (
                  <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-text)' }}>{iv.summary}</p>
                ) : (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {INTERVIEW_STATUS_LABEL[iv.status] ?? iv.status}
                  </p>
                )}
                {isDone && (
                  <button onClick={() => setViewingInterviewId(iv.id)}
                    className="flex items-center gap-1 mt-1.5 text-[10px] font-bold transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}>
                    <ExternalLink className="h-2.5 w-2.5" /> Voir l&apos;analyse, la transcription et les enregistrements
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-1 mt-2.5 flex-wrap">
        <button onClick={runScreening} disabled={!!busyLabel || screeningDone}
          title={screeningDone ? 'Screening déjà terminé' : 'Lancer un screening IA'}
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
          <Brain className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setInterviewModalOpen(true)} title={interviewInProgress ? 'Lancer un nouvel entretien IA' : 'Lancer un entretien IA'}
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
          <Video className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onQuickMove(candidate.appId, 'on_hold')} title="Mettre en vivier"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onQuickMove(candidate.appId, 'accepted')} title="Valider / accepter"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onQuickMove(candidate.appId, 'rejected')} title="Refuser"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setEmailModalOpen(true)} title="Envoyer un email personnalisé"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
          <Mail className="h-3.5 w-3.5" />
        </button>
        <button onClick={onOpenEdit} title="Modifier (étiquettes, note)"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onOpenHistory} title="Historique"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}>
          <History className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} title="Supprimer la candidature"
          className="p-1.5 rounded-lg transition-opacity hover:opacity-70 ml-auto"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {interviewModalOpen && createPortal(
        <InterviewModal jobId={jobId} candidate={candidate} targetStage={interviewTargetStage}
          onClose={() => setInterviewModalOpen(false)}
          onSent={info => onInterviewSent(candidate.appId, interviewTargetStage, info)} />,
        document.body
      )}
      {emailModalOpen && createPortal(
        <EmailModal candidate={candidate} jobId={jobId} onSent={onEmailSent} onClose={() => setEmailModalOpen(false)} />,
        document.body
      )}
      {viewingInterviewId && (() => {
        const iv = candidate.interviews.find(x => x.id === viewingInterviewId)
        if (!iv) return null
        return createPortal(
          <InterviewDetailModal
            row={{
              id: iv.id, candidateName: iv.candidateName || candidate.candidateName, candidateEmail: iv.candidateEmail || candidate.candidateEmail,
              jobTitle: iv.jobTitle, status: iv.status as 'pending' | 'in_progress' | 'completed' | 'analysed',
              createdAt: iv.createdAt, completedAt: iv.completedAt,
              questionCount: iv.questionCount, transcriptLength: iv.transcriptLength,
            }}
            onClose={() => setViewingInterviewId(null)}
            getDetail={getInterviewDetailForRecruiter}
            onAnalyze={analyzeInterviewForRecruiter}
          />,
          document.body
        )
      })()}
    </div>
  )
}

// Same 3-step flow as the screening results page's interview module (generate → review &
// edit → explicit send): nothing is emailed to the candidate until the recruiter reviews
// the questions and clicks "Envoyer". Uses useEffect (not a side effect during render) so
// it fires exactly once per real open — a render-body side effect here previously caused
// screen flicker and duplicate interview sessions being created per click.
interface SentInterviewInfo {
  id: string; createdAt: string; candidateName: string; candidateEmail: string; jobTitle: string; questionCount: number; title?: string
}

function InterviewModal({ jobId, candidate, targetStage, onClose, onSent }: {
  jobId: string; candidate: PipelineCandidate; targetStage: string; onClose: () => void; onSent: (info: SentInterviewInfo) => void
}) {
  const [step, setStep] = useState<'generating' | 'review' | 'sent' | 'error'>('generating')
  const [error, setError] = useState('')
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [sessionId, setSessionId] = useState('')
  const [candidateInfo, setCandidateInfo] = useState<{ name: string; email: string; jobTitle: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isSending, startSending] = useTransition()
  const [sendError, setSendError] = useState('')
  const [title, setTitle] = useState('')

  const link = sessionId ? `${window.location.origin}/interview/${sessionId}?mode=video` : ''
  const validQuestions = questions.filter(q => q.text.trim().length > 0)

  useEffect(() => {
    let ignore = false
    setStep('generating')
    prepareInterviewAction(candidate.appId, jobId).then(res => {
      if (ignore) return
      if ('error' in res) { setError(res.error); setStep('error'); return }
      setQuestions(res.questions)
      setSessionId(res.sessionId)
      setCandidateInfo({ name: res.candidateName, email: res.candidateEmail, jobTitle: res.jobTitle })
      setStep('review')
    })
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.appId, jobId])

  // Closing before sending discards the prepared session — nothing should linger as a
  // phantom "entretien en cours" on the card if the recruiter changes their mind.
  function handleClose() {
    if (step === 'review' && sessionId) cancelInterviewAction(sessionId)
    onClose()
  }

  function copyLink() {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function sendInvite() {
    if (!candidateInfo) return
    setSendError('')
    startSending(async () => {
      const res = await sendInterviewInviteAction({
        applicationId: candidate.appId, jobId, sessionId, targetStage,
        candidateEmail: candidateInfo.email, candidateName: candidateInfo.name, jobTitle: candidateInfo.jobTitle,
        questions: validQuestions, title: title.trim() || undefined,
      })
      if (res.error) { setSendError(res.error); return }
      setStep('sent')
      onSent({
        id: sessionId, createdAt: new Date().toISOString(),
        candidateName: candidateInfo.name, candidateEmail: candidateInfo.email, jobTitle: candidateInfo.jobTitle,
        questionCount: validQuestions.length, title: title.trim() || undefined,
      })
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'generating') handleClose() }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden max-h-[85vh] flex flex-col" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2">
            <Video className="h-4 w-4" /> Entretien IA — {candidate.candidateName || candidate.candidateEmail}
          </h2>
          {step !== 'generating' && (
            <button onClick={handleClose} className="text-white/40 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
          )}
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {step === 'generating' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--color-primary)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Génération des questions…</p>
            </div>
          )}
          {step === 'error' && (
            <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>
          )}
          {step === 'review' && (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Titre de l&apos;entretien (facultatif)</label>
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
                  placeholder="Ex. Entretien test technique"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {validQuestions.length} question{validQuestions.length > 1 ? 's' : ''} — le candidat recevra exactement cette liste. Modifiez ou supprimez avant d&apos;envoyer.
              </p>
              <div className="space-y-1.5">
                {questions.map(q => (
                  <div key={q.id} className="rounded-xl p-2.5" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-start gap-2">
                      {editingId === q.id ? (
                        <textarea autoFocus defaultValue={q.text} rows={2}
                          className="flex-1 px-2 py-1.5 rounded-lg text-sm outline-none resize-none"
                          style={{ background: 'var(--color-background)', border: '1px solid var(--color-primary)', color: 'var(--color-text)' }}
                          onChange={e => setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, text: e.target.value } : x))}
                          onBlur={() => setEditingId(null)} />
                      ) : (
                        <p className="flex-1 text-sm leading-snug" style={{ color: 'var(--color-text)' }}>{q.text}</p>
                      )}
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditingId(q.id)} style={{ color: 'var(--color-text-muted)' }}><Edit3 className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setQuestions(prev => prev.filter(x => x.id !== q.id))} style={{ color: 'var(--color-text-muted)' }}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl p-3" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Lien de l&apos;entretien</p>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-xs font-mono truncate" style={{ color: '#8b5cf6' }}>{link}</p>
                  <button onClick={copyLink} className="p-1.5 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: '#10b981' }} /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {sendError && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{sendError}</p>}
            </>
          )}
          {step === 'sent' && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-8 w-8" style={{ color: '#10b981' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Invitation envoyée !</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>L&apos;email a été envoyé à {candidateInfo?.email}.</p>
            </div>
          )}
        </div>
        <div className="p-6 pt-0 shrink-0 flex gap-3">
          {step === 'review' ? (
            <>
              <button onClick={handleClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>Annuler</button>
              <button onClick={sendInvite} disabled={isSending || validQuestions.length === 0}
                className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: 'white' }}>
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer l&apos;invitation
              </button>
            </>
          ) : (
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)', color: 'white' }}>Fermer</button>
          )}
        </div>
      </div>
    </div>
  )
}

function EmailModal({ candidate, jobId, onSent, onClose }: { candidate: PipelineCandidate; jobId: string; onSent: (email: PipelineEmail) => void; onClose: () => void }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  function send() {
    setError('')
    if (!subject.trim() || !message.trim()) { setError('Objet et message requis'); return }
    startTransition(async () => {
      const res = await sendCandidateEmailAction({ applicationId: candidate.appId, jobId, subject, message })
      if (res.error || !res.email) setError(res.error ?? 'Erreur')
      else { onSent(res.email); setSent(true) }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email à {candidate.candidateName || candidate.candidateEmail}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>
        {sent ? (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 className="h-8 w-8 mx-auto" style={{ color: '#10b981' }} />
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>Email envoyé avec succès.</p>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)', color: 'white' }}>Fermer</button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Objet</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Message</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)', resize: 'vertical' }} />
            </div>
            {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>Annuler</button>
              <button onClick={send} disabled={isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)', color: 'white' }}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Envoyer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const DELIVERY_UI: Record<PipelineEmail['delivery'], { label: string; color: string }> = {
  sent: { label: 'Envoyé', color: '#10b981' },
  failed: { label: 'Échec d\'envoi', color: '#ef4444' },
  processing: { label: 'Envoi en cours', color: '#f59e0b' },
}

// Side column (not a funnel stage): one card per candidate who received a personalised
// email, showing delivery state and whether they answered — via the "Répondre" button in
// the email (tracked automatically) or marked by hand by the recruiter.
function EmailsColumn({ candidates, emails, onReplied }: {
  candidates: PipelineCandidate[]; emails: PipelineEmail[]; onReplied: (emailId: string, repliedAt: string | undefined) => void
}) {
  const byApp = new Map<string, PipelineEmail[]>()
  for (const e of emails) { if (!byApp.has(e.applicationId)) byApp.set(e.applicationId, []); byApp.get(e.applicationId)!.push(e) }
  const cards = candidates.filter(c => byApp.has(c.appId))
  const awaiting = emails.filter(e => !e.repliedAt).length

  return (
    <div className="shrink-0 snap-start rounded-2xl flex flex-col w-[86vw] sm:w-[300px] max-h-[calc(100vh-220px)]"
      style={{ background: '#F5F3EE', border: '1px solid rgba(0,0,0,0.05)' }}>
      <div className="flex items-center justify-between px-3.5 py-3 shrink-0">
        <span className="text-[13px] font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Mail className="h-3.5 w-3.5" style={{ color: '#3b82f6' }} />
          Emails envoyés
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--color-text-muted)' }}>{cards.length}</span>
        </span>
        {awaiting > 0 && <span className="text-[11px] font-semibold" style={{ color: '#f59e0b' }}>{awaiting} sans réponse</span>}
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5" style={{ minHeight: 140 }}>
        {cards.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>Aucun email envoyé</p>
        ) : cards.map(c => <EmailCard key={c.appId} candidate={c} emails={byApp.get(c.appId)!} onReplied={onReplied} />)}
      </div>
    </div>
  )
}

function EmailCard({ candidate, emails, onReplied }: {
  candidate: PipelineCandidate; emails: PipelineEmail[]; onReplied: (emailId: string, repliedAt: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const answered = emails.filter(e => e.repliedAt).length
  const failed = emails.some(e => e.delivery === 'failed')

  async function toggle(e: PipelineEmail) {
    setBusyId(e.id)
    const res = await setEmailRepliedAction(e.id, !e.repliedAt)
    setBusyId(null)
    if (!res.error) onReplied(e.id, res.repliedAt)
  }

  return (
    <div className="mb-2.5 rounded-2xl p-3.5" style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderLeft: `4px solid ${failed ? '#ef4444' : answered === emails.length ? '#10b981' : '#f59e0b'}`,
      boxShadow: '0 1px 2px rgba(11,29,81,0.04), 0 8px 20px -6px rgba(11,29,81,0.08)',
    }}>
      <div className="flex items-start gap-2">
        <Initials name={candidate.candidateName || candidate.candidateEmail} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>{candidate.candidateName || candidate.candidateEmail}</p>
          <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{emails[0].subject}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-text)' }}>
          {emails.length} email{emails.length > 1 ? 's' : ''}
        </span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={answered > 0 ? { background: 'rgba(16,185,129,0.14)', color: '#10b981' } : { background: 'rgba(245,158,11,0.14)', color: '#f59e0b' }}>
          {answered > 0 ? `${answered} réponse${answered > 1 ? 's' : ''}` : 'En attente de réponse'}
        </span>
        {failed && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.14)', color: '#ef4444' }}>Échec d&apos;envoi</span>}
      </div>
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 mt-2.5 text-[11px] font-semibold transition-opacity hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Échanges
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {emails.map(e => (
            <div key={e.id} className="rounded-xl p-2.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 10px -4px rgba(11,29,81,0.12)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold truncate max-w-full" style={{ color: 'var(--color-text)' }}>{e.subject}</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: `${DELIVERY_UI[e.delivery].color}18`, color: DELIVERY_UI[e.delivery].color }}>
                  {DELIVERY_UI[e.delivery].label}
                </span>
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {new Date(e.sentAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="text-[11px] mt-1.5 leading-snug whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{e.message}</p>
              {e.reply && (
                <div className="mt-2 rounded-lg p-2" style={{ background: 'rgba(16,185,129,0.08)', borderLeft: '3px solid #10b981' }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide mb-0.5" style={{ color: '#059669' }}>Réponse du candidat</p>
                  <p className="text-[11px] leading-snug whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{e.reply}</p>
                </div>
              )}
              {!e.reply && (
                <button onClick={() => toggle(e)} disabled={busyId === e.id}
                  className="flex items-center gap-1 mt-2 text-[10px] font-bold transition-opacity hover:opacity-70 disabled:opacity-50"
                  style={{ color: e.repliedAt ? '#059669' : 'var(--color-primary)' }}>
                  {busyId === e.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
                  {e.repliedAt ? 'Marqué comme répondu — annuler' : 'Marquer comme répondu'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PipelineClient({
  jobId, jobTitle, initialCandidates, initialStages, initialEmails, pipeline = null,
}: { jobId: string; tenantId: string; jobTitle: string; initialCandidates: PipelineCandidate[]; initialStages: FunnelStage[]; initialEmails: PipelineEmail[]; pipeline?: { id: string; name: string } | null }) {
  const [candidates, setCandidates] = useState(initialCandidates)
  const [emails, setEmails] = useState(initialEmails)
  const [stages, setStages] = useState(initialStages)
  const [minScore, setMinScore] = useState(0)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [processFor, setProcessFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)

  const [globalError, setGlobalError] = useState<string | null>(null)
  const [autoOpenInterviewFor, setAutoOpenInterviewFor] = useState<string | null>(null)

  function handleMoved(appId: string, status: string) {
    setCandidates(cs => cs.map(c => (c.appId === appId ? { ...c, status, stageStatus: undefined } : c)))
  }

  // Le funnel d'un candidat a changé (étapes validées, personnalisation) : la carte le reflète, et les colonnes créées par le funnel apparaissent.
  function handleFunnelChange(appId: string, steps: FunnelStep[], nextStages?: FunnelStage[]) {
    setCandidates(cs => cs.map(c => (c.appId === appId ? { ...c, funnel: steps } : c)))
    if (nextStages) setStages(withOrphans(nextStages))
  }

  // La candidature suit son funnel : elle passe dans la colonne de l'étape suivante (screening / entretien IA : la fenêtre correspondante s'ouvre).
  function moveFromFunnel(appId: string, column: string, autoAction?: string) {
    if (autoAction === 'interview') { setAutoOpenInterviewFor(appId); return }
    moveCard(appId, column)
  }

  // Après une modification des phases : une candidature dont la phase a disparu garde sa colonne (elle ne doit jamais « disparaître »).
  function withOrphans(list: FunnelStage[]): FunnelStage[] {
    return withOrphanStages(list, candidates.map(c => c.status)).map(x =>
      list.find(l => l.slug === x.slug) ?? { $id: `orphan-${x.slug}`, tenantId: list[0]?.tenantId ?? '', slug: x.slug, label: x.label, color: x.color, order: x.order })
  }

  // Cards with a server action in flight — the card shows a loader and can't be touched
  // (dragged, clicked, deleted) until the action settles.
  const [busy, setBusy] = useState<Record<string, string>>({})
  function setCardBusy(appId: string, label: string | null) {
    setBusy(b => {
      const next = { ...b }
      if (label) next[appId] = label
      else delete next[appId]
      return next
    })
  }

  function triggerScreening(appId: string, toStage?: string) {
    // Colonne de destination : la phase « screening » de ce pipeline (jamais un identifiant écrit en dur).
    const target = toStage ?? stages.find(s => getStageAutoAction(s) === 'screening')?.slug
    setCardBusy(appId, 'Screening IA en cours')
    launchScreeningAction(appId, jobId, target).then(res => {
      if (res.error) { setGlobalError(res.error); setTimeout(() => setGlobalError(null), 5000); return }
      handleScreeningDone(appId, res.score!, res.recommendation, res.summary, target)
    }).finally(() => setCardBusy(appId, null))
  }

  // Shared by drag-and-drop and the card's quick-action buttons (Vivier/Accepter/Refuser) —
  // optimistic update with rollback if the server call fails. If the target stage has a
  // suggested action configured, drop it straight into that action instead of leaving the
  // recruiter to notice and click a separate suggestion pill.
  function moveCard(appId: string, stageSlug: string) {
    const autoAction = getStageAutoAction(stages.find(s => s.slug === stageSlug))

    // Interview: never move the card just because it was dropped here — the card only
    // really belongs in this stage once the invite is actually sent (handleInterviewSent
    // does the real move then). Opening the modal without moving means a cancel simply
    // leaves the card exactly where it was, nothing to roll back.
    if (autoAction === 'interview') {
      setAutoOpenInterviewFor(appId)
      return
    }

    const previousStatus = candidates.find(c => c.appId === appId)?.status
    const candidate = candidates.find(c => c.appId === appId)
    handleMoved(appId, stageSlug)

    const screeningFollows = autoAction === 'screening' && candidate?.aiScore === undefined
    // When a screening follows, its loader takes over the card (and clears itself) — the
    // plain move only shows its own loader when nothing longer is about to run.
    if (!screeningFollows) setCardBusy(appId, 'Déplacement en cours')
    moveApplicationStage(appId, jobId, stageSlug).then(res => {
      if (res.error) {
        setGlobalError(res.error)
        if (previousStatus) handleMoved(appId, previousStatus)
        setTimeout(() => setGlobalError(null), 5000)
      }
    }).finally(() => { if (!screeningFollows) setCardBusy(appId, null) })

    if (screeningFollows) triggerScreening(appId, stageSlug)
  }

  function handleDrop(stageSlug: string) {
    setDragOverStage(null)
    if (!dragging) return
    const appId = dragging
    setDragging(null)

    if (busy[appId]) return
    const candidate = candidates.find(c => c.appId === appId)
    const targetStage = stages.find(s => s.slug === stageSlug)
    if (candidate && targetStage && targetStage.order < minAllowedOrder(candidate, stages)) {
      setGlobalError('Cette candidature a déjà dépassé cette étape — impossible de revenir en arrière.')
      setTimeout(() => setGlobalError(null), 4000)
      return
    }

    moveCard(appId, stageSlug)
  }

  function handleScreeningDone(appId: string, score: number, recommendation?: string, summary?: string, stageSlug?: string) {
    setCandidates(cs => cs.map(c => c.appId === appId
      ? { ...c, status: stageSlug && stages.some(s => s.slug === stageSlug) ? stageSlug : c.status, aiScore: score, aiRecommendation: recommendation ?? c.aiRecommendation, aiSummary: summary ?? c.aiSummary }
      : c))
  }

  // Fires only once the invite is actually sent (never on prepare/cancel) — this is the
  // single moment the card both gains its interview entry and moves into the target stage.
  function handleInterviewSent(appId: string, targetStage: string, info: SentInterviewInfo) {
    setCandidates(cs => cs.map(c => c.appId === appId
      ? {
          ...c, status: targetStage,
          interviews: [{ id: info.id, title: info.title, status: 'pending', createdAt: info.createdAt, candidateName: info.candidateName, candidateEmail: info.candidateEmail, jobTitle: info.jobTitle, questionCount: info.questionCount, transcriptLength: 0 }, ...c.interviews],
        }
      : c))
  }

  function handleEmailSent(email: PipelineEmail) {
    setEmails(es => [email, ...es])
  }

  function handleEmailReplied(emailId: string, repliedAt: string | undefined) {
    setEmails(es => es.map(e => e.id === emailId ? { ...e, repliedAt } : e))
  }

  function handleRenameInterview(appId: string, interviewId: string, title: string) {
    setCandidates(cs => cs.map(c => c.appId === appId
      ? { ...c, interviews: c.interviews.map(iv => iv.id === interviewId ? { ...iv, title: title || undefined } : iv) }
      : c))
  }

  const processCandidate = processFor ? candidates.find(c => c.appId === processFor) ?? null : null
  const interviewTargetStage = stages.find(s => getStageAutoAction(s) === 'interview')?.slug ?? 'interview'

  function handleDelete(appId: string) {
    if (!window.confirm('Supprimer définitivement cette candidature du pipeline ?')) return
    setCardBusy(appId, 'Suppression en cours')
    deleteApplicationAction(appId, jobId).then(res => {
      if (res.error) {
        setGlobalError(res.error)
        setTimeout(() => setGlobalError(null), 5000)
        return
      }
      setCandidates(cs => cs.filter(c => c.appId !== appId))
    }).finally(() => setCardBusy(appId, null))
  }

  const byStage = useMemo(() => {
    const map = new Map<string, PipelineCandidate[]>()
    for (const stage of stages) map.set(stage.slug, [])
    for (const c of candidates) {
      if (c.aiScore !== undefined && c.aiScore < minScore) continue
      if (!map.has(c.status)) map.set(c.status, []) // unknown/legacy status → its own column
      map.get(c.status)!.push(c)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const av = a.aiScore ?? -1
        const bv = b.aiScore ?? -1
        return sortDir === 'desc' ? bv - av : av - bv
      })
    }
    return map
  }, [candidates, minScore, sortDir, stages])

  // Stats bar — total counts per stage, always unfiltered (independent of the score slider
  // above, which only affects which cards are visible in the columns).
  const sortedStagesForStats = [...stages].sort((a, b) => a.order - b.order)
  const stageStats = sortedStagesForStats.map(stage => ({
    stage, count: candidates.filter(c => c.status === stage.slug).length,
  }))

  const editingCandidate = candidates.find(c => c.appId === editingId)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-3 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour au dashboard
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Pipeline de recrutement
              </p>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.5rem' }}>{jobTitle}</h1>
              <Link href={`/recruiter/funnel?tab=phases${pipeline ? `&pipeline=${pipeline.id}` : ''}`} className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] font-semibold no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Colonnes : <span style={{ color: '#E8A33D' }}>{pipeline?.name ?? 'Pipeline par défaut'}</span> · gérer
              </Link>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Score min.
                <input type="range" min={0} max={100} step={5} value={minScore}
                  onChange={e => setMinScore(Number(e.target.value))} />
                <span style={{ color: 'white', fontWeight: 700, minWidth: 26, display: 'inline-block' }}>{minScore}</span>
              </label>
              <button onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.15)' }}>
                {sortDir === 'desc' ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
                Score
              </button>
              <Link href={`/recruiter/pipeline/${jobId}/matching`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold no-underline transition-opacity hover:opacity-80"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
                <Brain className="h-3.5 w-3.5" /> Matching IA
              </Link>
              <button onClick={() => setConfigOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(232,163,61,0.15)', color: '#E8A33D', border: '1px solid rgba(232,163,61,0.3)' }}>
                <Settings2 className="h-3.5 w-3.5" /> Étapes
              </button>
            </div>
          </div>

          {/* Stats du funnel — vue d'ensemble de l'avancement de tous les candidats sur
              cette offre, un chiffre par étape configurée. */}
          {stageStats.some(s => s.count > 0) && (
            <div className="flex items-center gap-2 flex-wrap mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {stageStats.map(({ stage, count }) => (
                <div key={stage.slug} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${stage.color}40` }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
                  <span className="text-sm font-bold" style={{ color: 'white' }}>{count}</span>
                  <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>{stage.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {globalError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            <AlertCircle className="h-4 w-4 shrink-0" /> {globalError}
          </div>
        )}
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory mbc-board">
          {stages.map((stage, stageIndex) => {
            const isFirstStage = stageIndex === 0
            const list = byStage.get(stage.slug) ?? []
            const scored = list.filter(c => c.aiScore !== undefined)
            const avg = scored.length > 0
              ? Math.round(scored.reduce((s, c) => s + (c.aiScore ?? 0), 0) / scored.length)
              : null
            const isOver = dragOverStage === stage.slug
            return (
              <div key={stage.slug}
                className="shrink-0 snap-start rounded-2xl flex flex-col w-[86vw] sm:w-[300px] max-h-[calc(100vh-220px)]"
                style={{ background: '#F5F3EE', border: '1px solid rgba(0,0,0,0.05)' }}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.slug) }}
                onDragLeave={() => setDragOverStage(prev => (prev === stage.slug ? null : prev))}
                onDrop={() => handleDrop(stage.slug)}>
                <div className="flex items-center justify-between px-3.5 py-3 shrink-0">
                  <span className="text-[13px] font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
                    {stage.label}
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--color-text-muted)' }}>
                      {list.length}
                    </span>
                  </span>
                  {avg !== null && (
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>Ø {avg}/100</span>
                  )}
                </div>
                {isFirstStage && (
                  <div className="px-2.5 pb-2 shrink-0">
                    <Link href={`/recruiter/pipeline/${jobId}/matching`}
                      className="group flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-bold no-underline transition-all hover:-translate-y-px"
                      style={{ background: 'rgba(139,92,246,0.1)', color: '#7c3aed', border: '1px dashed rgba(139,92,246,0.45)' }}>
                      <Brain className="h-3.5 w-3.5" /> Voir la liste du Matching IA
                      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 transition-colors rounded-b-2xl" style={{
                  background: isOver ? `${stage.color}14` : 'transparent',
                  boxShadow: isOver ? `inset 0 0 0 2px ${stage.color}80` : 'inset 0 0 0 2px transparent',
                  minHeight: 140,
                }}>
                  {list.length === 0 ? (
                    <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>Aucun candidat</p>
                  ) : list.map(c => (
                    <CandidateCard key={c.appId} candidate={c} jobId={jobId} jobTitle={jobTitle} stages={stages} stageColor={stage.color}
                      suggestedAction={getStageAutoAction(stage)}
                      autoOpenInterview={autoOpenInterviewFor === c.appId}
                      onAutoOpened={() => setAutoOpenInterviewFor(null)}
                      interviewTargetStage={interviewTargetStage}
                      busyLabel={busy[c.appId]} onRunScreening={appId => triggerScreening(appId)} onInterviewSent={handleInterviewSent} onRenameInterview={handleRenameInterview} onEmailSent={handleEmailSent}
                      onQuickMove={moveCard} onDragStart={setDragging}
                      onOpenEdit={() => setEditingId(c.appId)} onOpenHistory={() => setHistoryId(c.appId)}
                      onOpenProcess={() => setProcessFor(c.appId)}
                      onDelete={() => handleDelete(c.appId)} />
                  ))}
                </div>
              </div>
            )
          })}
          <EmailsColumn candidates={candidates} emails={emails} onReplied={handleEmailReplied} />
        </div>
      </div>

      {configOpen && (
        <StagesConfigModal jobId={jobId} stages={stages} onClose={() => setConfigOpen(false)} onSaved={saved => setStages(withOrphans(saved))} />
      )}
      {processCandidate && (
        <FunnelModal key={processCandidate.appId} jobId={jobId} candidate={processCandidate} stages={stages} pipelineName={pipeline?.name ?? 'Pipeline par défaut'}
          onClose={() => setProcessFor(null)}
          onFunnelChange={handleFunnelChange}
          onMoveTo={(column, autoAction) => moveFromFunnel(processCandidate.appId, column, autoAction)} />
      )}
      {editingCandidate && (
        <EditCardModal jobId={jobId} candidate={editingCandidate} onClose={() => setEditingId(null)}
          onSaved={(tags, note) => setCandidates(cs => cs.map(c => c.appId === editingCandidate.appId ? { ...c, tags, note } : c))} />
      )}
      {historyId && (
        <HistoryModal applicationId={historyId} stages={stages} onClose={() => setHistoryId(null)} />
      )}

      <style>{`
        @keyframes mbc-ring { to { transform: rotate(360deg); } }
        @keyframes mbc-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
        @keyframes mbc-dot { 0%, 80%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
        @keyframes mbc-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .mbc-pipe-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .mbc-pipe-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(11,29,81,0.12); }
      `}</style>
    </div>
  )
}

function StagesConfigModal({ jobId, stages, onClose, onSaved }: {
  jobId: string; stages: FunnelStage[]; onClose: () => void; onSaved: (s: FunnelStage[]) => void
}) {
  const [rows, setRows] = useState(stages.map(s => ({ slug: s.slug, label: s.label, color: s.color, autoAction: s.autoAction ?? '' })))
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function update(i: number, field: 'label' | 'color' | 'autoAction', value: string) {
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  }
  function addStage() {
    setRows(r => [...r, { slug: slugify(`nouvelle_etape_${r.length}`), label: 'Nouvelle étape', color: '#6b7280', autoAction: '' }])
  }
  function removeStage(i: number) {
    setRows(r => r.filter((_, idx) => idx !== i))
  }
  function move(i: number, dir: -1 | 1) {
    setRows(r => {
      const next = [...r]
      const j = i + dir
      if (j < 0 || j >= next.length) return next
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function save() {
    setError('')
    if (rows.length === 0) { setError('Il faut au moins une étape'); return }
    startTransition(async () => {
      const payload = rows.map(r => ({
        ...r, slug: r.slug || slugify(r.label),
        autoAction: (r.autoAction || undefined) as FunnelStage['autoAction'],
      }))
      const res = await saveFunnelStagesAction(jobId, payload)
      if (res.error) setError(res.error)
      else if (res.stages) { onSaved(res.stages); onClose() }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden max-h-[85vh] flex flex-col" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
          <h2 className="font-semibold text-white text-sm">Configurer les étapes du pipeline</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-2.5 overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <div className="flex flex-col gap-0.5">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}>▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                  className="disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}>▼</button>
              </div>
              <input type="color" value={row.color} onChange={e => update(i, 'color', e.target.value)}
                className="w-8 h-8 rounded cursor-pointer shrink-0" style={{ border: '1px solid var(--color-border)' }} />
              <input value={row.label} onChange={e => update(i, 'label', e.target.value)}
                className="flex-1 min-w-[100px] px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              <select value={row.autoAction} onChange={e => update(i, 'autoAction', e.target.value)}
                title="Action suggérée sur les cartes de cette étape"
                className="px-2 py-2 rounded-lg text-xs outline-none"
                style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Aucune action suggérée</option>
                <option value="screening">Suggérer : Screening</option>
                <option value="interview">Suggérer : Entretien</option>
              </select>
              <button type="button" onClick={() => removeStage(i)} className="p-2 rounded-lg" style={{ color: '#ef4444' }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={addStage}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'rgba(232,163,61,0.1)', color: '#b8862f', border: '1px dashed rgba(232,163,61,0.4)' }}>
            <Plus className="h-3.5 w-3.5" /> Ajouter une étape
          </button>
          {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
        </div>
        <div className="flex gap-3 p-6 pt-0 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>Annuler</button>
          <button onClick={save} disabled={isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)', color: 'white' }}>
            {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…</> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditCardModal({ jobId, candidate, onClose, onSaved }: {
  jobId: string; candidate: PipelineCandidate; onClose: () => void; onSaved: (tags: string[], note: string) => void
}) {
  const [tagsInput, setTagsInput] = useState(candidate.tags.join(', '))
  const [note, setNote] = useState(candidate.note)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function save() {
    setError('')
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
    startTransition(async () => {
      const res = await updateApplicationCardAction(candidate.appId, jobId, { tags, note })
      if (res.error) setError(res.error)
      else { onSaved(tags, note); onClose() }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
          <h2 className="font-semibold text-white text-sm">{candidate.candidateName || candidate.candidateEmail}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              <TagIcon className="h-3 w-3" /> Étiquettes (séparées par virgule)
            </label>
            <input value={tagsInput} onChange={e => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              placeholder="urgent, top profil, relance" />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              <StickyNote className="h-3 w-3" /> Note interne
            </label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={4}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)', resize: 'vertical' }} />
          </div>
          {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>Annuler</button>
            <button onClick={save} disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)', color: 'white' }}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HistoryModal({ applicationId, stages, onClose }: { applicationId: string; stages: FunnelStage[]; onClose: () => void }) {
  const [events, setEvents] = useState<FunnelEvent[] | null>(null)
  const loaded = useRef(false)
  if (!loaded.current) {
    loaded.current = true
    getEventsAction(applicationId).then(setEvents)
  }
  const stageLabel = (slug: string) => stages.find(s => s.slug === slug)?.label ?? slug

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden max-h-[75vh] flex flex-col" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
          <h2 className="font-semibold text-white text-sm flex items-center gap-2"><History className="h-4 w-4" /> Historique</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 overflow-y-auto">
          {events === null ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--color-text-muted)' }} /></div>
          ) : events.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Aucun évènement pour l&apos;instant.</p>
          ) : (
            <div className="space-y-3">
              {events.map(ev => (
                <div key={ev.$id} className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--color-primary)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {EVENT_LABEL[ev.kind] ?? ev.kind}{ev.kind === 'stage_change' ? ` → ${stageLabel(ev.stageSlug)}` : ''}
                    </p>
                    {ev.note && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{ev.note}</p>}
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {new Date(ev.$createdAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
