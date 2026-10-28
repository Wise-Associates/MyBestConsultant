'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Briefcase, FolderOpen } from 'lucide-react'

export type VivierView = 'general' | 'offres'

// Liste des offres d'abord : la vue par défaut (demande du 2026-10-28).
const TABS: { id: VivierView; label: string; Icon: typeof FolderOpen }[] = [
  { id: 'offres', label: 'Viviers par offre', Icon: Briefcase },
  { id: 'general', label: 'Vivier général', Icon: FolderOpen },
]

// « Mon vivier » montre une vue à la fois (demande du 2026-10-28 : les CV du vivier général ne doivent pas repousser
// la liste des offres). Les deux vues restent montées, masquées par `hidden` : un import ou une synchronisation en cours
// continue d'une vue à l'autre. Vue par défaut : la liste des offres ; le vivier général est gardé dans l'adresse
// (?vue=general), pour que « Précédent » le retrouve.
export function VivierTabs({ initialView, counts, general, offers }: {
  initialView: VivierView
  counts: Record<VivierView, number>
  general: ReactNode
  offers: ReactNode
}) {
  const [view, setView] = useState(initialView)
  const tabRefs = useRef<Partial<Record<VivierView, HTMLButtonElement | null>>>({})

  function select(next: VivierView) {
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'offres') url.searchParams.delete('vue')
    else url.searchParams.set('vue', next)
    window.history.replaceState(null, '', url)
  }

  // Flèches gauche / droite entre les onglets (motif ARIA des onglets).
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
    select(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Vues du vivier" className="flex w-full sm:inline-flex sm:w-auto gap-1 rounded-2xl p-1"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {TABS.map(({ id, label, Icon }, index) => {
          const active = view === id
          return (
            <button key={id} type="button" role="tab" id={`vivier-tab-${id}`} aria-selected={active} aria-controls={`vivier-panel-${id}`}
              tabIndex={active ? 0 : -1} ref={el => { tabRefs.current[id] = el }}
              onClick={() => select(id)} onKeyDown={e => onKeyDown(e, index)}
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
              style={active
                ? { background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }
                : { background: 'transparent', color: 'var(--color-text-muted)' }}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={active ? { background: 'rgba(255,255,255,0.18)' } : { background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)' }}>
                {counts[id]}
              </span>
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id="vivier-panel-general" aria-labelledby="vivier-tab-general" hidden={view !== 'general'}>{general}</div>
      <div role="tabpanel" id="vivier-panel-offres" aria-labelledby="vivier-tab-offres" hidden={view !== 'offres'}>{offers}</div>
    </div>
  )
}
