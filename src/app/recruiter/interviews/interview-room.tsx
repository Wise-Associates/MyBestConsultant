'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Mic, MicOff, Play, Square, SkipForward, Brain,
  CheckCircle2, XCircle, ChevronRight, Volume2, Loader2,
  TrendingUp, AlertTriangle, Target, Award, MessageSquare,
  Download, RotateCcw, ArrowLeft,
} from 'lucide-react'
import {
  getAIFollowUp, analyseInterview,
  type InterviewQuestion, type TranscriptEntry, type InterviewAnalysis,
} from './actions'

// ── Analysis report ────────────────────────────────────────────────
function AnalysisReport({ analysis, candidateName, onRestart }: {
  analysis: InterviewAnalysis
  candidateName: string
  onRestart: () => void
}) {
  const recoBg = analysis.recommendation === 'hire'
    ? { bg: 'rgba(16,185,129,0.12)', color: '#10b981', label: 'Recommandé pour embauche' }
    : analysis.recommendation === 'consider'
    ? { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', label: 'À considérer' }
    : { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Non recommandé' }

  const metrics = [
    { label: 'Communication', score: analysis.communicationScore },
    { label: 'Technique', score: analysis.technicalScore },
    { label: 'Motivation', score: analysis.motivationScore },
    { label: 'Fit culturel', score: analysis.culturalFitScore },
  ]

  function downloadReport() {
    const txt = [
      `RAPPORT D'ENTRETIEN IA — ${candidateName}`,
      `Analysé par : ${analysis.analysedBy}`,
      '',
      `SCORE GLOBAL : ${analysis.overallScore}/100`,
      `RECOMMANDATION : ${recoBg.label}`,
      '',
      `SYNTHÈSE :`,
      analysis.summary,
      '',
      `SCORES DÉTAILLÉS :`,
      ...metrics.map(m => `  ${m.label} : ${m.score}/100`),
      '',
      `POINTS CLÉS :`,
      ...analysis.keyInsights.map(i => `  + ${i}`),
      '',
      `SIGNAUX D'ALERTE :`,
      ...analysis.redFlags.map(r => `  ! ${r}`),
      '',
      `PROCHAINES ÉTAPES :`,
      ...analysis.nextSteps.map(s => `  → ${s}`),
    ].join('\n')

    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `entretien-${candidateName}.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
      <Link href="/recruiter/dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline transition-opacity hover:opacity-80"
        style={{ color: '#7c3aed' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
      </Link>
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="w-24 h-24 mx-auto relative">
          <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(11,29,81,0.08)" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={
              analysis.overallScore >= 70 ? '#10b981' : analysis.overallScore >= 50 ? '#f59e0b' : '#ef4444'
            } strokeWidth="3" strokeDasharray={`${analysis.overallScore} 100`} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{analysis.overallScore}</span>
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{candidateName}</h2>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold mt-2"
            style={{ background: recoBg.bg, color: recoBg.color }}>
            <Award className="h-4 w-4" />{recoBg.label}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{analysis.summary}</p>
      </div>

      {/* Score bars */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Scores détaillés</h3>
        {metrics.map(m => (
          <div key={m.label} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--color-text-muted)' }}>{m.label}</span>
              <span className="font-bold" style={{ color: 'var(--color-text)' }}>{m.score}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(11,29,81,0.08)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${m.score}%`,
                  background: m.score >= 70 ? '#10b981' : m.score >= 50 ? '#f59e0b' : '#ef4444',
                }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Key insights */}
        {analysis.keyInsights.length > 0 && (
          <div className="space-y-3 p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
              <TrendingUp className="h-3.5 w-3.5" style={{ color: '#10b981' }} />Points clés
            </h3>
            <ul className="space-y-2">
              {analysis.keyInsights.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2" style={{ color: 'var(--color-text-muted)' }}>
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#10b981' }} />{s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Red flags */}
        {analysis.redFlags.length > 0 && (
          <div className="space-y-3 p-5 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />Signaux d&apos;alerte
            </h3>
            <ul className="space-y-2">
              {analysis.redFlags.map((s, i) => (
                <li key={i} className="text-sm flex items-start gap-2" style={{ color: 'var(--color-text-muted)' }}>
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />{s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Next steps */}
      {analysis.nextSteps.length > 0 && (
        <div className="p-5 rounded-3xl space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 8px 24px -6px rgba(124,58,237,0.25)' }}>
          <h3 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2" style={{ color: '#7c3aed' }}>
            <Target className="h-3.5 w-3.5" />Prochaines étapes
          </h3>
          {analysis.nextSteps.map((s, i) => (
            <p key={i} className="text-sm flex items-start gap-2" style={{ color: 'var(--color-text)' }}>
              <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#7c3aed' }} />{s}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={downloadReport}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer' }}>
          <Download className="h-4 w-4" />Télécharger le rapport
        </button>
        <button onClick={onRestart}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all"
          style={{ background: 'rgba(11,29,81,0.04)', color: 'var(--color-text-muted)', border: 'none', cursor: 'pointer' }}>
          <RotateCcw className="h-4 w-4" />Nouvel entretien
        </button>
      </div>

      <p className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>Analysé par {analysis.analysedBy}</p>
    </div>
  )
}

// ── Interview room ────────────────────────────────────────────────
export function InterviewRoom({
  sessionId, candidateName, jobTitle, questions,
}: {
  sessionId: string
  candidateName: string
  jobTitle: string
  questions: InterviewQuestion[]
}) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [candidateInput, setCandidateInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null)
  const [phase, setPhase] = useState<'interview' | 'done' | 'analysing'>('interview')
  const [isPending, startTransition] = useTransition()
  const transcriptRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const current = showFollowUp && followUp
    ? { id: 'followup', text: followUp, category: 'behavioral' as const, aiGenerated: true }
    : questions[currentIdx]

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [transcript])

  // Auto-read question via Web Speech (if available)
  useEffect(() => {
    if ('speechSynthesis' in window && current) {
      const utter = new SpeechSynthesisUtterance(current.text)
      utter.lang = 'fr-FR'; utter.rate = 0.9
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utter)
    }
  }, [currentIdx, showFollowUp])

  function addToTranscript(role: TranscriptEntry['role'], content: string) {
    const entry: TranscriptEntry = { role, content, timestamp: new Date().toISOString() }
    setTranscript(prev => [...prev, entry])
    return entry
  }

  async function toggleRecording() {
    if (isRecording) {
      mediaRef.current?.stop()
      setIsRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = e => chunksRef.current.push(e.data)
      rec.onstop = () => stream.getTracks().forEach(t => t.stop())
      mediaRef.current = rec
      rec.start()
      setIsRecording(true)
    } catch { setIsRecording(false) }
  }

  function submitAnswer() {
    if (!candidateInput.trim()) return

    // Add interviewer question to transcript if not already
    if (!transcript.find(t => t.role === 'interviewer' && t.content === current.text)) {
      addToTranscript('interviewer', current.text)
    }
    addToTranscript('candidate', candidateInput)
    const answer = candidateInput
    setCandidateInput('')
    setFollowUp(null)
    setShowFollowUp(false)

    // Check for AI follow-up
    startTransition(async () => {
      const { followUp: fu } = await getAIFollowUp(transcript, current, answer)
      if (fu && !showFollowUp) {
        setFollowUp(fu)
        setShowFollowUp(true)
      } else {
        nextQuestion()
      }
    })
  }

  function nextQuestion() {
    setFollowUp(null)
    setShowFollowUp(false)
    if (currentIdx + 1 >= questions.length) {
      setPhase('done')
    } else {
      setCurrentIdx(i => i + 1)
      addToTranscript('interviewer', questions[currentIdx + 1].text)
    }
  }

  function startAnalysis() {
    setPhase('analysing')
    startTransition(async () => {
      const result = await analyseInterview(sessionId, transcript, jobTitle, [])
      if ('error' in result) { setPhase('done'); return }
      setAnalysis(result)
      setPhase('done')
    })
  }

  if (analysis) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }}>
        <AnalysisReport analysis={analysis} candidateName={candidateName} onRestart={() => { setAnalysis(null); setPhase('interview'); setCurrentIdx(0); setTranscript([]) }} />
      </div>
    )
  }

  if (phase === 'analysing') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }} className="flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative w-20 h-20 mx-auto">
            <div className="w-20 h-20 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(124,58,237,0.2)', borderTopColor: '#7c3aed' }} />
            <Brain className="h-7 w-7 absolute inset-0 m-auto" style={{ color: '#7c3aed' }} />
          </div>
          <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Analyse de l&apos;entretien en cours…</p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>L&apos;IA évalue la retranscription complète</p>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }} className="flex items-center justify-center">
        <div className="text-center max-w-md space-y-6 px-6">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline transition-opacity hover:opacity-80"
            style={{ color: '#7c3aed' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <CheckCircle2 className="h-16 w-16 mx-auto" style={{ color: '#10b981' }} />
          <div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Entretien terminé</h2>
            <p className="mt-2" style={{ color: 'var(--color-text-muted)' }}>{transcript.length} échanges enregistrés</p>
          </div>
          <button onClick={startAnalysis}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-sm"
            style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
            <Brain className="h-5 w-5" />Analyser avec l&apos;IA
          </button>
        </div>
      </div>
    )
  }

  const catColor: Record<string, string> = { intro: '#2563eb', technical: '#7c3aed', behavioral: '#10b981', motivation: '#f59e0b', closing: '#ef4444' }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }} className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
        <div className="flex items-center gap-3">
          <Link href="/recruiter/dashboard"
            className="p-2 rounded-xl no-underline transition-all shrink-0"
            style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Entretien IA · {jobTitle}</p>
            <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{candidateName}</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {currentIdx + 1} / {questions.length}
          </span>
          {/* Progress */}
          <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(11,29,81,0.08)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${((currentIdx) / questions.length) * 100}%`, background: '#7c3aed' }} />
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — transcript */}
        <div ref={transcriptRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {transcript.map((entry, i) => (
            <div key={i} className={`flex ${entry.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}>
              <div className="max-w-[70%] px-4 py-3 rounded-2xl text-sm"
                style={{
                  background: entry.role === 'interviewer' ? 'rgba(124,58,237,0.1)' : 'var(--color-surface)',
                  border: entry.role === 'interviewer' ? 'none' : '1px solid var(--color-border)',
                  borderRadius: entry.role === 'interviewer' ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
                  color: 'var(--color-text)',
                  boxShadow: entry.role === 'candidate' ? '0 4px 14px rgba(11,29,81,0.06)' : 'none',
                }}>
                {entry.content}
              </div>
            </div>
          ))}
        </div>

        {/* Right — current question + input */}
        <div className="w-[380px] flex flex-col" style={{ borderLeft: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          {/* Current question */}
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider"
                style={{ background: `${catColor[current?.category ?? 'intro']}18`, color: catColor[current?.category ?? 'intro'] }}>
                {current?.category}
              </span>
              {showFollowUp && (
                <span className="text-[10px] flex items-center gap-1" style={{ color: '#7c3aed' }}>
                  <Brain className="h-3 w-3" />Relance IA
                </span>
              )}
            </div>

            <div className="flex items-start gap-3">
              <Volume2 className="h-4 w-4 shrink-0 mt-1" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-base leading-relaxed" style={{ color: 'var(--color-text)' }}>{current?.text}</p>
            </div>
          </div>

          {/* Separator */}
          <div className="h-px mx-6" style={{ background: 'var(--color-border)' }} />

          {/* Input zone */}
          <div className="flex-1 p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
              <MessageSquare className="h-3.5 w-3.5" />
              Réponse du candidat
            </div>

            <textarea
              value={candidateInput}
              onChange={e => setCandidateInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submitAnswer() }}
              placeholder="Tapez ou dictez la réponse du candidat… (Ctrl+Entrée pour valider)"
              rows={6}
              className="flex-1 rounded-xl px-4 py-3 text-sm focus:outline-none resize-none leading-relaxed"
              style={{ background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)' }}
            />

            <div className="flex items-center gap-2">
              {/* Record button */}
              <button onClick={toggleRecording}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: isRecording ? 'rgba(239,68,68,0.1)' : 'rgba(11,29,81,0.03)',
                  border: isRecording ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--color-border)',
                  color: isRecording ? '#ef4444' : 'var(--color-text-muted)',
                }}>
                {isRecording ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
                {isRecording ? 'Stop' : 'Dicter'}
              </button>

              {/* Skip */}
              <button onClick={nextQuestion}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm transition-all"
                style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer' }}>
                <SkipForward className="h-4 w-4" />
              </button>

              {/* Submit */}
              <button onClick={submitAnswer} disabled={!candidateInput.trim() || isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                Valider
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
