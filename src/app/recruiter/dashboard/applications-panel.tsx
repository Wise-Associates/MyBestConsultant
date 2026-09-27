'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  FileText, Mail, Brain, ChevronDown, ChevronUp,
  User, Calendar, Star, Video, CheckCircle2, Clock, XCircle, Archive, Loader2,
} from 'lucide-react'
import { setApplicationStatusAction } from './actions'

const STATUS: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  pending:   { label: 'En attente',   bg: 'rgba(107,114,128,0.1)', text: '#6b7280', icon: Clock },
  screening: { label: 'Screening IA', bg: 'rgba(139,92,246,0.1)',  text: '#8b5cf6', icon: Brain },
  interview: { label: 'Entretien',    bg: 'rgba(59,130,246,0.1)',  text: '#3b82f6', icon: Video },
  accepted:  { label: 'Accepté',      bg: 'rgba(16,185,129,0.1)',  text: '#10b981', icon: CheckCircle2 },
  rejected:  { label: 'Refusé',       bg: 'rgba(239,68,68,0.1)',   text: '#ef4444', icon: XCircle },
  on_hold:   { label: 'Vivier',       bg: 'rgba(245,158,11,0.1)',  text: '#f59e0b', icon: Archive },
}

export interface CandidateApp {
  appId: string
  jobId: string
  candidateId: string
  candidateName: string
  candidateEmail: string
  cvFileId: string
  status: string
  aiScore?: number
  aiSummary?: string
  createdAt: string
}

interface Props {
  jobTitle: string
  apps: CandidateApp[]
}

function scoreColor(s: number) {
  return s >= 85 ? '#10b981' : s >= 70 ? '#3b82f6' : s >= 55 ? '#f59e0b' : '#ef4444'
}

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(' ')
  const init = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase()
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
      style={{ background: 'rgba(11,29,81,0.1)', color: 'var(--color-primary)' }}>
      {init}
    </div>
  )
}

export function CandidateCard({ app }: { app: CandidateApp }) {
  const [expanded, setExpanded] = useState(false)
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const currentStatus = statusOverride ?? app.status
  const status = STATUS[currentStatus] ?? STATUS.pending
  const StatusIcon = status.icon
  const date = new Date(app.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

  function decide(next: 'accepted' | 'rejected' | 'on_hold') {
    setStatusOverride(next)
    startTransition(() => { setApplicationStatusAction(app.appId, next) })
  }

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          <Initials name={app.candidateName || app.candidateEmail} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/recruiter/candidates/${app.appId}`}
                className="text-sm font-semibold no-underline hover:underline"
                style={{ color: 'var(--color-text)' }}>
                {app.candidateName || app.candidateEmail}
              </Link>
              {app.aiScore !== undefined && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${scoreColor(app.aiScore)}18`, color: scoreColor(app.aiScore) }}>
                  {app.aiScore}/100
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                {app.candidateEmail}
              </p>
              <span className="text-xs flex items-center gap-1 shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                <Calendar className="h-3 w-3" />{date}
              </span>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
            style={{ background: status.bg, color: status.text }}>
            <StatusIcon className="h-3 w-3" />{status.label}
          </span>
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg transition-all shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 pl-[52px] flex-wrap">
          {app.cvFileId ? (
            <a href={`/api/cv/${app.cvFileId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium no-underline transition-opacity hover:opacity-75"
              style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-primary)', border: '1px solid rgba(11,29,81,0.12)' }}>
              <FileText className="h-3.5 w-3.5" /> Voir CV
            </a>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
              <FileText className="h-3.5 w-3.5" /> Pas de CV
            </span>
          )}
          <a href={`mailto:${app.candidateEmail}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium no-underline transition-opacity hover:opacity-75"
            style={{ background: 'rgba(59,130,246,0.08)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.15)' }}>
            <Mail className="h-3.5 w-3.5" /> Message
          </a>
          <Link href={`/recruiter/interviews/new?appId=${app.appId}&jobId=${app.jobId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium no-underline transition-opacity hover:opacity-75"
            style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
            <Video className="h-3.5 w-3.5" /> Entretien IA
          </Link>

          <span className="w-px h-4 shrink-0" style={{ background: 'var(--color-border)' }} />

          <button onClick={() => decide('accepted')} disabled={isPending || currentStatus === 'accepted'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-40"
            style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Retenir
          </button>
          <button onClick={() => decide('rejected')} disabled={isPending || currentStatus === 'rejected'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)' }}>
            <XCircle className="h-3.5 w-3.5" /> Refuser
          </button>
          <button onClick={() => decide('on_hold')} disabled={isPending || currentStatus === 'on_hold'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-75 disabled:opacity-40"
            style={{ background: 'rgba(245,158,11,0.08)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.15)' }}>
            <Archive className="h-3.5 w-3.5" /> Vivier
          </button>
        </div>
      </div>

      {/* AI summary expanded */}
      {expanded && app.aiSummary && (
        <div className="px-5 pb-4 pl-[69px]">
          <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)', color: 'var(--color-text)', lineHeight: 1.6 }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8b5cf6' }}>Résumé IA</p>
            {app.aiSummary}
          </div>
        </div>
      )}
    </div>
  )
}

export function ApplicationsPanel({ jobTitle, apps }: Props) {
  return (
    <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.14)' }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{jobTitle}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {apps.length} candidature{apps.length !== 1 ? 's' : ''}
          </p>
        </div>
        {apps.filter(a => a.aiScore !== undefined).length > 0 && (
          <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#B8860B' }}>
            <Star className="h-3.5 w-3.5" />
            Score moy. {Math.round(
              apps.filter(a => a.aiScore !== undefined).reduce((s, a) => s + (a.aiScore ?? 0), 0) /
              apps.filter(a => a.aiScore !== undefined).length
            )}/100
          </span>
        )}
      </div>

      {apps.length === 0 ? (
        <div className="py-16 text-center px-6">
          <User className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune candidature pour cette offre.</p>
        </div>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: '540px' }}>
          {apps.map(app => <CandidateCard key={app.appId} app={app} />)}
        </div>
      )}
    </div>
  )
}
