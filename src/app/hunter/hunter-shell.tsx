'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, FolderOpen, LayoutDashboard, Send, Target } from 'lucide-react'

const TABS = [
  { href: '/hunter/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/hunter/vivier', label: 'Mon vivier', icon: FolderOpen },
  { href: '/hunter/offres', label: 'Offres', icon: Briefcase },
  { href: '/hunter/propositions', label: 'Mes propositions', icon: Send },
]

/** En-tête commun de l'espace Chasseur : titre + onglets de navigation. */
export function HunterShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(20,184,166,0.18)' }}>
                <Target className="h-6 w-6" style={{ color: '#2dd4bf' }} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#2dd4bf' }}>Espace chasseur</p>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.7rem', lineHeight: 1.2 }}>{title}</h1>
                {subtitle && <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
          </div>
          <nav className="flex gap-1 mt-6 overflow-x-auto" style={{ scrollbarWidth: 'none' }} aria-label="Navigation chasseur">
            {TABS.map(t => {
              const active = path === t.href || path.startsWith(t.href + '/')
              return (
                <Link key={t.href} href={t.href} className="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold no-underline whitespace-nowrap transition-colors rounded-t-xl"
                  style={active ? { background: 'var(--color-background, #f8f7f4)', color: 'var(--color-text, #111)' } : { color: 'rgba(255,255,255,0.6)' }}>
                  <t.icon className="h-4 w-4" />{t.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</div>
    </div>
  )
}
