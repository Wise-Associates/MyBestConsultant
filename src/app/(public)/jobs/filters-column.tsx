'use client'

import { useEffect, useRef, type ReactNode } from 'react'

// Colonne des critères de /jobs sur grand écran : collée sous la barre du site et défilant seule. Sa hauteur suit la
// place visible (de son haut, sous le bandeau tant que la page n'a pas défilé, jusqu'au bas de l'écran) : le bas de la
// colonne, où sont « Rechercher les offres » et « Effacer tous les filtres », reste toujours à l'écran (demande du
// 2026-11-13). Une hauteur fixe en CSS le faisait passer sous l'écran tant que la page n'avait pas défilé.

const STICKY_TOP = 84 // barre du site (68 px) et marge
const BOTTOM_GAP = 20

export function FiltersColumn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const desktop = window.matchMedia('(min-width: 1024px)')
    let frame = 0
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!desktop.matches) {
          el.style.maxHeight = ''
          return
        }
        const top = Math.max(STICKY_TOP, el.getBoundingClientRect().top)
        el.style.maxHeight = `${Math.max(240, window.innerHeight - top - BOTTOM_GAP)}px`
      })
    }
    fit()
    window.addEventListener('scroll', fit, { passive: true })
    window.addEventListener('resize', fit)
    desktop.addEventListener('change', fit)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', fit)
      window.removeEventListener('resize', fit)
      desktop.removeEventListener('change', fit)
    }
  }, [])

  return (
    <aside ref={ref} aria-label="Critères de recherche"
      className="mbc-sticky-aside w-full lg:w-72 shrink-0 lg:sticky lg:top-[84px] lg:overflow-y-auto flex flex-col gap-2">
      {children}
    </aside>
  )
}
