import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getInterviewSessions } from '../actions'
import Link from 'next/link'
import { Brain, ExternalLink, Download, CheckCircle2, XCircle, TrendingUp, AlertTriangle, ChevronRight, Target, Award, Video, ArrowLeft, ClipboardList } from 'lucide-react'
import { ResendInviteButton } from './resend-invite-button'
import { RetryAnalysisButton } from './retry-analysis-button'
import { AudioPlayer, MultiTrackAudioPlayer } from '@/components/shared/audio-player'

const RECO_STYLE = {
  hire:    { label: 'Recommandé',        color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  consider:{ label: 'À considérer',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  reject:  { label: 'Non recommandé',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
}

export default async function InterviewDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')

  const sessions = await getInterviewSessions()
  const session = sessions.find(s => s.$id === sessionId)
  if (!session) redirect('/recruiter/interviews')

  const analysis = session.analysis
  const metrics = analysis ? [
    { label: 'Communication', score: analysis.communicationScore },
    { label: 'Technique', score: analysis.technicalScore },
    { label: 'Motivation', score: analysis.motivationScore },
    { label: 'Fit culturel', score: analysis.culturalFitScore },
  ] : []

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-3xl mx-auto px-6 py-10">
        <Link href="/recruiter/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
          style={{ color: '#c4b5fd' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Entretien IA</p>
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>{session.candidateName}</h1>
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{session.jobTitle} · {new Date(session.createdAt).toLocaleDateString('fr-FR')}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {session.applicationId && (
              <Link href={`/recruiter/candidates/${session.applicationId}`}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all"
                style={{ background: 'rgba(232,163,61,0.16)', border: '1px solid rgba(232,163,61,0.4)', color: '#fbd090' }}>
                <ClipboardList className="h-4 w-4" />
                Dashboard candidat
              </Link>
            )}
            <Link href={`/interview/${sessionId}`} target="_blank"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}>
              <ExternalLink className="h-4 w-4" />
              Voir la page candidat
            </Link>
            {session.status === 'pending' && (
              <ResendInviteButton
                applicationId={session.applicationId}
                candidateEmail={session.candidateEmail}
                sessionId={sessionId}
                jobTitle={session.jobTitle}
                candidateName={session.candidateName}
              />
            )}
          </div>
        </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        {/* Analysis */}
        {analysis ? (
          <>
            {/* Score + reco */}
            <div className="flex items-center gap-6 p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
              <div className="relative w-20 h-20 shrink-0">
                <svg viewBox="0 0 36 36" className="w-20 h-20 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(11,29,81,0.08)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={
                    analysis.overallScore >= 70 ? '#10b981' : analysis.overallScore >= 50 ? '#f59e0b' : '#ef4444'
                  } strokeWidth="3" strokeDasharray={`${analysis.overallScore} 100`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{analysis.overallScore}</span>
                </div>
              </div>
              <div className="flex-1">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold mb-2"
                  style={{ background: RECO_STYLE[analysis.recommendation].bg, color: RECO_STYLE[analysis.recommendation].color }}>
                  <Award className="h-4 w-4" />{RECO_STYLE[analysis.recommendation].label}
                </span>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{analysis.summary}</p>
              </div>
            </div>

            {/* Score bars */}
            <div className="space-y-4 p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              {metrics.map(m => (
                <div key={m.label} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span style={{ color: 'var(--color-text-muted)' }}>{m.label}</span>
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{m.score}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(11,29,81,0.08)' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${m.score}%`,
                      background: m.score >= 70 ? '#10b981' : m.score >= 50 ? '#f59e0b' : '#ef4444',
                    }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-5">
              {analysis.keyInsights.length > 0 && (
                <div className="space-y-3 p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Points clés</h3>
                  {analysis.keyInsights.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      <TrendingUp className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#10b981' }} />{s}
                    </div>
                  ))}
                </div>
              )}
              {analysis.redFlags.length > 0 && (
                <div className="space-y-3 p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
                  <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Signaux d&apos;alerte</h3>
                  {analysis.redFlags.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />{s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {analysis.nextSteps.length > 0 && (
              <div className="p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 8px 24px -6px rgba(124,58,237,0.25)' }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: '#7c3aed' }}>
                  <Target className="h-3.5 w-3.5" />Prochaines étapes
                </h3>
                {analysis.nextSteps.map((s, i) => (
                  <p key={i} className="text-sm flex items-start gap-2 mb-2" style={{ color: 'var(--color-text)' }}>
                    <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#7c3aed' }} />{s}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
            <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>L&apos;entretien n&apos;a pas encore été analysé.</p>
            <p className="text-sm mt-2">
              {session.status === 'completed'
                ? "L'entretien est terminé — lance l'analyse IA pour obtenir le score et la synthèse."
                : "Démarrez ou reprenez l'entretien pour obtenir l'analyse IA."}
            </p>
            {session.status === 'completed' && <RetryAnalysisButton sessionId={sessionId} />}
          </div>
        )}

        {/* Enregistrements */}
        {session.recordings.length > 0 && (() => {
          // A merged full track (questionIdx: -1) already has Alex's voice mixed in — the
          // per-question interviewer clips would just repeat the same audio, fragmented.
          const hasFullTrack = session.recordings.some(r => r.questionIdx === -1)
          const recs = hasFullTrack ? session.recordings.filter(r => r.role !== 'interviewer') : session.recordings
          const videoRecs = recs.filter(r => r.mediaType === 'video')
          const audioRecs = recs.filter(r => r.mediaType !== 'video')
            // Sort by question only — `.sort` is stable, so entries sharing a questionIdx
            // (a follow-up, or an old per-question candidate fragment) keep their original
            // array order, which is the true chronological record: question asked, then
            // answered, in the order it actually happened during the interview.
            .sort((a, b) => a.questionIdx - b.questionIdx)
          const useMultiTrack = !hasFullTrack && audioRecs.length > 1
          const questions = session.questions

          function labelFor(rec: typeof recs[number]) {
            const isFullTrack = rec.questionIdx === -1
            const question = isFullTrack ? undefined : questions[rec.questionIdx]
            const isInterviewer = rec.role === 'interviewer'
            const label = isFullTrack ? 'Entretien complet' : `Question ${rec.questionIdx + 1}`
            const sublabel = question ? `${question.text.slice(0, 70)}${question.text.length > 70 ? '…' : ''}`
              : isInterviewer ? 'Alex (recruteur IA)' : 'Réponse du candidat'
            return { label, sublabel, isInterviewer, isFullTrack }
          }

          return (
            <div className="p-5 sm:p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-text-muted)' }}>
                Enregistrement{recs.length > 1 ? 's' : ''} audio
              </h3>
              <div className="space-y-3">
                {useMultiTrack ? (
                  <MultiTrackAudioPlayer
                    accentColor="#7c3aed"
                    tracks={audioRecs.map(rec => {
                      const { label, sublabel } = labelFor(rec)
                      return { url: `/api/recording/${rec.fileId}`, label, sublabel }
                    })}
                  />
                ) : (
                  audioRecs.map(rec => {
                    const { label, sublabel, isInterviewer, isFullTrack } = labelFor(rec)
                    return (
                      <AudioPlayer
                        key={rec.fileId}
                        src={`/api/recording/${rec.fileId}`}
                        label={label}
                        sublabel={sublabel}
                        accentColor={isInterviewer ? '#2563eb' : '#7c3aed'}
                        downloadName={`entretien-${isFullTrack ? 'complet' : `q${rec.questionIdx + 1}`}.webm`}
                      />
                    )
                  })
                )}
                {videoRecs.map(rec => {
                  const { label } = labelFor(rec)
                  return (
                    <div key={rec.fileId} className="p-4 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
                      <div className="flex items-center gap-2 mb-2.5">
                        <Video className="h-3.5 w-3.5 shrink-0" style={{ color: '#7c3aed' }} />
                        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
                      </div>
                      <video controls src={`/api/recording/${rec.fileId}`} className="w-full rounded-lg" style={{ maxHeight: 320, background: '#000' }} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Transcript preview */}
        {session.transcript.length > 0 && (
          <div className="p-5 sm:p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-text-muted)' }}>Retranscription ({session.transcript.length} échanges)</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
              {session.transcript.map((entry, i) => (
                <div key={i} className={`flex ${entry.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm font-medium"
                    style={{
                      background: entry.role === 'interviewer' ? 'rgba(124,58,237,0.12)' : 'rgba(232,163,61,0.1)',
                      color: entry.role === 'interviewer' ? '#6d28d9' : '#c2410c',
                    }}>
                    {entry.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
