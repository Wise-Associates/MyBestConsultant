'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Brain, Plus, Trash2, Check, Loader2, Info, ListChecks } from 'lucide-react'
import { saveGenericQuestions, type GenericQuestion } from '../generic-questions-actions'

const CAT_LABELS: Record<GenericQuestion['category'], string> = {
  intro: 'Introduction', technical: 'Technique', behavioral: 'Comportemental',
  motivation: 'Motivation', closing: 'Clôture',
}
const CAT_COLORS: Record<GenericQuestion['category'], string> = {
  intro: '#2563eb', technical: '#7c3aed', behavioral: '#10b981', motivation: '#f59e0b', closing: '#ef4444',
}

export function GenericQuestionsClient({ initialQuestions }: { initialQuestions: GenericQuestion[] }) {
  const [questions, setQuestions] = useState<GenericQuestion[]>(initialQuestions)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function update(id: string, patch: Partial<GenericQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q))
    setSaved(false)
  }

  function remove(id: string) {
    setQuestions(prev => prev.filter(q => q.id !== id))
    setSaved(false)
  }

  function add() {
    setQuestions(prev => [...prev, { id: `gq-${Date.now()}`, text: '', category: 'behavioral', enabled: true }])
    setSaved(false)
  }

  function save() {
    setError('')
    startTransition(async () => {
      const res = await saveGenericQuestions(questions.filter(q => q.text.trim()))
      if (res.error) { setError(res.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  const enabledCount = questions.filter(q => q.enabled).length

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <Link href="/recruiter/interviews"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour aux entretiens
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.18)' }}>
              <ListChecks className="h-6 w-6" style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Questions génériques</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Incluses automatiquement dans chaque nouvel entretien IA</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-2xl" style={{ background: 'var(--color-surface)', border: '1px solid rgba(124,58,237,0.3)', boxShadow: '0 8px 24px -6px rgba(124,58,237,0.25)' }}>
          <Info className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#7c3aed' }} />
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Les questions cochées sont ajoutées en tête de liste à chaque génération d&apos;entretien (aux côtés des questions générées par l&apos;IA pour le poste). Décochez ou supprimez celles que vous ne souhaitez plus utiliser par défaut — vous pourrez toujours les retirer au cas par cas avant l&apos;envoi de chaque entretien.
          </p>
        </div>

        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
            {enabledCount} question{enabledCount > 1 ? 's' : ''} active{enabledCount > 1 ? 's' : ''} sur {questions.length}
          </p>
        </div>

        <div className="space-y-3">
          {questions.map(q => (
            <div key={q.id} className="rounded-3xl p-4 transition-all duration-300"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: q.enabled ? '0 10px 30px -10px rgba(124,58,237,0.2)' : '0 8px 24px rgba(11,29,81,0.06)', opacity: q.enabled ? 1 : 0.55 }}>
              <div className="flex items-start gap-3">
                <button onClick={() => update(q.id, { enabled: !q.enabled })}
                  className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-1 transition-all"
                  style={{ borderColor: q.enabled ? '#7c3aed' : 'var(--color-border)', background: q.enabled ? '#7c3aed' : 'transparent' }}>
                  {q.enabled && <Check className="h-3 w-3 text-white" />}
                </button>

                <div className="flex-1 min-w-0 space-y-2">
                  <textarea
                    value={q.text}
                    onChange={e => update(q.id, { text: e.target.value })}
                    placeholder="Texte de la question…"
                    rows={2}
                    className="w-full text-sm rounded-xl px-3 py-2 focus:outline-none resize-none"
                    style={{ background: 'rgba(11,29,81,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(CAT_LABELS) as GenericQuestion['category'][]).map(cat => (
                      <button key={cat} onClick={() => update(q.id, { category: cat })}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide transition-all"
                        style={q.category === cat
                          ? { background: CAT_COLORS[cat], color: 'white' }
                          : { background: `${CAT_COLORS[cat]}14`, color: CAT_COLORS[cat] }}>
                        {CAT_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={() => remove(q.id)}
                  className="p-2 rounded-xl transition-all shrink-0"
                  style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button onClick={add}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm transition-all"
            style={{ border: '1.5px dashed var(--color-border)', color: 'var(--color-text-muted)', background: 'none', cursor: 'pointer' }}>
            <Plus className="h-4 w-4" />Ajouter une question générique
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
          </div>
        )}

        <div className="flex justify-end sticky bottom-6">
          <button onClick={save} disabled={isPending}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-sm transition-all disabled:opacity-60"
            style={{ background: saved ? '#10b981' : '#7c3aed', color: 'white', boxShadow: '0 8px 20px rgba(124,58,237,0.3)' }}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Brain className="h-4 w-4" />}
            {isPending ? 'Enregistrement…' : saved ? 'Enregistré !' : 'Enregistrer les questions'}
          </button>
        </div>
      </div>
    </div>
  )
}
