'use client'

import { useState, useTransition } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { acceptInviteAction } from './actions'

export function JoinForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(formData: FormData) {
    formData.set('token', token)
    setError(null)
    startTransition(async () => {
      const res = await acceptInviteAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  const inp = 'w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-colors'
  const inpStyle = { background: 'rgba(11,29,81,0.04)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  return (
    <form action={submit} className="space-y-4">
      {(['password', 'confirm'] as const).map(name => (
        <div key={name} className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
          <input name={name} type="password" required minLength={8} autoComplete="new-password" className={inp} style={inpStyle}
            placeholder={name === 'password' ? 'Mot de passe (8 caractères min.)' : 'Confirmer le mot de passe'} />
        </div>
      ))}
      {error && <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', color: '#dc2626' }}>{error}</p>}
      <button type="submit" disabled={pending} className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
        style={{ background: 'var(--color-primary)', color: 'white' }}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? 'Activation…' : 'Rejoindre l’équipe'}
      </button>
    </form>
  )
}
