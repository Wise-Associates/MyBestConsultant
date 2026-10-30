'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import { BarChart3, ChevronDown, FolderOpen, FolderSearch, Inbox, LayoutDashboard, MessageSquare, Users } from 'lucide-react'
import { RECRUITER_SECTIONS, recruiterSectionOf, type RecruiterSectionKey } from '@/lib/recruiter-nav'

// Sous-menu de l'espace recruteur, sous la barre du site (layout recruteur) : les rubriques (recruiter-nav.ts), la
// rubrique de la page en surbrillance. Grand écran (≥ 1024 px) : onglets, icônes dès 1280 px pour que tous les libellés
// tiennent sur une ligne. Plus étroit : un bouton qui montre la rubrique courante et ouvre la liste des rubriques.
// Couleurs du thème du site (var(--color-…)), comme le reste de l'espace recruteur.

const ICONS: Record<RecruiterSectionKey, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  dashboard: LayoutDashboard,
  ao: Inbox,
  reporting: BarChart3,
  vivier: FolderOpen,
  cvtheque: FolderSearch,
  equipe: Users,
  interviews: MessageSquare,
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2'

export function RecruiterSubnav() {
  const pathname = usePathname()
  const current = recruiterSectionOf(pathname)
  const currentSection = RECRUITER_SECTIONS.find(s => s.key === current)

  return (
    <nav aria-label="Rubriques de l’espace recruteur" className="relative z-30"
      style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Grand écran : une ligne d'onglets. */}
        <ul className="hidden lg:flex items-stretch gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {RECRUITER_SECTIONS.map(section => {
            const Icon = ICONS[section.key]
            const active = section.key === current
            return (
              <li key={section.key} className="shrink-0">
                <Link href={section.href} aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-2 h-12 px-2.5 rounded-md text-sm whitespace-nowrap no-underline transition-colors ${focusRing} ${active ? 'font-semibold' : 'font-medium hover:bg-[var(--color-background)]'}`}
                  style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  <Icon className="hidden xl:block h-4 w-4 shrink-0" aria-hidden />
                  {section.label}
                  {active && <span aria-hidden className="absolute left-2.5 right-2.5 bottom-0 h-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />}
                </Link>
              </li>
            )
          })}
        </ul>
        {/* Mobile et tablette : la rubrique courante, qui ouvre la liste. */}
        <div className="lg:hidden">
          <SectionMenu key={pathname} current={current} label={currentSection?.label ?? 'Rubriques'} />
        </div>
      </div>
    </nav>
  )
}

/**
 * Liste déroulante des rubriques (écrans étroits). Refermée par Échap (le focus revient au bouton), par un clic à côté
 * ou en changeant de page (le composant est recréé à chaque page : `key={pathname}`).
 */
function SectionMenu({ current, label }: { current: RecruiterSectionKey | null; label: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const CurrentIcon = current ? ICONS[current] : LayoutDashboard

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root}>
      <button ref={button} type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={listId}
        className={`flex items-center gap-2 w-full h-12 text-sm font-semibold text-left rounded-md ${focusRing}`}
        style={{ color: 'var(--color-text)' }}>
        <CurrentIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{label}</span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Rubriques</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden
          style={{ color: 'var(--color-text-muted)' }} />
      </button>
      {open && (
        <ul id={listId} className="absolute left-0 right-0 top-full py-2 shadow-lg"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          {RECRUITER_SECTIONS.map(section => {
            const Icon = ICONS[section.key]
            const active = section.key === current
            return (
              <li key={section.key}>
                <Link href={section.href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 min-h-12 px-4 sm:px-6 text-sm no-underline ${focusRing} focus-visible:ring-offset-0 ${active ? 'font-semibold' : 'font-medium'}`}
                  style={{
                    color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                    background: active ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : undefined,
                    boxShadow: active ? 'inset 3px 0 0 var(--color-primary)' : undefined,
                  }}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {section.label}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
