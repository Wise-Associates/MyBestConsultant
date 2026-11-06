'use client'

import { useEffect, useId, useRef, useState, useTransition, type CSSProperties } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Loader2, UserRound } from 'lucide-react'
import { startNavigationProgress } from '@/components/shared/navigation-progress'
import { RECRUITERS_PARAM, recruiterSelectionParam, type RecruiterSelection } from '@/lib/recruiter-job-filters'
import type { RecruiterOption } from '@/lib/recruiter-assignment'

// Filtre « Recruteurs » de « Mes offres » (demande du 2026-11-03) : choix multiple appliqué par le serveur. Les cases
// préparent la sélection, « Appliquer » relit la page avec `?recruteurs=` (indicateurs, tuiles et liste suivent) ;
// Échap ou un clic ailleurs referme sans rien changer.

const EMPTY: RecruiterSelection = { ids: [], unassigned: false }
const muted: CSSProperties = { color: 'var(--color-text-muted)' }

export function RecruiterFilter({ recruiters, selection, currentRecruiterId }: {
  recruiters: RecruiterOption[]
  /** Sélection appliquée (null : toutes les offres). */
  selection: RecruiterSelection | null
  /** Profil du recruteur connecté : en tête de liste, « (vous) ». */
  currentRecruiterId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RecruiterSelection>(selection ?? EMPTY)
  const [pending, startTransition] = useTransition()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const ordered = [
    ...recruiters.filter(r => r.id === currentRecruiterId),
    ...recruiters.filter(r => r.id !== currentRecruiterId),
  ]
  const nameOf = (r: RecruiterOption) => (r.id === currentRecruiterId ? `${r.name} (vous)` : r.name)
  const chosen = selection ? [
    ...ordered.filter(r => selection.ids.includes(r.id)).map(r => (r.id === currentRecruiterId ? 'Vous' : r.name)),
    ...(selection.unassigned ? ['Non affectées'] : []),
  ] : []
  const label = chosen.length === 0 ? 'Tous les recruteurs' : chosen.length <= 2 ? chosen.join(', ') : `${chosen.length} choix`

  const close = () => setOpen(false)
  // Le panneau s'ouvre sur la sélection appliquée : elle a pu changer sans lui (« Tous les recruteurs » au-dessus des
  // indicateurs, page précédente du navigateur).
  const openPanel = () => {
    setDraft(selection ?? EMPTY)
    setOpen(true)
  }

  // Clic ou tabulation hors du panneau : referme sans appliquer. `focusin` plutôt que la perte du focus : Safari ne donne
  // pas le focus à un bouton cliqué, le panneau se fermerait avant le clic sur « Appliquer ».
  useEffect(() => {
    if (!open) return
    const onOutside = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('focusin', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('focusin', onOutside)
    }
  }, [open])

  function apply(next: RecruiterSelection) {
    setOpen(false)
    setDraft(next)
    const value = recruiterSelectionParam(next)
    if (value === (selection ? recruiterSelectionParam(selection) : '')) return
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(RECRUITERS_PARAM, value)
    else params.delete(RECRUITERS_PARAM)
    // ?offre= ne sert qu'à l'arrivée depuis le suivi d'un AO : sans objet après un changement de filtre.
    params.delete('offre')
    const query = params.toString()
    startNavigationProgress()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  const toggle = (id: string) => setDraft(d => ({ ...d, ids: d.ids.includes(id) ? d.ids.filter(x => x !== id) : [...d.ids, id] }))

  return (
    <div ref={rootRef} className="relative"
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
          triggerRef.current?.focus()
        }
      }}>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId}
        onClick={() => (open ? close() : openPanel())}
        className="w-full sm:w-auto min-[90rem]:w-full h-11 sm:h-10 px-3 rounded-xl inline-flex items-center gap-2 text-[13px] font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)"
        style={{
          background: chosen.length ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
          border: `1px solid ${chosen.length ? 'var(--color-primary)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
        }}>
        <UserRound aria-hidden className="h-4 w-4 shrink-0" style={muted} />
        <span className="sr-only">Recruteurs : </span>
        <span className="truncate max-w-56 min-[90rem]:max-w-none text-left flex-1">{label}</span>
        {pending
          ? <Loader2 role="img" className="h-4 w-4 shrink-0 animate-spin" aria-label="Chargement des offres…" style={muted} />
          : <ChevronDown aria-hidden className="h-4 w-4 shrink-0" style={muted} />}
      </button>

      {open && (
        <div id={panelId} role="dialog" aria-label="Filtrer par recruteur"
          className="absolute left-0 right-0 sm:right-auto top-full mt-1 z-20 sm:w-72 p-1.5 rounded-[14px] flex flex-col"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(28,28,30,0.12)' }}>
          <fieldset className="flex flex-col max-h-72 overflow-y-auto">
            <legend className="px-2.5 pt-1.5 pb-1 text-xs font-semibold" style={muted}>Offres affectées à</legend>
            {ordered.map((r, i) => (
              <label key={r.id} className="flex items-center gap-2.5 min-h-10 px-2.5 rounded-[10px] text-[13px] cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)]"
                style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={draft.ids.includes(r.id)} onChange={() => toggle(r.id)} autoFocus={i === 0}
                  className="h-4 w-4 shrink-0 accent-(--color-primary)" />
                <span className="truncate">{nameOf(r)}</span>
              </label>
            ))}
            <label className="flex items-center gap-2.5 min-h-10 px-2.5 mt-1 pt-1 rounded-[10px] text-[13px] cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)]"
              style={{ color: 'var(--color-text)', borderTop: '1px solid var(--color-border)' }}>
              <input type="checkbox" checked={draft.unassigned} onChange={() => setDraft(d => ({ ...d, unassigned: !d.unassigned }))}
                autoFocus={ordered.length === 0} className="h-4 w-4 shrink-0 accent-(--color-primary)" />
              <span>Non affectées</span>
            </label>
          </fieldset>
          <div className="flex items-center justify-between gap-2 px-1 pt-2 mt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={() => apply(EMPTY)}
              className="h-9 px-2.5 rounded-[10px] text-[13px] font-semibold cursor-pointer bg-transparent border-0 hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-(--color-text)"
              style={{ color: 'var(--color-text)' }}>
              Tous les recruteurs
            </button>
            <button type="button" onClick={() => apply(draft)}
              className="h-9 px-3.5 rounded-[10px] text-[13px] font-semibold cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-(--color-primary)"
              style={{ background: 'var(--color-primary)', border: '1px solid var(--color-primary)', color: 'var(--color-primary-fg)' }}>
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
