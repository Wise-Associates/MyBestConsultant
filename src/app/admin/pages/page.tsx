import { getPages, getNavLinks } from './actions'
import { PagesClient } from './pages-client'
import { NavMenuManager } from './nav-menu-manager'
import { KNOWN_PAGES } from '@/lib/known-pages'

export default async function AdminPagesPage() {
  const [pages, navLinks] = await Promise.all([getPages(), getNavLinks()])

  const availablePages = [
    ...KNOWN_PAGES.map(p => ({ ...p, source: 'code' as const })),
    ...pages
      .filter(p => p.isPublished && p.slug !== 'home')
      .map(p => ({ href: `/${p.slug}`, label: p.title as string, source: 'cms' as const })),
  ]

  return (
    <div className="min-h-full bg-[#0A0C10] text-white">
      <div className="px-8 py-8 max-w-5xl space-y-6">
        <NavMenuManager initialNavLinks={navLinks} availablePages={availablePages} />
        <PagesClient initialPages={pages} />
      </div>
    </div>
  )
}
