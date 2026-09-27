'use client'

import { useState, useTransition } from 'react'
import { Loader2, Send, CheckCircle2 } from 'lucide-react'
import { sendVerificationEmailAction } from './actions'

export function ResendButton() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function resend() {
    setError(null)
    startTransition(async () => {
      const result = await sendVerificationEmailAction()
      if (result.error) setError(result.error)
      else setSent(true)
    })
  }

  return (
    <div className="space-y-3">
      <button onClick={resend} disabled={isPending}
        className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
        style={{ background: '#B8860B', color: 'white' }}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {isPending ? 'Envoi…' : sent ? 'Email renvoyé !' : 'Renvoyer l\'email de vérification'}
      </button>
      {error && (
        <p className="text-sm px-4 py-2.5 rounded-xl"
          style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
