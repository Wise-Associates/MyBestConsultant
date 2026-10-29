'use client'

import { useId, useRef, useState, type ReactNode } from 'react'

/**
 * Carte d'information ouverte au survol, au focus clavier ou au toucher d'un petit déclencheur (« +3 ») : pour montrer
 * la liste complète d'éléments abrégés sans agrandir la ligne. Position fixe, calculée à l'ouverture : la carte n'est
 * pas coupée par un conteneur qui défile (tableau). Échap la ferme. Le déclencheur n'ouvre pas la ligne qui le contient.
 */
export function HoverCard({ label, ariaLabel, children, bare = false }: {
  label: ReactNode
  ariaLabel: string
  children: ReactNode
  /** Déclencheur sans cadre ni texte grisé : pour un déclencheur qui porte son propre style (icônes d'état…). */
  bare?: boolean
}) {
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 296))
    // Déclencheur dans la moitié basse de l'écran (dernières lignes d'un tableau) : la carte s'ouvre au-dessus, sinon
    // elle serait coupée par le bas de la fenêtre.
    setPosition(rect.top > window.innerHeight / 2 ? { bottom: window.innerHeight - rect.top + 6, left } : { top: rect.bottom + 6, left })
  }
  const close = () => setPosition(null)

  return (
    <span className="inline-flex" onMouseEnter={open} onMouseLeave={close}>
      <button
        ref={trigger}
        type="button"
        aria-label={ariaLabel}
        aria-describedby={position ? id : undefined}
        aria-expanded={position !== null}
        onClick={e => { e.stopPropagation(); if (position) close(); else open() }}
        onFocus={open}
        onBlur={close}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
        className={`${bare ? 'inline-flex' : 'text-[11px] px-1.5 py-0.5'} rounded-md focus-visible:ring-2 focus-visible:ring-offset-1`}
        style={bare ? undefined : { color: 'var(--admin-fg-muted, var(--color-text-muted))', border: '1px solid var(--admin-line, var(--color-border))' }}
      >
        {label}
      </button>
      {position && (
        <span
          role="tooltip"
          id={id}
          // whitespace-normal : la carte est souvent dans une cellule de tableau tronquée (nowrap), son texte doit revenir à la ligne.
          className="fixed z-50 w-[280px] p-3 rounded-xl text-xs whitespace-normal"
          style={{
            top: position.top, bottom: position.bottom, left: position.left,
            background: 'var(--admin-panel, var(--color-surface))', color: 'var(--admin-fg, var(--color-text))',
            border: '1px solid var(--admin-line, var(--color-border))', boxShadow: '0 12px 32px -12px rgba(0,0,0,0.25)',
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
