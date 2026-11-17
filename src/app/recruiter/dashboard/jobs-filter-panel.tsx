'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { muted, railHeading, railHeadingStyle } from '@/components/shared/list-styles'

// Bouton « Filtres » de « Mes offres » et son panneau (demande du 2026-11-17, à la place du rail de filtres de gauche) :
// statut, contrat, recruteurs et tuiles « À traiter ». Les choix s'appliquent à la liste dès qu'ils sont faits (comme
// avant) ; « Afficher N offres » referme le panneau. Le panneau se place sous l'en-tête de « Mes offres » (premier
// ancêtre positionné), pour rester dans l'écran quelle que soit la place du bouton.

export function JobsFilterPanel({ activeCount, shownCount, status, contract, recruiters, focus, onReset }: {
  /** Filtres actifs (statut, contrat, recruteurs, « À traiter ») : pastille du bouton. */
  activeCount: number
  /** Offres affichées avec les filtres actuels : « Afficher N offres ». */
  shownCount: number
  status: ReactNode
  contract: ReactNode
  /** Filtre « Recruteurs » ; absent quand l'équipe est illisible. */
  recruiters?: ReactNode
  focus: ReactNode
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const panelId = useId()

  // Ouvert : le focus entre dans le panneau ; un clic ou une tabulation hors du panneau le referme (les choix sont déjà
  // appliqués). `focusin` plutôt que la perte du focus : Safari ne donne pas le focus à un bouton cliqué.
  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onOutside = (e: Event) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('focusin', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('focusin', onOutside)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="contents"
      onKeyDown={e => {
        // Les listes « Contrat » et « Recruteurs » arrêtent l'Échap quand elles sont ouvertes : il les ferme d'abord.
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
        }
      }}>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(o => !o)}
        className="h-11 sm:h-10 px-3.5 rounded-xl inline-flex items-center gap-2 text-[13px] font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)"
        style={{
          background: activeCount > 0 || open ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
          border: `1px solid ${activeCount > 0 || open ? 'var(--color-primary)' : 'var(--color-border)'}`,
          color: 'var(--color-text)',
        }}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden />Filtres
        {activeCount > 0 && (
          <span className="min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center text-[11px] font-bold tabular-nums"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
            {activeCount}<span className="sr-only"> actifs</span>
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1}
          className="absolute left-4 right-4 sm:left-auto sm:right-6 top-full mt-1 z-30 sm:w-[600px] max-h-[80dvh] overflow-y-auto rounded-[20px] flex flex-col focus:outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 24px 60px rgba(28,28,30,0.16)' }}>
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <h2 id={titleId} className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Filtrer mes offres</h2>
            <button type="button" onClick={close} aria-label="Fermer les filtres"
              className="w-9 h-9 rounded-[10px] inline-flex items-center justify-center cursor-pointer bg-transparent border-0 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-(--color-text)"
              style={muted}>
              <X className="h-4.5 w-4.5" aria-hidden />
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
            <div role="group" aria-labelledby={`${panelId}-statut`}>
              <h3 id={`${panelId}-statut`} className={railHeading} style={railHeadingStyle}>Statut</h3>
              {status}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex flex-col">
                <h3 className={railHeading} style={railHeadingStyle}>Contrat</h3>
                {contract}
              </div>
              {recruiters && (
                <div className="flex flex-col">
                  <h3 className={railHeading} style={railHeadingStyle}>Recruteurs</h3>
                  {recruiters}
                </div>
              )}
            </div>
            <div role="group" aria-labelledby={`${panelId}-a-traiter`}>
              <h3 id={`${panelId}-a-traiter`} className={railHeading} style={railHeadingStyle}>À traiter</h3>
              {focus}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={onReset} disabled={activeCount === 0}
              className="h-10 px-3.5 rounded-[10px] text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Réinitialiser
            </button>
            <button type="button" onClick={close}
              className="h-10 px-4 rounded-[10px] text-[13px] font-semibold cursor-pointer border-0 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
              Afficher {shownCount} {shownCount > 1 ? 'offres' : 'offre'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
