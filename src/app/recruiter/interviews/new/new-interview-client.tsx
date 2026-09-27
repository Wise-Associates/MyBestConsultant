'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Brain, Loader2, ChevronRight, Plus, Trash2, Edit3, Sparkles, Mail, Copy, Check, ArrowLeft } from 'lucide-react'
import { generateInterviewQuestions, createInterviewSession, type InterviewQuestion, type InterviewPrefill } from '../actions'
import { sendInterviewInvitationEmail } from '@/app/recruiter/screening/actions'

const CAT_LABELS: Record<string, string> = {
  intro: 'Introduction', technical: 'Technique', behavioral: 'Comportemental',
  motivation: 'Motivation', closing: 'Clôture',
}
const CAT_COLORS: Record<string, string> = {
  intro: '#2563eb', technical: '#7c3aed', behavioral: '#10b981', motivation: '#f59e0b', closing: '#ef4444',
}

export function NewInterviewClient({ initialForm, prefilled, appId, jobId }: { initialForm: InterviewPrefill; prefilled: boolean; appId: string; jobId: string }) {
  const [step, setStep] = useState<'config' | 'questions' | 'sent'>('config')
  const [form, setForm] = useState({ ...initialForm, questionCount: 8 })
  const [mediaMode, setMediaMode] = useState<'audio' | 'video'>('audio')
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [interviewLink, setInterviewLink] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [copied, setCopied] = useState(false)

  function set(k: keyof typeof form, v: string | number) { setForm(p => ({ ...p, [k]: v })) }

  function generateQuestions() {
    setError('')
    startTransition(async () => {
      const res = await generateInterviewQuestions(
        form.jobTitle, form.jobDescription,
        form.jobSkills.split(',').map(s => s.trim()).filter(Boolean),
        form.cvSummary, form.questionCount,
      )
      if ('error' in res) { setError(res.error); return }
      setQuestions(res)
      setStep('questions')
    })
  }

  function startInterview() {
    startTransition(async () => {
      const res = await createInterviewSession(
        appId, jobId, form.candidateName, form.candidateEmail, form.jobTitle, questions,
      )
      if ('error' in res) { setError(res.error); return }

      const suffix = mediaMode === 'video' ? '?mode=video' : ''
      setInterviewLink(`${window.location.origin}/interview/${res.sessionId}${suffix}`)

      const emailRes = await sendInterviewInvitationEmail({
        applicationId: appId || undefined, candidateEmail: form.candidateEmail,
        sessionId: res.sessionId, jobTitle: form.jobTitle, candidateName: form.candidateName, mediaMode,
      })
      if (emailRes.error) setEmailError(emailRes.error)
      else setEmailSent(true)

      setStep('sent')
    })
  }

  function copyLink() {
    navigator.clipboard.writeText(interviewLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inputStyle = {
    background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)',
    color: 'var(--color-text)',
  } as const

  if (step === 'sent') return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: 'rgba(16,185,129,0.12)' }}>
          {emailSent ? <Mail className="h-7 w-7" style={{ color: '#10b981' }} /> : <Brain className="h-7 w-7" style={{ color: '#10b981' }} />}
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>Entretien créé pour {form.candidateName}</h1>
        {emailSent ? (
          <p className="text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
            L&apos;invitation a été envoyée par email à <span style={{ color: 'var(--color-text)' }}>{form.candidateEmail}</span>.
            Le candidat pourra passer l&apos;entretien IA depuis le lien reçu.
          </p>
        ) : (
          <p className="text-sm mb-8" style={{ color: '#b45309' }}>
            L&apos;email n&apos;a pas pu être envoyé automatiquement ({emailError}). Copiez le lien ci-dessous et envoyez-le vous-même au candidat.
          </p>
        )}

        <div className="flex items-center gap-2 p-3 rounded-xl mb-8" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
          <span className="flex-1 text-sm truncate text-left px-1" style={{ color: 'var(--color-text-muted)' }}>{interviewLink}</span>
          <button onClick={copyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all"
            style={{ background: copied ? 'rgba(16,185,129,0.14)' : 'rgba(124,58,237,0.12)', color: copied ? '#10b981' : '#7c3aed' }}>
            {copied ? <><Check className="h-3.5 w-3.5" />Copié</> : <><Copy className="h-3.5 w-3.5" />Copier le lien</>}
          </button>
        </div>

        <Link href="/recruiter/dashboard"
          className="inline-flex items-center gap-2 text-sm transition-all no-underline"
          style={{ color: '#7c3aed' }}>
          <ArrowLeft className="h-4 w-4" />Retour au tableau de bord
        </Link>
      </div>
    </div>
  )

  if (step === 'questions') return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Questions générées</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{form.candidateName} · {form.jobTitle}</p>
          </div>
          <button onClick={() => setStep('config')}
            className="text-sm px-3 py-1.5 rounded-lg transition-all"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer' }}>
            ← Modifier
          </button>
        </div>

        <div className="space-y-3 mb-8">
          {questions.map((q, i) => (
            <div key={q.id} className="p-4 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              <div className="flex items-start gap-3">
                <span className="text-xs font-bold w-6 shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Q{i + 1}</span>
                {editing === q.id ? (
                  <textarea value={q.text} rows={3} className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                    style={{ background: 'white', border: '1px solid rgba(37,99,235,0.4)', color: 'var(--color-text)' }}
                    onChange={e => setQuestions(prev => prev.map(x => x.id === q.id ? { ...x, text: e.target.value } : x))}
                    onBlur={() => setEditing(null)} autoFocus />
                ) : (
                  <p className="flex-1 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{q.text}</p>
                )}
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditing(q.id)} className="p-1.5 rounded-lg transition-all" style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setQuestions(prev => prev.filter(x => x.id !== q.id))}
                    className="p-1.5 rounded-lg transition-all" style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 ml-9 flex items-center gap-1.5">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: `${CAT_COLORS[q.category]}18`, color: CAT_COLORS[q.category] }}>
                  {CAT_LABELS[q.category]}
                </span>
                {q.id.startsWith('gq-') && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text-muted)' }}>
                    Par défaut
                  </span>
                )}
              </div>
            </div>
          ))}

          <button onClick={() => setQuestions(prev => [...prev, {
            id: `custom-${Date.now()}`, text: '', category: 'technical', aiGenerated: false,
          }])}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm transition-all"
            style={{ border: '1.5px dashed var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer' }}>
            <Plus className="h-4 w-4" />Ajouter une question
          </button>
        </div>

        {error && <p className="text-sm mb-4" style={{ color: '#ef4444' }}>{error}</p>}

        <button onClick={startInterview} disabled={questions.length === 0 || isPending}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-base disabled:opacity-40 transition-all"
          style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
          {isPending ? <><Loader2 className="h-5 w-5 animate-spin" />Envoi au candidat…</>
            : <><Mail className="h-5 w-5" />Envoyer l&apos;entretien au candidat</>}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-xl mx-auto px-6 py-10">
        <Link href="/recruiter/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
          style={{ color: '#c4b5fd' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.18)' }}>
            <Brain className="h-6 w-6" style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Nouvel entretien IA</h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>L&apos;IA génère les questions et analyse les réponses</p>
          </div>
        </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-10">
        {prefilled && (
          <div className="flex items-center gap-2 mb-6 px-4 py-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid rgba(16,185,129,0.35)', boxShadow: '0 8px 24px -6px rgba(16,185,129,0.25)' }}>
            <Sparkles className="h-4 w-4 shrink-0" style={{ color: '#10b981' }} />
            <p className="text-sm" style={{ color: '#10b981' }}>Pré-rempli depuis la candidature — vérifiez et ajustez si besoin.</p>
          </div>
        )}

        <div className="space-y-5 p-6 rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
          {[
            { label: 'Nom du candidat', key: 'candidateName' as const, placeholder: 'Jean Dupont' },
            { label: 'Email du candidat', key: 'candidateEmail' as const, placeholder: 'jean@exemple.fr' },
            { label: 'Titre du poste', key: 'jobTitle' as const, placeholder: 'Développeur React Senior' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
              <input value={form[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder}
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
                style={inputStyle} />
            </div>
          ))}

          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Compétences requises</label>
            <input value={form.jobSkills} onChange={e => set('jobSkills', e.target.value)} placeholder="React, TypeScript, Node.js, AWS (séparées par virgules)"
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
              style={inputStyle} />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Description du poste</label>
            <textarea value={form.jobDescription} onChange={e => set('jobDescription', e.target.value)}
              placeholder="Description du rôle, responsabilités, contexte…" rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
              style={inputStyle} />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Résumé du CV (optionnel)</label>
            <textarea value={form.cvSummary} onChange={e => set('cvSummary', e.target.value)}
              placeholder="Parcours, expériences clés, formations…" rows={3}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none resize-none"
              style={inputStyle} />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>
              Nombre de questions : <span style={{ color: 'var(--color-text)' }}>{form.questionCount}</span>
            </label>
            <input type="range" min={4} max={15} value={form.questionCount} onChange={e => set('questionCount', Number(e.target.value))}
              className="w-full accent-violet-600" />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--color-text-muted)' }}>Format de l&apos;entretien</label>
            <div className="flex gap-2">
              {([
                { key: 'audio' as const, label: 'Audio', desc: 'Voix uniquement' },
                { key: 'video' as const, label: 'Vidéo', desc: 'Caméra activée' },
              ]).map(opt => (
                <button key={opt.key} type="button" onClick={() => setMediaMode(opt.key)}
                  className="flex-1 px-4 py-3 rounded-xl text-left transition-all"
                  style={mediaMode === opt.key
                    ? { background: 'rgba(124,58,237,0.12)', border: '1.5px solid #7c3aed' }
                    : { background: 'rgba(11,29,81,0.03)', border: '1.5px solid var(--color-border)' }}>
                  <span className="block text-sm font-semibold" style={{ color: mediaMode === opt.key ? '#7c3aed' : 'var(--color-text)' }}>{opt.label}</span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-sm mt-4" style={{ color: '#ef4444' }}>{error}</p>}

        <button onClick={generateQuestions}
          disabled={!form.candidateName || !form.jobTitle || isPending}
          className="w-full mt-8 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-base disabled:opacity-40 transition-all"
          style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
          {isPending ? <><Loader2 className="h-5 w-5 animate-spin" />Génération des questions…</>
            : <><Brain className="h-5 w-5" />Générer les questions <ChevronRight className="h-4 w-4" /></>}
        </button>
      </div>
    </div>
  )
}
