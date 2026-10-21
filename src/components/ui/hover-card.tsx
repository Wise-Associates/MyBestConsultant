'use client'

import { useId, useRef, useState, type ReactNode } from 'react'

/**
 * Carte d'information ouverte au survol, au focus clavier ou au toucher d'un petit déclencheur (« +3 ») : pour montrer
 * la liste complète d'éléments abrégés sans agrandir la ligne. Position fixe, calculée à l'ouverture : la carte n'est
 * pas coupée par un conteneur qui défile (tableau). Échap la ferme. Le déclencheur n'ouvre pas la ligne qui le contient.
 */
export function HoverCard({ label, ariaLabel, children }: { label: string; ariaLabel: string; children: ReactNode }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)) })
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
        className="text-[11px] px-1.5 py-0.5 rounded-md focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{ color: 'var(--admin-fg-muted, var(--color-text-muted))', border: '1px solid var(--admin-line, var(--color-border))' }}
      >
        {label}
      </button>
      {position && (
        <span
          role="tooltip"
          id={id}
          className="fixed z-50 w-[280px] p-3 rounded-xl text-xs"
          style={{
            top: position.top, left: position.left,
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
