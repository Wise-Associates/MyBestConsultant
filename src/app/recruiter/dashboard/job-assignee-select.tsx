'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserRound } from 'lucide-react'
import { assignJobAction } from './actions'

// Recruteur affecté à une offre, dans sa ligne de « Mes offres » (demande du 2026-11-02). Une offre publiée depuis un
// appel d'offres garde le même recruteur que l'AO (assignJobAction).

export function JobAssigneeSelect({ jobId, jobTitle, assigneeId, recruiters }: {
  jobId: string
  jobTitle: string
  assigneeId: string
  recruiters: { userId: string; name: string }[]
}) {
  const router = useRouter()
  const [value, setValue] = useState(assigneeId)
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  // Recruteur affecté qui n'est plus dans l'équipe (parti) : gardé dans la liste pour ne pas afficher « Non affectée ».
  const known = !value || recruiters.some(r => r.userId === value)

  function change(next: string) {
    const previous = value
    setValue(next)
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await assignJobAction(jobId, next)
        if (result.error) {
          setValue(previous)
          setMessage({ tone: 'error', text: result.error })
          return
        }
        if (result.warning) setMessage({ tone: 'warning', text: result.warning })
        router.refresh()
      } catch {
        setValue(previous)
        setMessage({ tone: 'error', text: 'Affectation impossible : connexion interrompue, réessayez.' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="inline-flex items-center gap-1.5 text-[13px] min-w-0" style={{ color: 'var(--color-text-muted)' }}>
        <UserRound className="h-3.25 w-3.25 shrink-0" aria-hidden />
        <span className="sr-only">Recruteur affecté à {jobTitle}</span>
        <select value={value} disabled={pending} onChange={e => change(e.target.value)} title="Le recruteur choisi est prévenu par e-mail, vous en copie."
          className="max-w-56 truncate bg-transparent border-0 p-0 pr-1 text-[13px] font-medium cursor-pointer rounded-sm hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text) disabled:opacity-60"
          style={{ color: value ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
          <option value="">Non affectée</option>
          {!known && <option value={value}>Recruteur hors de l’équipe</option>}
          {recruiters.map(r => <option key={r.userId} value={r.userId}>{r.name}</option>)}
        </select>
        {pending && <Loader2 className="h-3.25 w-3.25 animate-spin shrink-0" aria-label="Enregistrement…" />}
      </label>
      {message && (
        <p role="alert" className="text-[11px]" style={{ color: message.tone === 'error' ? '#b91c1c' : '#b45309' }}>{message.text}</p>
      )}
    </div>
  )
}
