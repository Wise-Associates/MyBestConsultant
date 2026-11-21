'use client'

import { useRef, useState, useTransition } from 'react'
import { Edit3, FileUp, Loader2, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react'
import type { InterviewQuestion } from '@/app/recruiter/interviews/actions'
import { importInterviewQuestionsFile, tuneInterviewQuestions } from '@/app/recruiter/interviews/question-tools-actions'
import { IMPORT_LIMITS } from '@/lib/interview-question-parser'

// Questions d'un entretien IA (ADR 0054), même présentation que /recruiter/interviews/new, partagée avec la fenêtre
// « Entretien IA » du pipeline : questions générées par l'IA ou écrites par le recruteur (champ « Ajouter »), importées
// d'un fichier PDF ou TXT, puis ajustées par l'IA (« Ajuster avec l'IA », annulable). Les questions par défaut de
// l'organisation (identifiant « gq- ») ne sont pas retravaillées par l'IA.

export const QUESTION_CATEGORY_LABELS: Record<InterviewQuestion['category'], string> = {
  intro: 'Introduction', technical: 'Technique', behavioral: 'Comportemental', motivation: 'Motivation', closing: 'Clôture',
}
const CAT_COLORS: Record<InterviewQuestion['category'], string> = {
  intro: '#2563eb', technical: '#7c3aed', behavioral: '#10b981', motivation: '#f59e0b', closing: '#ef4444',
}
const CATEGORIES = Object.keys(QUESTION_CATEGORY_LABELS) as InterviewQuestion['category'][]
/** Plafond d'un entretien (sessionInputSchema). */
const MAX_QUESTIONS = IMPORT_LIMITS.maxQuestions

const isDefault = (q: InterviewQuestion) => q.id.startsWith('gq-')

/** Poste et candidat donnés à l'IA pour adapter les questions, et nombre de questions de tout l'entretien. */
export interface TuningContext {
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  cvSummary: string
  /** Questions par défaut comprises (comme la génération, aiQuestionPlan). */
  questionCount: number
}

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' } as const
const field = { background: 'white', border: '1px solid rgba(37,99,235,0.4)', color: 'var(--color-text)' } as const
const toolButton = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

export function InterviewQuestionsEditor({ questions, onChange, tuning, disabled = false }: {
  questions: InterviewQuestion[]
  onChange: (next: InterviewQuestion[]) => void
  tuning: TuningContext
  disabled?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftCategory, setDraftCategory] = useState<InterviewQuestion['category']>('technical')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Liste d'avant « Ajuster avec l'IA », pour revenir en arrière ; oubliée dès qu'une question change ensuite.
  const [beforeTuning, setBeforeTuning] = useState<InterviewQuestion[] | null>(null)
  const [importing, startImport] = useTransition()
  const [tuningPending, startTuning] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const busy = disabled || importing || tuningPending
  const own = questions.filter(q => !isDefault(q) && q.text.trim())
  const full = questions.length >= MAX_QUESTIONS

  function change(next: InterviewQuestion[]) {
    setBeforeTuning(null)
    onChange(next)
  }

  function add() {
    const text = draft.trim()
    if (!text || full) return
    change([...questions, { id: `custom-${Date.now().toString(36)}`, text: text.slice(0, IMPORT_LIMITS.maxChars), category: draftCategory, aiGenerated: false }])
    setDraft('')
  }

  function importFile(file: File) {
    setNotice(null)
    const form = new FormData()
    form.append('file', file)
    startImport(async () => {
      const res = await importInterviewQuestionsFile(form)
      if ('error' in res) { setNotice({ tone: 'error', text: res.error }); return }
      // Une question déjà dans la liste n'est pas ajoutée deux fois ; 30 questions au plus par entretien.
      const known = new Set(questions.map(q => q.text.trim().toLowerCase()))
      const fresh = res.questions.filter(q => !known.has(q.text.toLowerCase()))
      const added = fresh.slice(0, Math.max(0, MAX_QUESTIONS - questions.length))
      change([...questions, ...added])
      const left = fresh.length - added.length
      const parts = [`${added.length} question${added.length > 1 ? 's' : ''} importée${added.length > 1 ? 's' : ''} depuis « ${file.name} » : relisez-les avant d’envoyer.`]
      if (fresh.length < res.questions.length) parts.push(`${res.questions.length - fresh.length} déjà dans la liste.`)
      if (left > 0 || res.truncated) parts.push(`${MAX_QUESTIONS} questions au plus par entretien : la suite n’a pas été reprise.`)
      setNotice({ tone: 'ok', text: parts.join(' ') })
    })
  }

  function tune() {
    setNotice(null)
    const previous = questions
    startTuning(async () => {
      // Nombre choisi = tout l'entretien : l'IA complète les questions du recruteur jusqu'au nombre choisi, questions par
      // défaut de la liste déduites.
      const target = Math.max(0, tuning.questionCount - previous.filter(isDefault).length)
      const res = await tuneInterviewQuestions({ ...tuning, questionCount: target, questions: own })
      if ('error' in res) { setNotice({ tone: 'error', text: res.error }); return }
      onChange([...previous.filter(isDefault), ...res.questions])
      setBeforeTuning(previous)
      setEditing(null)
      setNotice({ tone: 'ok', text: 'Questions ajustées par l’IA : relisez-les avant d’envoyer.' })
    })
  }

  function undoTuning() {
    if (!beforeTuning) return
    onChange(beforeTuning)
    setBeforeTuning(null)
    setNotice(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || full}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={toolButton}>
          {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
          {importing ? 'Lecture du fichier…' : 'Importer un fichier (PDF, TXT)'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,application/pdf,text/plain" hidden
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importFile(file) }} />
        <button type="button" onClick={tune} disabled={busy || own.length === 0}
          title={own.length === 0 ? 'Ajoutez ou importez des questions à ajuster' : 'Reformuler vos questions et compléter la liste'}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }}>
          {tuningPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {tuningPending ? 'Ajustement…' : 'Ajuster avec l’IA'}
        </button>
      </div>

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-xl text-sm"
          style={notice.tone === 'error'
            ? { background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }
            : { background: 'rgba(16,185,129,0.08)', color: '#047857' }}>
          <span>{notice.text}</span>
          {beforeTuning && (
            <button type="button" onClick={undoTuning} className="inline-flex items-center gap-1 font-semibold underline">
              <Undo2 className="h-3.5 w-3.5" aria-hidden />Annuler l’ajustement
            </button>
          )}
        </div>
      )}

      {questions.map((q, i) => (
        <div key={q.id} className="p-4 rounded-2xl" style={card}>
          <div className="flex items-start gap-3">
            <span className="text-xs font-bold w-6 shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Q{i + 1}</span>
            {editing === q.id ? (
              <div className="flex-1 space-y-2">
                <textarea value={q.text} rows={3} autoFocus aria-label={`Question ${i + 1}`} maxLength={IMPORT_LIMITS.maxChars}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" style={field}
                  onChange={e => change(questions.map(x => x.id === q.id ? { ...x, text: e.target.value } : x))} />
                <div className="flex items-center gap-2">
                  <select value={q.category} aria-label={`Catégorie de la question ${i + 1}`}
                    onChange={e => change(questions.map(x => x.id === q.id ? { ...x, category: e.target.value as InterviewQuestion['category'] } : x))}
                    className="px-2 py-1.5 rounded-lg text-xs focus:outline-none" style={field}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{QUESTION_CATEGORY_LABELS[c]}</option>)}
                  </select>
                  <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: '#7c3aed', color: 'white' }}>Terminer</button>
                </div>
              </div>
            ) : (
              <p className="flex-1 text-sm leading-relaxed" style={{ color: q.text.trim() ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {q.text.trim() || 'Question vide : modifiez-la ou supprimez-la.'}
              </p>
            )}
            <div className="flex gap-1 shrink-0">
              <button type="button" onClick={() => setEditing(editing === q.id ? null : q.id)} disabled={busy} aria-label={`Modifier la question ${i + 1}`}
                className="p-1.5 rounded-lg transition-all" style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Edit3 className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => change(questions.filter(x => x.id !== q.id))} disabled={busy} aria-label={`Supprimer la question ${i + 1}`}
                className="p-1.5 rounded-lg transition-all" style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <div className="mt-2 ml-9 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: `${CAT_COLORS[q.category]}18`, color: CAT_COLORS[q.category] }}>
              {QUESTION_CATEGORY_LABELS[q.category]}
            </span>
            {isDefault(q) && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text-muted)' }}>
                Par défaut
              </span>
            )}
          </div>
        </div>
      ))}

      <form onSubmit={e => { e.preventDefault(); add() }} className="flex flex-col sm:flex-row gap-2 p-3 rounded-2xl"
        style={{ border: '1.5px dashed var(--color-border)' }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} disabled={busy || full} maxLength={IMPORT_LIMITS.maxChars}
          placeholder={full ? `${MAX_QUESTIONS} questions au plus par entretien` : 'Écrire une question…'} aria-label="Nouvelle question"
          className="flex-1 px-3 py-2 rounded-xl text-sm focus:outline-none" style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        <select value={draftCategory} onChange={e => setDraftCategory(e.target.value as InterviewQuestion['category'])} disabled={busy || full}
          aria-label="Catégorie de la nouvelle question" className="px-2 py-2 rounded-xl text-sm focus:outline-none"
          style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {CATEGORIES.map(c => <option key={c} value={c}>{QUESTION_CATEGORY_LABELS[c]}</option>)}
        </select>
        <button type="submit" disabled={busy || full || !draft.trim()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: '#7c3aed', color: 'white' }}>
          <Plus className="h-4 w-4" aria-hidden />Ajouter
        </button>
      </form>
    </div>
  )
}
