'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'

// Détails de l'offre dans le bandeau de ses pages (Matching IA, Funnel, Réponse client) : demande du 2026-11-17, le titre
// prenait trop de place. Un bouton « i » ouvre une fenêtre avec la vue, le titre, la ligne de l'offre et ce que la page
// y ajoute (`children`). Le titre reste le <h1> de la page, masqué à l'écran (sr-only), pour les lecteurs d'écran.
// Même comportement que « Statistiques » du funnel : fermée par un clic ailleurs, Échap (le focus revient au bouton).
export function JobInfoButton({ view, title, meta, children }: { view: string; title: string; meta?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

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

  return (
    <div ref={rootRef} className="relative"
      onKeyDown={e => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={`Détails de l’offre : ${title}`} title={title}
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hero-fg)"
        style={{ background: open ? 'var(--color-surface)' : 'var(--hero-control)', color: open ? 'var(--color-text)' : 'var(--hero-fg)', border: '1px solid var(--hero-line)' }}>
        <Info className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Détails de l’offre"
          className="absolute left-0 lg:left-auto lg:right-0 top-full mt-1.5 z-30 w-80 max-w-[calc(100vw-2rem)] p-4 rounded-[14px] text-left flex flex-col gap-1"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px rgba(28,28,30,0.18)' }}>
          <p className="text-[11px] font-semibold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>{view}</p>
          <p className="text-[15px] font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>{title}</p>
          {meta && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{meta}</p>}
          {children}
        </div>
      )}
    </div>
  )
}
