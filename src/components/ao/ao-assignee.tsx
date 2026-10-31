'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserRound } from 'lucide-react'
import { control, fieldLabel, optionStyle } from '@/app/admin/candidats/labels'

// Recruteur affecté à un appel d'offres (page d'une offre de l'espace recruteur ; demande de Dav du 2026-10-31) :
// à la publication, l'offre arrive dans son « Mon espace ».

interface Props {
  recruiters: { userId: string; name: string }[]
  assigneeId: string
  published: boolean
  assign(userId: string): Promise<{ error?: string }>
}

export function AoAssignee({ recruiters, assigneeId, published, assign }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(assigneeId)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function change(next: string) {
    const previous = value
    setValue(next)
    setError('')
    startTransition(async () => {
      const result = await assign(next)
      if (result.error) {
        setValue(previous)
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <section aria-label="Recruteur affecté" className="rounded-xl p-4 flex flex-wrap items-end gap-x-4 gap-y-2"
      style={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }}>
      <div className="flex flex-col">
        <label htmlFor="ao-assignee" style={fieldLabel}>Recruteur affecté</label>
        <div className="flex items-center gap-2">
          <UserRound size={16} aria-hidden style={{ color: 'var(--admin-fg-subtle)' }} />
          <select id="ao-assignee" value={value} disabled={pending} onChange={e => change(e.target.value)} style={{ ...control, minWidth: 220 }}>
            <option value="" style={optionStyle}>Non affecté</option>
            {recruiters.map(r => <option key={r.userId} value={r.userId} style={optionStyle}>{r.name}</option>)}
          </select>
          {pending && <Loader2 size={16} className="animate-spin" aria-label="Enregistrement…" style={{ color: 'var(--admin-fg-muted)' }} />}
        </div>
      </div>
      <p className="text-xs flex-1 min-w-[200px]" style={{ color: 'var(--admin-fg-muted)' }}>
        {published
          ? 'L’offre est publiée : elle est dans « Mon espace » du recruteur affecté.'
          : 'À la publication, l’offre arrivera dans « Mon espace » du recruteur affecté.'}
      </p>
      {error && <p role="alert" className="w-full text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
    </section>
  )
}
