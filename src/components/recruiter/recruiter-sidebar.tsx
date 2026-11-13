'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  BarChart3, Building2, ChevronDown, CreditCard, FolderOpen, FolderSearch, GitBranch, Inbox, LayoutDashboard, MessageSquare, PanelLeftClose,
  PanelLeftOpen, Radar, UserCog, Users,
} from 'lucide-react'
import {
  SIDEBAR_COOKIE, recruiterAccountSections, recruiterNavGroups, recruiterSectionOf, type RecruiterSection, type RecruiterSectionKey,
} from '@/lib/recruiter-nav'

// Menu latéral de l'espace recruteur (demande du 2026-11-13, à la place du sous-menu horizontal), monté par le layout
// recruteur sous la barre du site : rubriques et groupes de recruiter-nav.ts, rubrique de la page en surbrillance.
// Dès 1024 px : colonne collante à gauche, icônes seules jusqu'à 1279 px (le contenu garde sa place : le tableau des
// offres passe en tableau dès 1024 px), libellés dès 1280 px sauf si le recruteur réduit le menu (choix gardé dans un
// cookie, relu par le layout pour que la page arrive déjà dans le bon état). Largeur : variable CSS
// --recruiter-sidebar-w (globals.css), reprise par les barres fixées en bas des pages pour commencer après le menu.
// En bas de la colonne (maquette du 2026-11-13) : le sélecteur de l'organisation (son nom), qui ouvre ses pages
// (organisation, utilisateurs, abonnement), et à côté l'icône qui réduit ou rouvre le menu. Plus étroit : une barre sous la barre du site, qui montre la rubrique courante et ouvre la liste des rubriques.
// Couleurs du thème du site (var(--color-…)), comme le reste de l'espace recruteur.

const ICONS: Record<RecruiterSectionKey, ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>> = {
  dashboard: LayoutDashboard,
  funnel: GitBranch,
  ao: Inbox,
  reporting: BarChart3,
  vivier: FolderOpen,
  cvtheque: FolderSearch,
  mbcsearch: Radar,
  equipe: Users,
  interviews: MessageSquare,
  utilisateurs: UserCog,
  abonnement: CreditCard,
  organisation: Building2,
}

const GROUPS = recruiterNavGroups()
const ACCOUNT = recruiterAccountSections()
// Liste des écrans étroits : les groupes du haut, puis le bas du menu sous un titre « Compte ».
const MENU_GROUPS = [...GROUPS, { key: 'compte', label: 'Compte', sections: ACCOUNT }]

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2'

// Rubrique courante : fond teinté seulement (barre à gauche retirée le 2026-11-13, le fond suffit à la repérer).
// Typographie de la maquette (2026-11-13) : texte foncé en graisse normale, rubrique courante en graisse moyenne.
const activeStyle = (active: boolean) => ({
  color: active ? 'var(--color-text)' : 'color-mix(in srgb, var(--color-text) 82%, var(--color-surface))',
  background: active ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : undefined,
})

// Icônes au trait fin, comme la maquette.
const ICON = 'h-5 w-5 shrink-0'
const STROKE = 1.5

/**
 * Menu latéral et contenu de la page à sa droite. `initialCollapsed` : cookie lu par le layout ; `organisationName` :
 * nom de l'organisation du recruteur, lu par le layout.
 */
