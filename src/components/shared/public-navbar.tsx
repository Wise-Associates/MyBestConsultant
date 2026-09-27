'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavPage { title: string; slug: string }

interface PublicNavbarProps {
  siteName: string
  logoUrl?: string
  navPages?: NavPage[]
}

export function PublicNavbar({ siteName, logoUrl, navPages = [] }: PublicNavbarProps) {
  const pathname = usePathname()

  const staticLinks = [
    { label: 'Offres', href: '/jobs' },
    { label: 'Entreprises', href: '/companies' },
  ]

  const navLinks = [
    ...staticLinks,
    ...navPages.map(p => ({ label: p.title, href: `/${p.slug}` })),
  ]

  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{ background: 'var(--navbar-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">

        {/* Logo — custom upload or default SVG */}
        <Link href="/" className="flex items-center no-underline group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl || '/logo.svg'}
            alt={siteName}
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-medium transition-opacity hover:opacity-100 no-underline"
              style={{
                color: 'var(--navbar-text)',
                opacity: pathname === href ? 1 : 0.6,
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden sm:block text-sm font-medium px-3 py-2 rounded transition-opacity hover:opacity-100 no-underline"
            style={{ color: 'var(--navbar-text)', opacity: 0.65 }}
          >
            Connexion
          </Link>
          <Link
            href="/register?role=recruiter"
            className="text-sm font-semibold px-4 py-2 rounded-md transition-opacity hover:opacity-90 no-underline"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}
          >
            Publier une offre
          </Link>
        </div>
      </div>
    </header>
  )
}
