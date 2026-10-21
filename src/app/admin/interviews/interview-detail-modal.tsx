'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  X, Brain, MessageSquare, Star, AlertTriangle, CheckCircle2,
  Loader2, Calendar, Clock, User, Briefcase,
  TrendingUp, TrendingDown, Minus, Sparkles, Mic, Video,
} from 'lucide-react'
import { getInterviewDetail, analyzeInterview, type InterviewDetail } from './actions'
import type { AdminInterviewRow } from './actions'
import { AudioPlayer, MultiTrackAudioPlayer } from '@/components/shared/audio-player'

// ── Constantes ────────────────────────────────────────────────────
const STATUS_CFG = {
  pending:     { label: 'En attente',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  in_progress: { label: 'En cours',    color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  completed:   { label: 'Terminé',     color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  analysed:    { label: 'Analysé IA',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
}
const RECO_CFG = {
  hire:    { label: 'À recruter',     color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: TrendingUp },
  consider:{ label: 'À considérer',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Minus },
  reject:  { label: 'À rejeter',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: TrendingDown },
}
const CAT_COLORS: Record<string, string> = {
  intro: '#60a5fa', technical: '#a78bfa', behavioral: '#34d399',
  motivation: '#f59e0b', closing: '#f87171',
}
const CAT_LABELS: Record<string, string> = {
  intro: 'Intro', technical: 'Technique', behavioral: 'Comportemental',
  motivation: 'Motivation', closing: 'Clôture',
}

// ── Score gauge ───────────────────────────────────────────────────
function ScoreGauge({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const r = size * 0.38
  const circ = 2 * Math.PI * r
  const color = score >= 75 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={size * 0.1} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={size * 0.1}
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={size * 0.22} fontWeight="700" fill={color}>{score}</text>
      </svg>
      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600, marginTop: 4 }}>{label}</p>
    </div>
  )
}

// ── Transcript message ────────────────────────────────────────────
function Message({ entry, questionMap }: {
  entry: InterviewDetail['transcript'][0]
  questionMap: Map<string, string>
}) {
  const isAlex = entry.role === 'interviewer'
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: isAlex ? 'row' : 'row-reverse', alignItems: 'flex-end' }}>
      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: isAlex ? 'linear-gradient(135deg,#4c1d95,#7c3aed)' : 'rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: isAlex ? 'none' : '1px solid rgba(255,255,255,0.12)',
      }}>
        {isAlex
          ? <Brain style={{ width: 14, height: 14, color: '#c4b5fd' }} />
          : <User style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.5)' }} />
        }
      </div>

      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: isAlex ? 'flex-start' : 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: isAlex ? '#a78bfa' : 'rgba(255,255,255,0.35)' }}>
            {isAlex ? 'Alex' : 'Candidat'}
          </span>
          {time && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{time}</span>}
        </div>
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: isAlex ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
          background: isAlex ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.06)',
          border: isAlex ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(255,255,255,0.08)',
          fontSize: '0.85rem', color: isAlex ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.75)',
          lineHeight: 1.65,
        }}>
          {entry.content}
        </div>
      </div>
    </div>
  )
}

