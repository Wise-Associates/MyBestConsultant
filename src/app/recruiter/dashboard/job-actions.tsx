'use client'

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { Loader2, Pencil, MoreHorizontal, RefreshCw, Sparkles, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { toggleJobStatusAction, deleteJobAction } from './actions'
import { JobEditModal } from '@/app/admin/jobs/job-edit-modal'
import type { JobState } from '@/lib/recruiter-dashboard'
import type { Job } from '@/types'

const iconButton = 'w-10 h-10 rounded-[10px] flex items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text) disabled:opacity-50'
const item = 'w-full h-[38px] px-2.5 rounded-[9px] flex items-center gap-2.5 text-left text-[13px] font-medium no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)] focus-visible:outline-none focus-visible:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)]'

// Actions d'une ligne de « Mes offres » : « Modifier » et le menu « Autres actions ». Une offre partagée de la plateforme
// (tenantId '') n'a que « Voir le matching IA » : le serveur refuse de la modifier pour un recruteur.
export function JobActions({ job, state, shared, matchingHref, canRepublish, onRepublish }: {
  job: Job; state: JobState; shared: boolean; matchingHref: string
  /** Offre en ligne déjà diffusée, aucune diffusion en cours : « Republier sur les réseaux ». */
  canRepublish: boolean; onRepublish: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Menu ouvert : focus sur le premier choix ; Échap ou un clic ailleurs le ferment.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  function toggleArchive() {
    setOpen(false)
    setError(null)
    start(async () => {
      try {
        const r = await toggleJobStatusAction(job.$id, !job.isActive)
        if (r.error) setError(r.error)
      } catch {
        setError('L’offre n’a pas pu être modifiée. Réessayez.')
      }
    })
  }

  function remove() {
    setOpen(false)
    if (!confirm(`Supprimer l'offre "${job.title}" ? Cette action est irréversible.`)) return
    setError(null)
    start(async () => {
      try {
        const r = await deleteJobAction(job.$id)
        if (r.error) setError(r.error)
      } catch {
        setError('L’offre n’a pas pu être supprimée. Réessayez.')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {!shared && (
          <button type="button" onClick={() => setEditing(true)} aria-label={`Modifier l’offre ${job.title}`} title="Modifier"
            className={iconButton} style={{ color: 'var(--color-text-muted)' }}>
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        )}
        <div className="relative">
          <button ref={buttonRef} type="button" onClick={() => setOpen(o => !o)} disabled={pending}
            aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`Autres actions pour ${job.title}`}
            className={iconButton} style={{ color: 'var(--color-text-muted)', background: open ? 'color-mix(in srgb, var(--color-text) 7%, transparent)' : undefined }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
          </button>
          {open && (
            <div ref={menuRef} id={menuId} role="menu" aria-label="Actions de l’offre" onKeyDown={onMenuKey}
              className="absolute right-0 top-full mt-1 z-20 w-[240px] p-1.5 rounded-[14px] flex flex-col gap-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(28,28,30,0.12)' }}>
              {canRepublish && (
                <button type="button" role="menuitem" className={item} style={{ color: 'var(--color-text)' }} onClick={() => { setOpen(false); onRepublish() }}>
                  <RefreshCw className="h-3.75 w-3.75" aria-hidden />Republier sur les réseaux
                </button>
              )}
              <Link href={matchingHref} role="menuitem" className={item} style={{ color: 'var(--color-text)' }}>
                <Sparkles className="h-3.75 w-3.75" aria-hidden />Voir le matching IA
              </Link>
              {!shared && (
                <>
                  <button type="button" role="menuitem" className={item} style={{ color: 'var(--color-text)' }} onClick={toggleArchive}>
                    {state === 'archived'
                      ? <><ArchiveRestore className="h-3.75 w-3.75" aria-hidden />Remettre en ligne</>
                      : <><Archive className="h-3.75 w-3.75" aria-hidden />Archiver l’offre</>}
                  </button>
                  <div role="separator" className="h-px mx-1.5 my-1" style={{ background: 'var(--color-border)' }} />
                  <button type="button" role="menuitem" className={item} style={{ color: '#b91c1c' }} onClick={remove}>
                    <Trash2 className="h-3.75 w-3.75" aria-hidden />Supprimer l’offre…
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-[11px] text-right max-w-44" style={{ color: '#b91c1c' }}>{error}</p>}

      {editing && (
        <JobEditModal
          job={{
            $id: job.$id,
            title: job.title,
            companyName: job.companyName,
            location: job.location,
            contractType: job.contractType,
            remote: job.remote,
            salary: job.salary,
            skills: job.skills,
            description: job.description,
            isActive: job.isActive,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); window.location.reload() }}
        />
      )}
    </div>
  )
}
