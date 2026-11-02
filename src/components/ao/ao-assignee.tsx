'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserRound } from 'lucide-react'
import { control, fieldLabel, optionStyle } from '@/app/admin/candidats/labels'
import type { RecruiterOption } from '@/lib/recruiter-assignment'

// Recruteur affecté à un appel d'offres (page d'une offre de l'espace recruteur ; demande de Dav du 2026-10-31, reprise
// le 2026-11-02) : repris par l'offre publiée, gardés alignés ensuite (colonne « Recruteur » de « Mes offres »). Valeur =
// profil du recruteur (users.$id, ADR 0023).

interface Props {
  recruiters: RecruiterOption[]
  assigneeId: string
  published: boolean
  assign(recruiterId: string): Promise<{ error?: string; warning?: string }>
}

export function AoAssignee({ recruiters, assigneeId, published, assign }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(assigneeId)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [pending, startTransition] = useTransition()

  function change(next: string) {
    const previous = value
    setValue(next)
    setError('')
    setWarning('')
    startTransition(async () => {
      try {
        const result = await assign(next)
        if (result.error) {
          setValue(previous)
          setError(result.error)
          return
        }
        // Affectation faite, mais l'e-mail au recruteur (ou sa copie) n'est pas parti.
        if (result.warning) setWarning(result.warning)
        router.refresh()
      } catch {
        setValue(previous)
        setError('Affectation impossible : connexion interrompue, réessayez.')
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
            {recruiters.map(r => <option key={r.id} value={r.id} style={optionStyle}>{r.name}</option>)}
          </select>
          {pending && <Loader2 size={16} className="animate-spin" aria-label="Enregistrement…" style={{ color: 'var(--admin-fg-muted)' }} />}
        </div>
      </div>
      <p className="text-xs flex-1 min-w-[200px]" style={{ color: 'var(--admin-fg-muted)' }}>
        {published
          ? 'L’offre est publiée : le même recruteur lui est affecté dans « Mes offres » du tableau de bord.'
          : 'À la publication, l’offre publiée sera affectée à ce recruteur.'}
        {' '}Le recruteur choisi est prévenu par e-mail, vous en copie.
      </p>
      {error && <p role="alert" className="w-full text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
      {warning && <p role="alert" className="w-full text-xs" style={{ color: '#b45309' }}>{warning}</p>}
    </section>
  )
}
