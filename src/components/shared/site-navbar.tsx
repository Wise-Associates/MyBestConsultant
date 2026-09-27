import { getCurrentUser } from '@/lib/appwrite/auth'
import { getSiteConfig, getLayoutConfig } from '@/lib/site-config'
import { SiteNavbarClient } from './site-navbar-client'
import { countUnreadForUser } from '@/lib/support'
import type { UserRole } from '@/types'

const NAV_BY_ROLE: Record<UserRole, { label: string; href: string }[]> = {
  hunter: [
    { label: 'Offres', href: '/jobs' },
    { label: 'Mon vivier', href: '/hunter/vivier' },
    { label: 'Mon espace', href: '/hunter/dashboard' },
  ],
  candidate: [
    { label: 'Offres', href: '/jobs' },
    { label: 'Mon compte', href: '/candidate/dashboard' },
  ],
  recruiter: [
    { label: 'Offres', href: '/jobs' },
    { label: 'Mon espace', href: '/recruiter/dashboard' },
  ],
  admin: [
    { label: 'Offres', href: '/jobs' },
    { label: 'Admin', href: '/admin/dashboard' },
  ],
}

export async function SiteNavbar() {
  const [user, config, layout] = await Promise.all([
    getCurrentUser(),
    getSiteConfig(),
    getLayoutConfig(),
  ])
  // Pastille du bouton « Support Helpdesk » : réponses du support pas encore lues (recruteurs et candidats).
  const supportUnread = user && user.role !== 'admin' ? await countUnreadForUser(user.userId) : 0

  // The role-specific links above are app navigation (dashboard shortcuts), not site
  // content — the rest of the menu is entirely admin-managed from /admin/pages so any
  // page (code-defined or created through the CMS) can be added without a code change.
  const roleLinks = user ? (NAV_BY_ROLE[user.role] ?? []) : []
  const roleHrefs = new Set(roleLinks.map(l => l.href))
  const managedLinks = layout.header.navLinks.filter(l => !roleHrefs.has(l.href))
  // « Marque employeur » (annuaire des marques employeurs) est toujours proposé, sans dépendre du menu géré en admin.
  const employersLink = [...roleLinks, ...managedLinks].some(l => l.href === '/entreprises') ? [] : [{ label: 'Marque employeur', href: '/entreprises' }]
  const navLinks = [...roleLinks, ...employersLink, ...managedLinks]

  return (
    <SiteNavbarClient
      siteName={config.siteName}
      logoUrl={config.logoUrl || undefined}
      navLinks={navLinks}
      user={user ? { firstName: user.firstName, lastName: user.lastName, role: user.role } : null}
      supportUnread={supportUnread}
      headerConfig={layout.header}
    />
  )
}
