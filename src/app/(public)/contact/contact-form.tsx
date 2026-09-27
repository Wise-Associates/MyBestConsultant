'use client'

import { useState, useTransition } from 'react'
import { Loader2, CheckCircle2, Send } from 'lucide-react'
import { submitContactForm } from './actions'

export function ContactForm() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const inp = 'w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors'
  const inpStyle = {
    background: 'rgba(11,29,81,0.04)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  function submit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await submitContactForm(formData)
      if (result.error) setError(result.error)
      else setSent(true)
    })
  }

  if (sent) {
    return (
      <div className="rounded-2xl p-8 text-center"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Message envoyé !</p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Nous vous répondrons dans les plus brefs délais.</p>
      </div>
    )
  }

  return (
    <form action={submit} className="rounded-2xl p-8 space-y-4"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Nom</label>
          <input name="name" required className={inp} style={inpStyle} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Email</label>
          <input name="email" type="email" required className={inp} style={inpStyle} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Sujet</label>
        <input name="subject" className={inp} style={inpStyle} />
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1.5 uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Message</label>
        <textarea name="message" rows={6} required className={inp} style={{ ...inpStyle, resize: 'vertical' }} />
      </div>

      {error && (
        <p className="text-sm px-4 py-2.5 rounded-xl"
          style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}

      <button type="submit" disabled={isPending}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
        style={{ background: 'var(--color-primary)', color: 'white' }}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {isPending ? 'Envoi…' : 'Envoyer le message'}
      </button>
    </form>
  )
}
