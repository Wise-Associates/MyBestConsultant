'use client'

import { useState, useTransition, useEffect } from 'react'
import {
  Brain, MessageSquare, X, Loader2, Send, CheckCircle2,
  Plus, Trash2, Edit3, Copy, Check,
} from 'lucide-react'
import { prepareInterviewFromScreening, sendInterviewInvitationEmail, sendCustomMessage } from './actions'
import type { InterviewQuestion } from '@/app/recruiter/interviews/actions'

const CAT_LABELS: Record<string, string> = {
  intro: 'Intro', technical: 'Technique', behavioral: 'Comportemental',
  motivation: 'Motivation', closing: 'Clôture',
}
const CAT_COLORS: Record<string, string> = {
  intro: '#2563eb', technical: '#7c3aed', behavioral: '#10b981',
  motivation: '#f59e0b', closing: '#ef4444',
}

interface Props {
  applicationId: string
  jobId: string
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  candidateName: string
  candidateEmail: string
  screeningSummary: string
}

// ── Interview invite modal ─────────────────────────────────────────
function InterviewModal({ props, onClose }: { props: Props; onClose: () => void }) {
  const [step, setStep] = useState<'generating' | 'review' | 'sent'>('generating')
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [sessionId, setSessionId] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [isSending, startSendTransition] = useTransition()

  const interviewLink = sessionId
    ? `${window.location.origin}/interview/${sessionId}`
    : ''

  function generate() {
    setError('')
    startTransition(async () => {
      const res = await prepareInterviewFromScreening(props)
      if ('error' in res) { setError(res.error); return }
      setQuestions(res.questions)
      setSessionId(res.sessionId)
      setStep('review')
    })
  }

  // Auto-generate on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { generate() }, [])

  function copyLink() {
    navigator.clipboard.writeText(interviewLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function sendInvite() {
    setSendError('')
    startSendTransition(async () => {
      const res = await sendInterviewInvitationEmail({
        applicationId: props.applicationId,
        candidateEmail: props.candidateEmail,
        sessionId,
        jobTitle: props.jobTitle,
        candidateName: props.candidateName,
      })
      if (res.error) { setSendError(res.error); return }
      setStep('sent')
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,10,30,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget && step !== 'generating') onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 640, maxHeight: '88vh',
        borderRadius: 24, overflow: 'hidden',
        background: 'var(--color-surface)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.75rem', background: 'var(--hero-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(124,58,237,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Brain style={{ width: 20, height: 20, color: '#c4b5fd' }} />
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Entretien IA</p>
              <p style={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>{props.candidateName}</p>
            </div>
          </div>
          {step !== 'generating' && (
            <button onClick={onClose} style={{ padding: 8, borderRadius: 8, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer' }}>
              <X style={{ width: 20, height: 20 }} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

          {/* Generating */}
          {step === 'generating' && (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(124,58,237,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <Brain style={{ width: 28, height: 28, color: '#7c3aed', animation: 'pulse 2s ease-in-out infinite' }} />
              </div>
              <p style={{ color: 'var(--color-text)', fontWeight: 700, marginBottom: '0.5rem' }}>
                Génération des questions…
              </p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                L&apos;IA analyse le profil et le poste pour générer des questions pertinentes
              </p>
              {error && (
                <div style={{ marginTop: '1.5rem', padding: '0.875rem', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.85rem' }}>
                  {error}
                  <button onClick={generate} style={{ marginTop: '0.75rem', display: 'block', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}>
                    Réessayer
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Review questions */}
          {step === 'review' && (
            <div className="space-y-4">
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
                {questions.length} questions générées • Modifiez si besoin avant d&apos;envoyer l&apos;invitation
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {questions.map((q, i) => (
                  <div key={q.id} style={{ borderRadius: 14, border: '1px solid var(--color-border)', background: 'rgba(11,29,81,0.03)', padding: '0.875rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', minWidth: 24, paddingTop: 2 }}>Q{i + 1}</span>
                      {editing === q.id ? (
                        <textarea
                          defaultValue={q.text}
                          rows={3}
                          autoFocus
                          style={{ flex: 1, background: 'white', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 8, padding: '0.5rem 0.75rem', color: 'var(--color-text)', fontSize: '0.875rem', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
                          onChange={e => setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, text: e.target.value } : x))}
                          onBlur={() => setEditing(null)}
                        />
                      ) : (
                        <p style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.6 }}>{q.text}</p>
                      )}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={() => setEditing(q.id)}
                          style={{ padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Edit3 style={{ width: 14, height: 14 }} />
                        </button>
                        <button onClick={() => setQuestions(prev => prev.filter(x => x.id !== q.id))}
                          style={{ padding: 6, borderRadius: 6, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 style={{ width: 14, height: 14 }} />
                        </button>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, marginLeft: 32, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: CAT_COLORS[q.category], background: `${CAT_COLORS[q.category]}18`, padding: '2px 8px', borderRadius: 20 }}>
                        {CAT_LABELS[q.category]}
                      </span>
                      {q.id.startsWith('gq-') && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', background: 'rgba(11,29,81,0.06)', padding: '2px 8px', borderRadius: 20 }}>
                          Par défaut
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => setQuestions(prev => [...prev, { id: `custom-${Date.now()}`, text: '', category: 'technical', aiGenerated: false }])}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: 14, border: '1.5px dashed var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer', fontSize: '0.85rem', width: '100%' }}>
                  <Plus style={{ width: 15, height: 15 }} />Ajouter une question
                </button>
              </div>

              {/* Link preview */}
              <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: 14, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)' }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Lien d&apos;entretien candidat</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <p style={{ flex: 1, fontSize: '0.8rem', color: '#7c3aed', fontFamily: 'monospace', wordBreak: 'break-all' }}>{interviewLink}</p>
                  <button onClick={copyLink}
                    style={{ padding: '6px 12px', borderRadius: 8, background: copied ? 'rgba(16,185,129,0.14)' : 'rgba(124,58,237,0.14)', color: copied ? '#10b981' : '#7c3aed', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {copied ? <><Check style={{ width: 13, height: 13 }} />Copié</> : <><Copy style={{ width: 13, height: 13 }} />Copier</>}
                  </button>
                </div>
              </div>

              {sendError && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.8rem' }}>
                  {sendError}
                </div>
              )}
            </div>
          )}

          {/* Sent */}
          {step === 'sent' && (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <CheckCircle2 style={{ width: 56, height: 56, color: '#10b981', margin: '0 auto 1.5rem' }} />
              <p style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Invitation envoyée !</p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                L&apos;email a été envoyé à {props.candidateEmail}.
              </p>
              <button onClick={copyLink}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto', padding: '0.625rem 1.25rem', borderRadius: 10, background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}>
                {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                {copied ? 'Copié !' : 'Copier le lien aussi'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div style={{ padding: '1.25rem 1.75rem', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
            <button onClick={onClose}
              style={{ flex: 1, padding: '0.75rem', borderRadius: 14, border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>
              Annuler
            </button>
            <button onClick={sendInvite} disabled={isSending}
              style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: 14, background: '#7c3aed', color: 'white', border: 'none', cursor: isSending ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.9rem', opacity: isSending ? 0.7 : 1, boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
              {isSending ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <Send style={{ width: 16, height: 16 }} />}
              {isSending ? 'Envoi…' : 'Envoyer l\'invitation par email'}
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  )
}

// ── Custom message modal ───────────────────────────────────────────
function MessageModal({ props, onClose }: { props: Props; onClose: () => void }) {
  const [subject, setSubject] = useState(`Votre candidature — ${props.jobTitle}`)
  const [body, setBody] = useState(`Bonjour ${props.candidateName},\n\nNous avons bien examiné votre candidature pour le poste de ${props.jobTitle} et nous souhaitons vous contacter.\n\n`)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')
  const [isSending, startSendTransition] = useTransition()

  function send() {
    setSendError('')
    startSendTransition(async () => {
      const res = await sendCustomMessage({ applicationId: props.applicationId, subject, message: body })
      if (res.error) { setSendError(res.error); return }
      setSent(true)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,10,30,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 560,
        borderRadius: 24, overflow: 'hidden',
        background: 'var(--color-surface)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
      }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.75rem', background: 'var(--hero-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(59,130,246,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquare style={{ width: 20, height: 20, color: '#93c5fd' }} />
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Message personnalisé</p>
              <p style={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>{props.candidateName}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer' }}>
            <X style={{ width: 20, height: 20 }} />
          </button>
        </div>

        {/* Body */}
        {sent ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <CheckCircle2 style={{ width: 52, height: 52, color: '#10b981', margin: '0 auto 1.25rem' }} />
            <p style={{ color: 'var(--color-text)', fontWeight: 700, marginBottom: '0.5rem' }}>Message envoyé !</p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>L&apos;email a été envoyé à {props.candidateEmail}.</p>
            <button onClick={onClose} style={{ marginTop: '1.5rem', padding: '0.625rem 1.5rem', borderRadius: 10, background: 'rgba(11,29,81,0.05)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.875rem' }}>
              Fermer
            </button>
          </div>
        ) : (
          <div style={{ padding: '1.5rem 1.75rem' }}>
            {/* To */}
            <div style={{ padding: '0.625rem 0.875rem', borderRadius: 12, background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', minWidth: 30 }}>À</span>
              <span style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{props.candidateEmail}</span>
            </div>

            {/* Subject */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Objet</label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)', fontSize: '0.875rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            {/* Body */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Message</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={8}
                style={{ width: '100%', padding: '0.875rem 1rem', borderRadius: 12, background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)', fontSize: '0.875rem', lineHeight: 1.7, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>

            {sendError && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.8rem' }}>
                {sendError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={onClose}
                style={{ flex: 1, padding: '0.75rem', borderRadius: 14, border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>
                Annuler
              </button>
              <button onClick={send} disabled={isSending}
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: 14, background: '#2563eb', color: 'white', border: 'none', cursor: isSending ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.9rem', opacity: isSending ? 0.7 : 1, boxShadow: '0 8px 20px rgba(37,99,235,0.3)' }}>
                {isSending ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <Send style={{ width: 16, height: 16 }} />}
                {isSending ? 'Envoi…' : 'Envoyer le message'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────
export function ResultActions(props: Props) {
  const [modal, setModal] = useState<'interview' | 'message' | null>(null)

  return (
    <>
      <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setModal('interview')}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.625rem 1rem', borderRadius: 12, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.22)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, transition: 'all 0.15s' }}
        >
          <Brain style={{ width: 15, height: 15 }} />
          Inviter à un entretien IA
        </button>

        <button
          onClick={() => setModal('message')}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.625rem 1rem', borderRadius: 12, background: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.18)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, transition: 'all 0.15s' }}
        >
          <MessageSquare style={{ width: 15, height: 15 }} />
          Message personnalisé
        </button>
      </div>

      {modal === 'interview' && (
        <InterviewModal props={props} onClose={() => setModal(null)} />
      )}
      {modal === 'message' && (
        <MessageModal props={props} onClose={() => setModal(null)} />
      )}
    </>
  )
}
