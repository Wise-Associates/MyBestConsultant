'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { setAlertEmailsAction } from './actions'

// Interrupteur « Recevoir un e-mail » de la page Alertes : enregistré aussitôt dans les préférences du compte.

export function AlertEmailsToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !enabled
    setError(null)
    startTransition(async () => {
      const res = await setAlertEmailsAction(next)
      if (res.error) setError(res.error)
      else setEnabled(next)
    })
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5">
      <div className="flex items-center gap-2.5">
        {pending && <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--color-text-muted)' }} aria-hidden />}
        <span id="alert-emails-label" className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {enabled ? 'E-mails activés' : 'E-mails coupés'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="alert-emails-label"
          disabled={pending}
          onClick={toggle}
          className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          style={{ background: enabled ? 'var(--color-brand-orange)' : 'var(--color-border)' }}
        >
          <span
            className="inline-block h-5 w-5 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? 'translateX(22px)' : 'translateX(2px)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
          />
        </button>
      </div>
      {error && <p role="alert" className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
    </div>
  )
}
