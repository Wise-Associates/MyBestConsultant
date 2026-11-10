'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, FolderOpen, LayoutDashboard, Send } from 'lucide-react'
import { isWideHunterPage } from '@/lib/hunter-dashboard'

const TABS = [
  { href: '/hunter/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/hunter/vivier', label: 'Mon vivier', icon: FolderOpen },
  { href: '/hunter/offres', label: 'Offres', icon: Briefcase },
  { href: '/hunter/propositions', label: 'Mes propositions', icon: Send },
]

/** Largeur à partir de 1440 px des pages en pleine largeur (isWideHunterPage). */
const WIDE = 'min-[90rem]:max-w-[1920px] min-[90rem]:px-8'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2'

/**
 * Rubriques de l'espace Chasseur, sous la barre du site (layout chasseur), comme le sous-menu de l'espace recruteur
 * (recruiter-subnav.tsx) : demande du 2026-11-10, à la place des onglets du grand bandeau sombre. 4 rubriques : une ligne
 * d'onglets à toutes les largeurs (défilement horizontal sur un petit écran, icônes dès 640 px).
 */
export function HunterSubnav() {
  const path = usePathname()
  return (
    <nav aria-label="Rubriques de l’espace chasseur" className="relative z-30"
      style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
      {/* Même largeur sur toutes les pages, tableau de bord compris (demande du 2026-11-10). */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <ul className="flex items-stretch gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => {
            const active = path === t.href || path.startsWith(t.href + '/')
            return (
              <li key={t.href} className="shrink-0">
                <Link href={t.href} aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-2 h-12 px-2.5 rounded-md text-sm whitespace-nowrap no-underline transition-colors ${focusRing} ${active ? 'font-semibold' : 'font-medium hover:bg-[var(--color-background)]'}`}
                  style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  <t.icon className="hidden sm:block h-4 w-4 shrink-0" aria-hidden />
                  {t.label}
                  {active && <span aria-hidden className="absolute left-2.5 right-2.5 bottom-0 h-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

/**
 * Page de l'espace Chasseur, directement sur le fond de la page, sans bandeau ni grand titre (demandes du 2026-11-10 :
 * place gagnée, comme l'espace recruteur ; la navigation est dans HunterSubnav). `title` reste le titre de la page pour
 * les lecteurs d'écran ; `actions`, alignées à droite au-dessus du contenu.
 */
export function HunterShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const wide = isWideHunterPage(usePathname())
  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className={`max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 ${wide ? `${WIDE} min-[90rem]:py-6` : ''}`}>
        <h1 className="sr-only">{title}</h1>
        {actions && <div className="flex items-center justify-end gap-2 flex-wrap mb-4">{actions}</div>}
        {children}
      </div>
    </div>
  )
}
