import Link from 'next/link'
import { MapPin, ShieldCheck, Briefcase, UserPlus, Crown, Info, Phone, FileEdit, Shield, Music2 } from 'lucide-react'
import { getSiteConfig, getLayoutConfig } from '@/lib/site-config'
import { BrandIcon, type BrandName } from '@/components/shared/brand-icon'
import { CONTACT_ADDRESS } from '@/lib/site-links'
import type { FooterConfig, SocialLink } from '@/types/layout'

const GOLD = '#E8A33D'
const GOLD_BG = 'rgba(232,163,61,0.12)'

const BRAND_PLATFORMS: Partial<Record<SocialLink['platform'], BrandName>> = {
  linkedin: 'linkedin', facebook: 'facebook', instagram: 'instagram', youtube: 'youtube',
}

// All social icons share the site's single gold accent (not per-platform brand colors),
// matching the icon treatment used everywhere else on the site.
function SocialIcon({ platform }: { platform: SocialLink['platform'] }) {
  const brand = BRAND_PLATFORMS[platform]
  const wrap = (child: React.ReactNode) => (
    <span className="w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:-translate-y-0.5"
      style={{ background: GOLD_BG, color: GOLD, border: `1px solid rgba(232,163,61,0.3)` }}>
      {child}
    </span>
  )
  if (brand) return wrap(<BrandIcon name={brand} size={17} />)
  if (platform === 'tiktok') return wrap(<Music2 style={{ width: 16, height: 16 }} />)
  const fallback: Record<string, string> = { twitter: 'X', github: 'GH' }
  return wrap(<span className="text-[11px] font-bold">{fallback[platform] ?? '?'}</span>)
}

// Best-effort icon per footer link label — purely decorative, falls back gracefully.
function linkIcon(label: string) {
  const l = label.toLowerCase()
  const props = { style: { width: 14, height: 14, flexShrink: 0, color: GOLD } }
  if (l.includes('offre')) return <Briefcase {...props} />
  if (l.includes('profil') || l.includes('compte') || l.includes('candidat')) return <UserPlus {...props} />
  if (l.includes('abonnement')) return <Crown {...props} />
  if (l.includes('propos')) return <Info {...props} />
  if (l.includes('contact')) return <Phone {...props} />
  if (l.includes('blog')) return <FileEdit {...props} />
  if (l.includes('légal') || l.includes('confidentialité') || l.includes('cgv') || l.includes('données') || l.includes('conditions') || l.includes('vente')) return <Shield {...props} />
  return null
}

// Section heading with the small gold underline accent used throughout the footer.
function ColumnTitle({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: GOLD }}>{children}</p>
      <span className={`block mt-1.5 rounded-full ${center ? 'mx-auto' : ''}`} style={{ width: 28, height: 3, background: GOLD }} />
    </div>
  )
}

function FooterInner({ footer, siteName, logoUrl, tagline }: {
  footer: FooterConfig
  siteName: string
  logoUrl?: string
  tagline?: string
}) {
  const paddingMap = { sm: 'py-10', md: 'py-16', lg: 'py-20' }
  const bg = footer.bgColor
  const text = footer.textColor
  const muted = footer.mutedColor

  return (
    <footer style={{ background: bg, position: 'relative', overflow: 'hidden', borderTop: '1px solid rgba(232,163,61,0.25)' }}>
      {/* Decorative dot pattern, top-right — purely visual, matches brand accent */}
      <div aria-hidden style={{
        position: 'absolute', top: 0, right: 0, width: 320, height: 320, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(232,163,61,0.35) 1.4px, transparent 1.4px)',
        backgroundSize: '18px 18px',
        maskImage: 'radial-gradient(circle at top right, black, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(circle at top right, black, transparent 70%)',
      }} />

      <div className={`relative max-w-7xl mx-auto px-6 lg:px-10 ${paddingMap[footer.paddingY]}`}>

        {/* Top row: logo + columns */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10 lg:gap-16 pb-12"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>

          {/* Brand column */}
          <div className="lg:col-span-1 space-y-4 flex flex-col items-center text-center">
            {footer.showLogo && logoUrl && (
              <img src={logoUrl} alt={siteName} className="h-28 w-auto object-contain" />
            )}
            <p className="font-bold text-xl tracking-wide" style={{ color: text }}>
              <span style={{ color: text }}>My</span>
              <span style={{ color: GOLD }}>Best</span>
              <span style={{ color: text }}>Consultant</span>
            </p>
            {footer.showTagline && tagline && (
              <p className="text-sm font-semibold leading-relaxed" style={{ color: text, opacity: 0.85 }}>{tagline}</p>
            )}
            <p className="text-sm leading-relaxed" style={{ color: muted }}>
              MyBestConsultant accompagne les entreprises et les cabinets de conseil dans la
              recherche, la sélection et l&apos;engagement des meilleurs talents.
            </p>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: GOLD }}>
              Talents · Expertise · Innovation
            </p>
            {footer.showSocial && footer.socialLinks.length > 0 && (
              <div className="pt-2 flex flex-col items-center">
                <ColumnTitle center>Suivez-nous</ColumnTitle>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {footer.socialLinks.map(s => (
                    <Link key={s.platform} href={s.url} target="_blank" rel="noreferrer">
                      <SocialIcon platform={s.platform} />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Link columns */}
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-8">
            {footer.columns.map(col => (
              <div key={col.id}>
                <ColumnTitle>{col.title}</ColumnTitle>
                <ul className="space-y-2.5">
                  {col.links.map(link => (
                    <li key={link.label}>
                      <Link href={link.href}
                        className="flex items-center gap-2 text-sm no-underline transition-opacity hover:opacity-100"
                        style={{ color: text, opacity: 0.7 }}>
                        {linkIcon(link.label)}
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs" style={{ color: muted }}>{footer.bottomText}</p>
          <div className="flex items-center gap-2 text-xs" style={{ color: muted }}>
            <MapPin style={{ width: 13, height: 13, flexShrink: 0 }} />
            Siège social — {CONTACT_ADDRESS}, France
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: muted }}>
            Plateforme sécurisée et conforme au RGPD
            <ShieldCheck style={{ width: 13, height: 13, flexShrink: 0 }} />
          </div>
        </div>
      </div>
    </footer>
  )
}

export async function SiteFooter({ currentSlug }: { currentSlug?: string }) {
  const [cfg, layout] = await Promise.all([getSiteConfig(), getLayoutConfig()])
  const footer = layout.footer

  // Visibility: only hide if specific pages configured AND current slug is not in the list
  // Empty array [] means "not configured yet" → show everywhere
  if (Array.isArray(footer.pages) && footer.pages.length > 0 && currentSlug) {
    if (!(footer.pages as string[]).includes(currentSlug)) return null
  }

  return (
    <FooterInner
      footer={footer}
      siteName={cfg.siteName}
      logoUrl={cfg.logoUrl || undefined}
      tagline={cfg.siteTagline}
    />
  )
}
