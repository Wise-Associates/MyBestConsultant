import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getInterviewSessions } from '../actions'
import Link from 'next/link'
import { BackLink } from '@/components/recruiter/back-link'
import { Brain, ExternalLink, TrendingUp, AlertTriangle, ChevronRight, Target, Award, Video, ClipboardList, MessagesSquare } from 'lucide-react'
import { ResendInviteButton } from './resend-invite-button'
import { RetryAnalysisButton } from './retry-analysis-button'
import { AudioPlayer, MultiTrackAudioPlayer } from '@/components/shared/audio-player'

// Mise en page (demande du 2026-11-10 : « pas optimisée pour l'espace », suivre le tableau de bord ou le pipeline) :
// en-tête clair sur une ligne, sans bandeau ; à partir de 1024 px, enregistrements et retranscription à gauche,
// analyse à droite ; à partir de 1440 px, toute la largeur et trois colonnes — score à gauche, enregistrements et
// retranscription au centre, points de l'IA à droite, les colonnes latérales restant visibles au défilement.
const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const secondaryButton = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const sectionTitle = 'text-xs font-semibold uppercase tracking-widest'

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

  const hasEvidence = session.recordings.length > 0 || session.transcript.length > 0

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="max-w-[1400px] min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-5 sm:py-6">
        <header className="flex items-end justify-between gap-x-4 gap-y-3 flex-wrap mb-5">
          <div className="min-w-0">
            <BackLink fallbackHref="/recruiter/interviews"
              className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ color: 'var(--color-text-muted)' }} />
            <h1 className="mt-1.5 truncate" style={{ color: 'var(--color-text)', fontSize: '1.375rem', fontWeight: 300, lineHeight: 1.25 }}>{session.candidateName}</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Entretien IA · {session.jobTitle} · {new Date(session.createdAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {session.applicationId && (
              <Link href={`/recruiter/candidates/${session.applicationId}`}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-colors hover:bg-[var(--color-background)]"
                style={secondaryButton}>
                <ClipboardList className="h-4 w-4" aria-hidden />
                Dashboard candidat
              </Link>
            )}
            <Link href={`/interview/${sessionId}`} target="_blank"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-colors hover:bg-[var(--color-background)]"
              style={secondaryButton}>
              <ExternalLink className="h-4 w-4" aria-hidden />
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
        </header>

        {/* Ordre du document = ordre de lecture sur mobile (score, analyse, puis enregistrements et retranscription) ;
            les colonnes des grands écrans sont placées explicitement. */}
        <div className="grid gap-5 items-start lg:grid-cols-[minmax(0,1fr)_380px] min-[90rem]:grid-cols-[320px_minmax(0,1fr)_380px]">
          {/* Score et critères */}
          <div className="space-y-5 min-w-0 lg:col-start-2 lg:row-start-1 min-[90rem]:col-start-1 min-[90rem]:sticky min-[90rem]:top-[84px]">
            {analysis ? (
              <>
                <section className="p-5 rounded-3xl" style={card} aria-label="Score de l’entretien">
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 shrink-0">
                      <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90" aria-hidden>
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-border)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke={
                          analysis.overallScore >= 70 ? '#10b981' : analysis.overallScore >= 50 ? '#f59e0b' : '#ef4444'
                        } strokeWidth="3" strokeDasharray={`${analysis.overallScore} 100`} strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{analysis.overallScore}</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold"
                      style={{ background: RECO_STYLE[analysis.recommendation].bg, color: RECO_STYLE[analysis.recommendation].color }}>
                      <Award className="h-4 w-4" aria-hidden />{RECO_STYLE[analysis.recommendation].label}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mt-4" style={{ color: 'var(--color-text-muted)' }}>{analysis.summary}</p>
                </section>

                <section className="space-y-3.5 p-5 rounded-3xl" style={card} aria-label="Critères">
                  {metrics.map(m => (
                    <div key={m.label} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span style={{ color: 'var(--color-text-muted)' }}>{m.label}</span>
                        <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{m.score}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-background)' }}>
                        <div className="h-full rounded-full" style={{
                          width: `${m.score}%`,
                          background: m.score >= 70 ? '#10b981' : m.score >= 50 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                    </div>
                  ))}
                </section>
              </>
            ) : (
              <section className="text-center px-5 py-10 rounded-3xl" style={{ ...card, color: 'var(--color-text-muted)' }}>
                <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" aria-hidden />
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>L&apos;entretien n&apos;a pas encore été analysé.</p>
                <p className="text-sm mt-2">
                  {session.status === 'completed'
                    ? "L'entretien est terminé — lance l'analyse IA pour obtenir le score et la synthèse."
                    : "Démarrez ou reprenez l'entretien pour obtenir l'analyse IA."}
                </p>
                {session.status === 'completed' && <RetryAnalysisButton sessionId={sessionId} />}
              </section>
            )}
          </div>

          {/* Points de l'IA */}
          {analysis && (analysis.keyInsights.length > 0 || analysis.redFlags.length > 0 || analysis.nextSteps.length > 0) && (
            <div className="space-y-5 min-w-0 lg:col-start-2 lg:row-start-2 min-[90rem]:col-start-3 min-[90rem]:row-start-1 min-[90rem]:sticky min-[90rem]:top-[84px]">
              {analysis.keyInsights.length > 0 && (
                <section className="space-y-3 p-5 rounded-3xl" style={card}>
                  <h2 className={sectionTitle} style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Points clés</h2>
                  {analysis.keyInsights.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <TrendingUp className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#10b981' }} aria-hidden />{s}
                    </div>
                  ))}
                </section>
              )}
              {analysis.redFlags.length > 0 && (
                <section className="space-y-3 p-5 rounded-3xl" style={card}>
                  <h2 className={sectionTitle} style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Signaux d&apos;alerte</h2>
                  {analysis.redFlags.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} aria-hidden />{s}
                    </div>
                  ))}
                </section>
              )}
              {analysis.nextSteps.length > 0 && (
                <section className="p-5 rounded-3xl" style={card}>
                  <h2 className={`${sectionTitle} mb-3 flex items-center gap-2`} style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                    <Target className="h-3.5 w-3.5" aria-hidden />Prochaines étapes
                  </h2>
                  {analysis.nextSteps.map((s, i) => (
                    <p key={i} className="text-sm flex items-start gap-2 mb-2 last:mb-0" style={{ color: 'var(--color-text)' }}>
                      <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }} aria-hidden />{s}
                    </p>
                  ))}
                </section>
              )}
            </div>
          )}

          {/* Enregistrements et retranscription */}
          <div className="space-y-5 min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2 min-[90rem]:col-start-2 min-[90rem]:row-span-1">
            {!hasEvidence && (
              <section className="text-center px-5 py-10 rounded-3xl text-sm" style={{ ...card, color: 'var(--color-text-muted)' }}>
                <MessagesSquare className="h-10 w-10 mx-auto mb-3 opacity-30" aria-hidden />
                Aucun enregistrement ni retranscription pour le moment : ils apparaîtront ici une fois l&apos;entretien passé.
              </section>
            )}

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
                <section className="p-5 sm:p-6 rounded-3xl" style={card}>
                  <h2 className={`${sectionTitle} mb-4`} style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                    Enregistrement{recs.length > 1 ? 's' : ''}
                  </h2>
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
                        <div key={rec.fileId} className="p-4 rounded-2xl" style={card}>
                          <div className="flex items-center gap-2 mb-2.5">
                            <Video className="h-3.5 w-3.5 shrink-0" style={{ color: '#7c3aed' }} />
                            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
                          </div>
                          <video controls src={`/api/recording/${rec.fileId}`} className="w-full rounded-lg" style={{ maxHeight: 420, background: '#000' }} />
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })()}

            {session.transcript.length > 0 && (
              <section className="p-5 sm:p-6 rounded-3xl" style={card}>
                <h2 className={`${sectionTitle} mb-4`} style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>Retranscription ({session.transcript.length} échanges)</h2>
                {/* Hauteur de l'écran sur grand écran (avant : 320 px), défilement dans la carte. */}
                <div className="space-y-3 max-h-96 lg:max-h-[calc(100vh-260px)] overflow-y-auto pr-2">
                  {session.transcript.map((entry, i) => (
                    <div key={i} className={`flex ${entry.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}>
                      <div className="max-w-[min(80%,72ch)] px-4 py-2.5 rounded-2xl text-sm font-medium"
                        style={{
                          background: entry.role === 'interviewer' ? 'rgba(124,58,237,0.12)' : 'rgba(232,163,61,0.1)',
                          color: entry.role === 'interviewer' ? '#6d28d9' : '#c2410c',
                        }}>
                        {entry.content}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
