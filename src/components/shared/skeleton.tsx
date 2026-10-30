import type { CSSProperties, ReactNode } from 'react'

// Formes grises de chargement (demande du 2026-10-30, espace recruteur) : à la place d'un voile plein écran, chaque
// élément qui charge est dessiné en gris, à sa place et à sa taille. Les changements de page ont en plus la barre de
// progression du haut (navigation-progress.tsx).

/**
 * Teinte selon le fond : light, pages claires du thème du site ; dark, bandeaux sombres (en-têtes des pages) ; admin,
 * pages claires .admin-light (appels d'offres).
 */
export type SkeletonTone = 'light' | 'dark' | 'admin'

const BACKGROUND: Record<SkeletonTone, string> = {
  light: 'color-mix(in srgb, var(--color-text) 9%, transparent)',
  dark: 'color-mix(in srgb, var(--hero-text, white) 14%, transparent)',
  admin: 'var(--admin-hover)',
}

/** Bloc gris qui pulse (immobile si l'utilisateur a demandé moins d'animations). */
export function Skeleton({ className = '', style, tone = 'light' }: { className?: string; style?: CSSProperties; tone?: SkeletonTone }) {
  return <div aria-hidden className={`animate-pulse motion-reduce:animate-none rounded-md ${className}`} style={{ background: BACKGROUND[tone], ...style }} />
}

/** Zone en cours de chargement, annoncée une fois aux lecteurs d'écran ; les formes elles-mêmes sont masquées. */
export function SkeletonRegion({ label = 'Chargement…', className, style, children }: { label?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
