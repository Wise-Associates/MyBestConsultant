'use client'

import { useState, useTransition } from 'react'
import { Star, Loader2, CheckCircle2, Check } from 'lucide-react'
import { submitRecommendation } from './actions'

export function RecommendationForm({ requestId, expertises = [] }: { requestId: string; expertises?: string[] }) {
  const [endorsed, setEndorsed] = useState<string[]>(expertises)
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError('')
    if (rating === 0) { setError('Merci de choisir une note'); return }
    if (!comment.trim()) { setError('Merci de laisser un commentaire'); return }
    if (expertises.length > 0 && endorsed.length === 0) { setError('Confirmez au moins une expertise'); return }
    startTransition(async () => {
      const result = await submitRecommendation(requestId, { comment, rating, endorsed })
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
        <CheckCircle2 style={{ width: 44, height: 44, color: '#10b981', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '1.1rem', margin: '0 0 6px' }}>
          Merci pour votre recommandation !
        </p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Elle a bien été transmise.
        </p>
      </div>
    )
  }

  const inp = 'w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors'
  const inpStyle = { background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-semibold mb-2 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          Note
        </label>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, transition: 'transform 0.15s ease' }}
              className="hover:scale-110"
            >
              <Star
                style={{ width: 28, height: 28 }}
                color="#E8A33D"
                fill={(hoverRating || rating) >= n ? '#E8A33D' : 'none'}
              />
            </button>
          ))}
        </div>
      </div>

      {expertises.length > 0 && (
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
            Expertises que vous recommandez
          </label>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>Décochez celles pour lesquelles vous ne pouvez pas vous prononcer.</p>
          <div className="flex flex-wrap gap-1.5">
            {expertises.map(e => {
              const on = endorsed.includes(e)
              return (
                <button key={e} type="button" onClick={() => setEndorsed(l => (l.includes(e) ? l.filter(x => x !== e) : [...l, e]))} aria-pressed={on}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={on ? { background: 'rgba(232,163,61,0.2)', color: '#8a6a1f', border: '1px solid rgba(232,163,61,0.6)' } : { background: 'transparent', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }}>
                  {on && <Check className="h-3 w-3" />}{e}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
          Votre commentaire
        </label>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={5}
          className={inp}
          style={{ ...inpStyle, resize: 'vertical' }}
          placeholder="Décrivez votre expérience de collaboration…"
        />
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-85"
        style={{ background: 'var(--color-primary)', color: 'white' }}
      >
        {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Envoi…</> : 'Envoyer ma recommandation'}
      </button>
    </div>
  )
}