export function RecruiterShell({ initialCollapsed, organisationName, children }: {
  initialCollapsed: boolean; organisationName: string; children: ReactNode
}) {
  const pathname = usePathname()
  const current = recruiterSectionOf(pathname)
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    // Chemin /recruiter : le cookie ne part qu'avec les pages de l'espace recruteur ; supprimé quand le menu est rouvert.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : ''}; path=/recruiter; max-age=${next ? 60 * 60 * 24 * 365 : 0}; samesite=lax`
  }

  // Libellés : lus par les lecteurs d'écran à toutes les largeurs, affichés dès 1280 px quand le menu n'est pas réduit.
  const labelClass = collapsed ? 'sr-only' : 'sr-only xl:not-sr-only xl:truncate text-[14px]'
  const linkLayout = collapsed ? 'justify-center' : 'justify-center xl:justify-start'

  const sidebarLink = (section: RecruiterSection) => {
    const Icon = ICONS[section.key]
    const active = section.key === current
    return (
      <li key={section.key}>
        <Link href={section.href} aria-current={active ? 'page' : undefined} title={section.label}
          className={`flex items-center gap-3 h-9 px-3 rounded-lg text-[15px] no-underline transition-colors ${linkLayout} ${focusRing} focus-visible:ring-offset-0 ${active ? 'font-medium' : 'font-normal hover:bg-[var(--color-background)]'}`}
          style={activeStyle(active)}>
          <Icon className={ICON} strokeWidth={STROKE} aria-hidden />
          <span className={labelClass}>{section.label}</span>
        </Link>
      </li>
    )
  }
  const toggleLabel = collapsed ? 'Afficher les libellés du menu' : 'Réduire le menu'

  return (
    <div className="recruiter-shell lg:flex lg:items-start" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      {/* Seule la liste des rubriques défile : le menu de l'organisation, en bas, peut ainsi s'ouvrir hors de la colonne
          (à droite quand elle n'a que des icônes). */}
      <aside className="hidden lg:flex flex-col sticky top-[68px] h-[calc(100vh-68px)] shrink-0 z-30"
        style={{ width: 'var(--recruiter-sidebar-w)', background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
        <nav aria-label="Rubriques de l’espace recruteur" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-4">
          {GROUPS.map((group, index) => (
            <SidebarGroup key={group.key} label={group.label} first={index === 0} collapsed={collapsed}>
              {group.sections.map(sidebarLink)}
            </SidebarGroup>
          ))}
        </nav>
        {/* Sélecteur de l'organisation et, à côté, réduire / rouvrir (icône seulement là où les libellés peuvent
            s'afficher : de 1024 à 1279 px, le menu est toujours réduit) ; empilés quand le menu n'a que des icônes. */}
        <div className={`flex flex-col items-center gap-1 px-2 py-2 ${collapsed ? '' : 'xl:flex-row'}`} style={{ borderTop: '1px solid var(--color-border)' }}>
          <OrganisationMenu key={pathname} name={organisationName} current={current} collapsed={collapsed} />
          <button type="button" onClick={toggle} aria-label={toggleLabel} title={toggleLabel} aria-expanded={!collapsed}
            className={`hidden xl:inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 transition-colors hover:bg-[var(--color-background)] ${focusRing} focus-visible:ring-offset-0`}
            style={{ color: 'var(--color-text-muted)' }}>
            {collapsed ? <PanelLeftOpen className={ICON} strokeWidth={STROKE} aria-hidden /> : <PanelLeftClose className={ICON} strokeWidth={STROKE} aria-hidden />}
          </button>
        </div>
      </aside>

      {/* Mobile et tablette : la rubrique courante, qui ouvre la liste. */}
      <nav aria-label="Rubriques de l’espace recruteur" className="lg:hidden relative z-30"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="px-4 sm:px-6">
          <SectionMenu key={pathname} current={current} />
        </div>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Sélecteur de l'organisation, en bas de la colonne : son nom (icône seule quand le menu est réduit), qui ouvre ses
 * pages au-dessus (à droite quand le menu n'a que des icônes). Refermé par Échap (le focus revient au bouton), par un
 * clic à côté ou en changeant de page (`key={pathname}`).
 */
function OrganisationMenu({ name, current, collapsed }: { name: string; current: RecruiterSectionKey | null; collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const label = name.trim() || 'Mon organisation'
  const inSection = ACCOUNT.some(section => section.key === current)

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
    <div ref={root} className={`relative w-full min-w-0 ${collapsed ? '' : 'xl:flex-1'}`}>
      <button ref={button} type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={listId} title={label}
        className={`flex items-center gap-2.5 w-full h-10 px-2 rounded-lg transition-colors hover:bg-[var(--color-background)] ${collapsed ? 'justify-center' : 'justify-center xl:justify-start'} ${focusRing} focus-visible:ring-offset-0`}
        style={{ color: 'var(--color-text)', background: open || inSection ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : undefined }}>
        <span aria-hidden className="inline-flex items-center justify-center w-7 h-7 rounded-md shrink-0"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <Building2 className="h-4 w-4" strokeWidth={STROKE} />
        </span>
        <span className={collapsed ? 'sr-only' : 'sr-only xl:not-sr-only xl:flex-1 xl:min-w-0 xl:truncate xl:text-left text-[14px] font-semibold'}>{label}</span>
        <span className="sr-only"> : organisation, utilisateurs et abonnement</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''} ${collapsed ? 'hidden' : 'hidden xl:block'}`}
          aria-hidden style={{ color: 'var(--color-text-muted)' }} />
      </button>
      {open && (
        <div id={listId}
          className={`absolute z-40 w-56 py-1.5 rounded-xl left-full bottom-0 ml-2 ${collapsed ? '' : 'xl:left-0 xl:ml-0 xl:bottom-full xl:mb-2'}`}
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 12px 32px -12px rgba(0,0,0,0.28)' }}>
          <p className="px-3.5 pt-1 pb-1.5 text-[13px] truncate" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
          <ul>
            {ACCOUNT.map(section => {
              const Icon = ICONS[section.key]
              const active = section.key === current
              return (
                <li key={section.key}>
                  <Link href={section.href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 h-9 mx-1.5 px-2.5 rounded-lg text-[14px] no-underline transition-colors ${focusRing} focus-visible:ring-offset-0 ${active ? 'font-medium' : 'font-normal hover:bg-[var(--color-background)]'}`}
                    style={activeStyle(active)}>
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={STROKE} aria-hidden />
                    {section.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Un groupe du menu : son titre dès que les libellés s'affichent, un filet à sa place quand le menu n'a que des icônes. */
function SidebarGroup({ label, first, collapsed, children }: { label: string; first: boolean; collapsed: boolean; children: ReactNode }) {
  const headingId = useId()
  return (
    <div className={first ? '' : 'mt-3 xl:mt-5'}>
      {!first && <div aria-hidden className={`mx-3 mb-3 h-px ${collapsed ? '' : 'xl:hidden'}`} style={{ background: 'var(--color-border)' }} />}
      <p id={headingId}
        className={collapsed ? 'sr-only' : 'sr-only xl:not-sr-only xl:block xl:px-3 xl:pb-1 xl:text-[13px] xl:font-normal'}
        style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </p>
      <ul aria-labelledby={headingId} className="space-y-0.5">{children}</ul>
    </div>
  )
}

/**
 * Liste déroulante des rubriques (écrans étroits), par groupe. Refermée par Échap (le focus revient au bouton), par un
 * clic à côté ou en changeant de page (le composant est recréé à chaque page : `key={pathname}`).
 */
function SectionMenu({ current }: { current: RecruiterSectionKey | null }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const CurrentIcon = current ? ICONS[current] : LayoutDashboard
  const label = MENU_GROUPS.flatMap(g => g.sections).find(s => s.key === current)?.label ?? 'Rubriques'

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
        <div id={listId} className="absolute left-0 right-0 top-full py-2 shadow-lg max-h-[calc(100vh-128px)] overflow-y-auto"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          {MENU_GROUPS.map(group => (
            <MenuGroup key={group.key} label={group.label}>
              {group.sections.map(section => {
                const Icon = ICONS[section.key]
                const active = section.key === current
                return (
                  <li key={section.key}>
                    <Link href={section.href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 min-h-12 px-4 sm:px-6 text-[15px] no-underline ${focusRing} focus-visible:ring-offset-0 ${active ? 'font-medium' : 'font-normal'}`}
                      style={activeStyle(active)}>
                      <Icon className={ICON} strokeWidth={STROKE} aria-hidden />
                      {section.label}
                    </Link>
                  </li>
                )
              })}
            </MenuGroup>
          ))}
        </div>
      )}
    </div>
  )
}

function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <div className="pt-2 first:pt-0">
      <p id={headingId} className="px-4 sm:px-6 py-1.5 text-[13px] font-normal" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </p>
      <ul aria-labelledby={headingId}>{children}</ul>
    </div>
  )
}
