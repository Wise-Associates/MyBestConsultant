'use client'

import { useState, useTransition } from 'react'
import { Loader2, Send, CheckCircle2 } from 'lucide-react'
import { submitEmailReply } from './actions'

export function ReplyForm({ token }: { token: string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  if (done) {
    return (
      <div className="text-center py-6 space-y-2">
        <CheckCircle2 className="h-10 w-10 mx-auto" style={{ color: '#10b981' }} />
        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Réponse envoyée</p>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Le recruteur a été prévenu. Merci !</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} maxLength={3000}
        placeholder="Écrivez votre réponse…"
        className="w-full px-4 py-3 rounded-xl text-sm outline-none"
        style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', color: 'var(--color-text)', lineHeight: 1.7, resize: 'vertical' }} />
      {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>}
      <button disabled={pending || !text.trim()}
        onClick={() => { setError(''); start(async () => { const r = await submitEmailReply(token, text); if (r.error) setError(r.error); else setDone(true) }) }}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: 'var(--color-primary)', color: 'white' }}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer ma réponse
      </button>
    </div>
  )
}
