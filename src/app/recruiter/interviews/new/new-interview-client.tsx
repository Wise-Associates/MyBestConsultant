'use client'

import { useState, useTransition } from 'react'
import { BackLink } from '@/components/recruiter/back-link'
import { ArrowLeft, Brain, Loader2, ChevronRight, Sparkles, Mail, Copy, Check, PenLine } from 'lucide-react'
import { generateInterviewQuestions, createInterviewSession, type InterviewQuestion, type InterviewPrefill } from '../actions'
import { getEnabledGenericQuestions } from '../generic-questions-actions'
import { sendInterviewInvitationEmail } from '@/app/recruiter/screening/actions'
import { InterviewConfigForm, skillsOf } from '@/components/interviews/interview-config-form'
import { InterviewQuestionsEditor } from '@/components/interviews/interview-questions-editor'
import { interviewPath } from '@/lib/interview-room'

export function NewInterviewClient({ initialForm, prefilled, appId, jobId }: { initialForm: InterviewPrefill; prefilled: boolean; appId: string; jobId: string }) {
  const [step, setStep] = useState<'config' | 'questions' | 'sent'>('config')
  const [form, setForm] = useState({ ...initialForm, questionCount: 8 })
  const [mediaMode, setMediaMode] = useState<'audio' | 'video'>('audio')
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
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
        form.jobTitle, form.jobDescription, skillsOf(form), form.cvSummary, form.questionCount,
      )
      if ('error' in res) { setError(res.error); return }
      setQuestions(res)
      setStep('questions')
    })
  }

  // Sans génération par l'IA (ADR 0054) : les questions par défaut de l'organisation, puis celles que le recruteur écrit
  // ou importe ; l'IA peut ensuite les ajuster.
  function writeOwnQuestions() {
    setError('')
    startTransition(async () => {
      const defaults = await getEnabledGenericQuestions()
      setQuestions(defaults.map(q => ({ id: q.id, text: q.text, category: q.category, aiGenerated: false })))
      setStep('questions')
    })
  }

  function startInterview() {
    startTransition(async () => {
      // Question vidée dans l'éditeur : pas envoyée au candidat.
      const kept = questions.map(q => ({ ...q, text: q.text.trim() })).filter(q => q.text)
      const res = await createInterviewSession(
        appId, jobId, form.candidateName, form.candidateEmail, form.jobTitle, kept,
      )
      if ('error' in res) { setError(res.error); return }

      setInterviewLink(`${window.location.origin}${interviewPath(res.sessionId, mediaMode)}`)

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

  if (step === 'sent') return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: 'rgba(16,185,129,0.12)' }}>
          {emailSent ? <Mail className="h-7 w-7" style={{ color: '#10b981' }} /> : <Brain className="h-7 w-7" style={{ color: '#10b981' }} />}
        </div>
        <h1 className="mb-2" style={{ color: 'var(--color-text)', fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: 0 }}>Entretien créé pour {form.candidateName}</h1>
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

        <BackLink fallbackHref="/recruiter/interviews" iconClassName="h-4 w-4"
          className="inline-flex items-center gap-2 text-sm transition-all no-underline"
          style={{ color: '#7c3aed' }} />
      </div>
    </div>
  )

  if (step === 'questions') return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <StepHeader title="Questions de l’entretien" subtitle={`${form.candidateName} · ${form.jobTitle}`} action={
        <button onClick={() => setStep('config')} disabled={isPending}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg whitespace-nowrap transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ color: 'var(--color-text)', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <ArrowLeft className="h-4 w-4" aria-hidden />Modifier
        </button>
      } />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

        <div className="mb-8">
          <InterviewQuestionsEditor questions={questions} onChange={setQuestions} disabled={isPending}
            tuning={{ jobTitle: form.jobTitle, jobDescription: form.jobDescription, jobSkills: skillsOf(form), cvSummary: form.cvSummary, questionCount: form.questionCount }} />
        </div>

        {error && <p className="text-sm mb-4" style={{ color: '#ef4444' }}>{error}</p>}

        <button onClick={startInterview} disabled={!questions.some(q => q.text.trim()) || isPending}
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
      <StepHeader title="Nouvel entretien IA" subtitle="L’IA génère ou ajuste les questions et analyse les réponses" action={
        <BackLink fallbackHref="/recruiter/interviews" iconOnly
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg no-underline transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }} />
      } />

      <div className="max-w-xl mx-auto px-4 sm:px-6 py-6">
        {prefilled && (
          <div className="flex items-center gap-2 mb-6 px-4 py-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid rgba(16,185,129,0.35)', boxShadow: '0 8px 24px -6px rgba(16,185,129,0.25)' }}>
            <Sparkles className="h-4 w-4 shrink-0" style={{ color: '#10b981' }} />
            <p className="text-sm" style={{ color: '#10b981' }}>Pré-rempli depuis la candidature — vérifiez et ajustez si besoin.</p>
          </div>
        )}

        <InterviewConfigForm value={form} onChange={set} mediaMode={mediaMode} onMediaModeChange={setMediaMode} />

        {error && <p className="text-sm mt-4" style={{ color: '#ef4444' }}>{error}</p>}

        <button onClick={generateQuestions}
          disabled={!form.candidateName || !form.jobTitle || isPending}
          className="w-full mt-8 flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-base disabled:opacity-40 transition-all"
          style={{ background: '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
          {isPending ? <><Loader2 className="h-5 w-5 animate-spin" />Préparation des questions…</>
            : <><Brain className="h-5 w-5" />Générer les questions <ChevronRight className="h-4 w-4" /></>}
        </button>
        <button onClick={writeOwnQuestions}
          disabled={!form.candidateName || !form.jobTitle || isPending}
          className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm disabled:opacity-40 transition-all"
          style={{ background: 'var(--color-surface)', color: '#7c3aed', border: '1.5px solid rgba(124,58,237,0.35)' }}>
          <PenLine className="h-4 w-4" aria-hidden />Écrire ou importer mes questions
        </button>
      </div>
    </div>
  )
}

/**
 * En-tête d'une étape : une ligne (icône, titre, sous-titre, action), comme les autres pages de l'espace recruteur. Taille
 * des titres écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes.
 */
function StepHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3 min-h-16 px-4 sm:px-6 py-3" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.12)' }}>
        <Brain className="h-5 w-5" style={{ color: '#7c3aed' }} aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="truncate" style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: 0 }}>{title}</h1>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
      </div>
      {action}
    </header>
  )
}

