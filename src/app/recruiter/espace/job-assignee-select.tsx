'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignJobAction } from './actions'

// Recruteur affecté à un recrutement, dans la vue « Toute l'équipe » de « Mon espace ».

export function JobAssigneeSelect({ jobId, jobTitle, assigneeId, recruiters }: {
  jobId: string
  jobTitle: string
  assigneeId: string
  recruiters: { userId: string; name: string }[]
}) {
  const router = useRouter()
  const [value, setValue] = useState(assigneeId)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function change(next: string) {
    const previous = value
    setValue(next)
    setError('')
    startTransition(async () => {
      const result = await assignJobAction(jobId, next)
      if (result.error) {
        setValue(previous)
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <select value={value} disabled={pending} onChange={e => change(e.target.value)} aria-label={`Recruteur affecté à ${jobTitle}`}
        className="text-xs rounded-lg px-2 py-1.5 max-w-[180px]"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', opacity: pending ? 0.6 : 1 }}>
        <option value="">Non affecté</option>
        {recruiters.map(r => <option key={r.userId} value={r.userId}>{r.name}</option>)}
      </select>
      {error && <p role="alert" className="text-[11px]" style={{ color: '#b91c1c' }}>{error}</p>}
    </div>
  )
}