// ── Tab Transcription ─────────────────────────────────────────────
function TabTranscript({ detail }: { detail: InterviewDetail }) {
  // Map question text → category
  const questionMap = new Map(detail.questions.map(q => [q.text, q.category]))

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Questions résumé */}
      {detail.questions.length > 0 && (
        <div style={{ padding: '1rem', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: '0.5rem' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem' }}>
            {detail.questions.length} questions posées
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {detail.questions.map((q, i) => (
              <span key={q.id ?? i} style={{
                fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                color: CAT_COLORS[q.category] ?? '#a78bfa',
                background: `${CAT_COLORS[q.category] ?? '#a78bfa'}18`,
              }}>
                {CAT_LABELS[q.category] ?? q.category}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Conversation */}
      {detail.transcript.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.25)' }}>
          <MessageSquare style={{ width: 32, height: 32, margin: '0 auto 1rem', opacity: 0.3 }} />
          <p style={{ fontSize: 13 }}>Aucune transcription disponible</p>
          <p style={{ fontSize: 11, marginTop: '0.5rem', opacity: 0.6 }}>L&apos;entretien n&apos;a pas encore démarré</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {detail.transcript.map((entry, i) => (
            <Message key={i} entry={entry} questionMap={questionMap} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab Analyse IA ────────────────────────────────────────────────
function TabAnalysis({ detail, onAnalysisDone, onAnalyze }: {
  detail: InterviewDetail
  onAnalysisDone: (a: InterviewDetail['analysis']) => void
  onAnalyze: (id: string) => Promise<{ analysis?: InterviewDetail['analysis']; error?: string }>
}) {
  const [isPending, startTransition] = useTransition()
  const [err, setErr] = useState('')
  const a = detail.analysis

  const runAnalysis = () => {
    setErr('')
    startTransition(async () => {
      const res = await onAnalyze(detail.id)
      if (res.error) { setErr(res.error); return }
      if (res.analysis) onAnalysisDone(res.analysis)
    })
  }

  if (!a) {
    const hasTranscript = detail.transcript.length > 0
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
          <Brain style={{ width: 32, height: 32, color: 'rgba(124,58,237,0.5)' }} />
        </div>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: 600, marginBottom: '0.5rem' }}>
          Analyse IA non générée
        </p>
        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, lineHeight: 1.7, marginBottom: '2rem' }}>
          {hasTranscript
            ? `${detail.transcript.length} échanges disponibles — cliquez pour lancer l'analyse Claude AI`
            : "Aucune transcription disponible. L'entretien doit être complété d'abord."}
        </p>
        {hasTranscript && (
          <button
            onClick={runAnalysis}
            disabled={isPending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.75rem 1.75rem', borderRadius: 12, border: 'none', cursor: isPending ? 'default' : 'pointer',
              background: isPending ? 'rgba(124,58,237,0.3)' : 'linear-gradient(135deg,#6d28d9,#4c1d95)',
              color: 'white', fontSize: 13, fontWeight: 700,
              boxShadow: isPending ? 'none' : '0 4px 20px rgba(124,58,237,0.35)',
              transition: 'all 0.2s',
            }}>
            {isPending
              ? <><Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} />Analyse en cours…</>
              : <><Sparkles style={{ width: 15, height: 15 }} />Lancer l&apos;analyse IA</>
            }
          </button>
        )}
        {err && <p style={{ color: '#f87171', fontSize: 12, marginTop: '1rem' }}>{err}</p>}
      </div>
    )
  }

  const reco = RECO_CFG[a.recommendation] ?? RECO_CFG.consider
  const RecoIcon = reco.icon

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Scores */}
      <div style={{ borderRadius: 16, padding: '1.5rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
            Scores
          </p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20, background: reco.bg, color: reco.color }}>
            <RecoIcon style={{ width: 13, height: 13 }} />{reco.label}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around', gap: '1rem', flexWrap: 'wrap' }}>
          <ScoreGauge score={a.overallScore} label="Score global" size={96} />
          <ScoreGauge score={a.technicalScore} label="Technique" size={72} />
          <ScoreGauge score={a.motivationScore} label="Motivation" size={72} />
          <ScoreGauge score={a.culturalFitScore} label="Culture fit" size={72} />
        </div>
      </div>

      {/* Résumé */}
      {a.summary && (
        <div style={{ borderRadius: 14, padding: '1.25rem', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.15)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '0.75rem' }}>Résumé</p>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.75)', lineHeight: 1.7 }}>{a.summary}</p>
        </div>
      )}

      {/* Key insights + Red flags */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {a.keyInsights.length > 0 && (
          <div style={{ borderRadius: 14, padding: '1.25rem', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#10b981', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Star style={{ width: 11, height: 11 }} />Points forts
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {a.keyInsights.map((ins, i) => (
                <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <CheckCircle2 style={{ width: 13, height: 13, color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>{ins}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {a.redFlags.length > 0 && (
          <div style={{ borderRadius: 14, padding: '1.25rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ef4444', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertTriangle style={{ width: 11, height: 11 }} />Points de vigilance
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {a.redFlags.map((flag, i) => (
                <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <AlertTriangle style={{ width: 13, height: 13, color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>{flag}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Prochaines étapes */}
      {a.nextSteps.length > 0 && (
        <div style={{ borderRadius: 14, padding: '1.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '0.875rem' }}>
            Prochaines étapes recommandées
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {a.nextSteps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(184,134,11,0.15)', border: '1px solid rgba(184,134,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#d4a017' }}>{i + 1}</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'right' }}>
        Analyse générée par {a.analysedBy}
      </p>
    </div>
  )
}

// ── Tab Enregistrements ────────────────────────────────────────────
function TabRecordings({ detail }: { detail: InterviewDetail }) {
  const all = detail.recordings ?? []
  // A session with a merged full track (questionIdx: -1) already has Alex's voice mixed
  // into that one continuous recording (see interview-room-candidate.tsx's AudioContext
  // graph) — showing the per-question interviewer clips alongside it would just be the
  // same audio twice, fragmented. Older sessions predating that merge have no full track,
  // so their per-question fragments are all that exists and stay visible.
  const hasFullTrack = all.some(r => r.questionIdx === -1)
  const recs = hasFullTrack ? all.filter(r => r.role !== 'interviewer') : all
  const videoRecs = recs.filter(r => r.mediaType === 'video')
  // Legacy sessions (no merged full track) have one clip per question turn — play them
  // back-to-back as a single session instead of stacking N separate players.
  const audioRecs = recs.filter(r => r.mediaType !== 'video')
    // Sort by question only — `.sort` is stable, so entries sharing a questionIdx (a
    // follow-up, or an old per-question candidate fragment) keep their original array
    // order, which is the true chronological record: question asked, then answered, in
    // the order it actually happened during the interview.
    .sort((a, b) => a.questionIdx - b.questionIdx)
  const useMultiTrack = !hasFullTrack && audioRecs.length > 1

  if (recs.length === 0) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
          <Mic style={{ width: 28, height: 28, color: 'rgba(255,255,255,0.2)' }} />
        </div>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 600, marginBottom: '0.5rem' }}>
          Aucun enregistrement
        </p>
        <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, lineHeight: 1.6 }}>
          Les enregistrements audio sont capturés lors des entretiens vocaux.<br />
          Cet entretien n&apos;en contient pas (réponses texte uniquement ou ancienne version).
        </p>
      </div>
    )
  }

  function labelFor(rec: InterviewDetail['recordings'][number], fallbackIdx: number) {
    const isFullTrack = rec.questionIdx === -1
    const question = isFullTrack ? undefined : detail.questions[rec.questionIdx]
    const isInterviewer = rec.role === 'interviewer'
    const label = isFullTrack ? 'Entretien complet' : `Question ${rec.questionIdx + 1}`
    const sublabel = question ? `${question.text.slice(0, 70)}${question.text.length > 70 ? '…' : ''}`
      : isInterviewer ? 'Alex (recruteur IA)' : isFullTrack ? 'Réponses du candidat (audio continu)' : `Réponse du candidat ${fallbackIdx + 1}`
    return { label, sublabel, isInterviewer, isFullTrack }
  }

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
        {recs.length} enregistrement{recs.length > 1 ? 's' : ''} {videoRecs.length > 0 ? '' : 'audio'}
      </p>

      {useMultiTrack ? (
        <MultiTrackAudioPlayer
          accentColor="#a78bfa"
          dark
          tracks={audioRecs.map((rec, i) => {
            const { label, sublabel } = labelFor(rec, i)
            return { url: rec.url, label, sublabel }
          })}
        />
      ) : (
        audioRecs.map((rec, i) => {
          const { label, sublabel, isInterviewer, isFullTrack } = labelFor(rec, i)
          return (
            <AudioPlayer
              key={rec.fileId}
              src={rec.url}
              label={label}
              sublabel={sublabel}
              accentColor={isInterviewer ? '#60a5fa' : '#a78bfa'}
              downloadName={`entretien-${isFullTrack ? 'complet' : `q${rec.questionIdx + 1}`}.webm`}
              dark
            />
          )
        })
      )}

      {videoRecs.map((rec, i) => {
        const { label, sublabel } = labelFor(rec, i)
        return (
          <div key={rec.fileId} style={{ borderRadius: 14, padding: '1.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Video style={{ width: 13, height: 13, color: '#a78bfa' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{label}</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{sublabel}</p>
              </div>
            </div>
            <video controls src={rec.url} style={{ width: '100%', maxHeight: 320, borderRadius: 8, outline: 'none', background: '#000' }} />
          </div>
        )
      })}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────
// row/getDetail/onAnalyze are injectable so this same modal (and its tabs) can be reused
// from a non-admin context (the recruiter pipeline) with tenant-scoped actions instead of
// the admin-only ones — admin call sites get identical behavior via the defaults below.
interface Props {
  row: Omit<AdminInterviewRow, 'tenantId'> & { tenantId?: string }
  onClose: () => void
  getDetail?: (id: string) => Promise<{ detail: InterviewDetail | null; error?: string }>
  onAnalyze?: (id: string) => Promise<{ analysis?: InterviewDetail['analysis']; error?: string }>
}

export function InterviewDetailModal({ row, onClose, getDetail = getInterviewDetail, onAnalyze = analyzeInterview }: Props) {
  const [tab, setTab] = useState<'transcript' | 'analysis' | 'recordings'>('transcript')
  const [detail, setDetail] = useState<InterviewDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [, startTransition] = useTransition()

  const st = STATUS_CFG[row.status] ?? STATUS_CFG.pending

  useEffect(() => {
    startTransition(async () => {
      const { detail: d, error: e } = await getDetail(row.id)
      if (e) setError(e)
      else setDetail(d)
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  const TABS = [
    { key: 'transcript',  label: 'Transcription',    icon: MessageSquare },
    { key: 'analysis',    label: 'Analyse IA',        icon: Brain },
    { key: 'recordings',  label: 'Enregistrements',   icon: Mic },
  ] as const

  const duration = row.completedAt && row.createdAt
    ? Math.round((new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime()) / 60000)
    : null

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 760, height: '90vh',
        borderRadius: 24, overflow: 'hidden',
        background: '#0d0f14', border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            {/* Avatar candidat */}
            <div style={{ width: 52, height: 52, borderRadius: 16, background: 'linear-gradient(135deg,#1e1b4b,#4c1d95)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18, fontWeight: 700, color: '#c4b5fd' }}>
              {row.candidateName.slice(0, 2).toUpperCase()}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h2 style={{ color: 'white', fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>{row.candidateName}</h2>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: st.bg, color: st.color }}>
                  {st.label}
                </span>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: '0.25rem' }}>{row.candidateEmail}</p>

              {/* Meta */}
              <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Briefcase style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.25)' }} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{row.jobTitle}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Calendar style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.25)' }} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    {new Date(row.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </span>
                </div>
                {duration !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Clock style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.25)' }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{duration} min</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <MessageSquare style={{ width: 12, height: 12, color: 'rgba(255,255,255,0.25)' }} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    {row.transcriptLength} échanges · {row.questionCount} questions
                  </span>
                </div>
              </div>
            </div>

            <button onClick={onClose}
              style={{ padding: 8, borderRadius: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'white')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
              <X style={{ width: 20, height: 20 }} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginTop: '1.25rem', background: 'rgba(255,255,255,0.04)', padding: '0.25rem', borderRadius: 12, width: 'fit-content' }}>
            {TABS.map(t => (
              <button key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.5rem 1rem', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: tab === t.key ? 'rgba(255,255,255,0.09)' : 'transparent',
                  color: tab === t.key ? 'white' : 'rgba(255,255,255,0.35)',
                  transition: 'all 0.15s',
                }}>
                <t.icon style={{ width: 13, height: 13 }} />{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
              <Loader2 style={{ width: 32, height: 32, color: '#7c3aed', animation: 'spin 1s linear infinite' }} />
              <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Chargement de l&apos;entretien…</p>
            </div>
          ) : error ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#f87171', fontSize: 13 }}>{error}</div>
          ) : detail ? (
            <>
              {tab === 'transcript'  && <TabTranscript detail={detail} />}
              {tab === 'recordings' && <TabRecordings detail={detail} />}
              {tab === 'analysis'   && (
                <TabAnalysis
                  detail={detail}
                  onAnalysisDone={a => setDetail(prev => prev ? { ...prev, analysis: a, status: 'analysed' } : prev)}
                  onAnalyze={onAnalyze}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
