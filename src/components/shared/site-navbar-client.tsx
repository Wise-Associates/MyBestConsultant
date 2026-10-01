'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { LogOut, Menu, X, ChevronDown, Briefcase, LayoutDashboard, Settings, Plus, CalendarDays, LifeBuoy, GitBranch } from 'lucide-react'
import { logoutAction } from '@/app/(auth)/actions'
import { CALENDLY_URL } from '@/lib/site-links'
import type { UserRole } from '@/types'

interface NavLink { label: string; href: string }
interface Props {
  siteName: string
  logoUrl?: string
  navLinks: NavLink[]
  user: { firstName: string; lastName: string; role: UserRole } | null
  supportUnread?: number
  headerConfig?: unknown  // kept for compat, not used
}

// ── Bouton « Support Helpdesk » (recruteurs et candidats connectés) ───────────────
function SupportButton({ role, unread, variant }: { role: UserRole; unread: number; variant: 'desktop' | 'mobile' | 'menu' }) {
  const href = role === 'candidate' ? '/candidate/support' : role === 'hunter' ? '/hunter/support' : '/recruiter/support'
  const badge = unread > 0 && (
    <span className="mbc-support-badge" aria-label={`${unread} réponse(s) non lue(s)`}>{unread > 9 ? '9+' : unread}</span>
  )
  if (variant === 'menu') {
    return (
      <Link href={href} className="mbc-support-btn mbc-support-btn-menu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '13px 16px', borderRadius: 12, fontSize: 14, fontWeight: 800, textDecoration: 'none', marginBottom: 8, position: 'relative' }}>
        <LifeBuoy style={{ width: 18, height: 18 }} />Support Helpdesk{badge}
      </Link>
    )
  }
  return (
    <Link href={href} className={variant === 'mobile' ? 'mbc-support-btn mbc-support-mobile' : 'mbc-support-btn'} aria-label="Support Helpdesk" title="Support Helpdesk"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: variant === 'mobile' ? '9px 11px' : '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 800, textDecoration: 'none', position: 'relative', flexShrink: 0 }}>
      <LifeBuoy style={{ width: 16, height: 16 }} />
      {variant === 'desktop' && <span className="mbc-support-label">Support Helpdesk</span>}
      {badge}
    </Link>
  )
}

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', recruiter: 'Recruteur', candidate: 'Candidat', hunter: 'Chasseur' }
const ROLE_COLOR: Record<UserRole, string> = { admin: '#ef4444', recruiter: '#E8A33D', candidate: '#8b5cf6', hunter: '#14b8a6' }

const PROFILE_LINKS: Record<UserRole, { label: string; href: string; icon: React.ReactNode }[]> = {
  hunter: [
    { label: 'Mon espace chasseur', href: '/hunter/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Mon vivier',          href: '/hunter/vivier',    icon: <Briefcase       className="h-4 w-4" /> },
    { label: 'Voir les offres',     href: '/hunter/offres',    icon: <Briefcase       className="h-4 w-4" /> },
  ],
  candidate: [
    { label: 'Mon compte', href: '/candidate/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Voir les offres',  href: '/jobs',                icon: <Briefcase       className="h-4 w-4" /> },
  ],
  recruiter: [
    { label: 'Mon dashboard',   href: '/recruiter/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Publier une offre', href: '/recruiter/dashboard', icon: <Plus          className="h-4 w-4" /> },
    { label: 'Processus de recrutement', href: '/recruiter/funnel', icon: <GitBranch className="h-4 w-4" /> },
    { label: 'Voir les offres', href: '/jobs',                icon: <Briefcase       className="h-4 w-4" /> },
  ],
  admin: [
    { label: 'Administration',  href: '/admin/dashboard',     icon: <Settings        className="h-4 w-4" /> },
    { label: 'Voir les offres', href: '/jobs',                icon: <Briefcase       className="h-4 w-4" /> },
  ],
}

// ── Avatar dropdown ───────────────────────────────────────────────
function UserDropdown({ user }: { user: NonNullable<Props['user']> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
  const roleColor = ROLE_COLOR[user.role]
  const links = PROFILE_LINKS[user.role] ?? []

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '5px 12px 5px 5px', borderRadius: 9999,
          background: open ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)', transition: 'background 0.2s',
        }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white', background: 'linear-gradient(135deg,#2C2C2E,#3A3A3C)', border: '1.5px solid rgba(232,163,61,0.4)', flexShrink: 0 }}>
          {initials}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', display: 'none' }} className="lg:block-hack">
          {user.firstName}
        </span>
        <ChevronDown style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.4)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: 220,
          borderRadius: 16, overflow: 'hidden', zIndex: 100,
          background: 'rgba(28,28,30,0.97)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          {/* Identity */}
          <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'white', background: 'linear-gradient(135deg,#2C2C2E,#3A3A3C)', border: '1.5px solid rgba(232,163,61,0.35)', flexShrink: 0 }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.firstName} {user.lastName}
                </p>
                <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '2px 7px', borderRadius: 20, background: `${roleColor}20`, color: roleColor }}>
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
            </div>
          </div>

          {/* Links */}
          <div style={{ padding: '6px 0' }}>
            {links.map(({ label, href, icon }) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', fontSize: 13, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', transition: 'background 0.15s, color 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'white' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>{icon}</span>{label}
              </Link>
            ))}
          </div>

          {/* Logout */}
          <div style={{ padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <form action={logoutAction}>
              <button type="submit"
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 18px', fontSize: 13, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.07)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <LogOut style={{ width: 14, height: 14 }} />Déconnexion
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main navbar ───────────────────────────────────────────────────
export function SiteNavbarClient({ siteName, logoUrl, navLinks, user, supportUnread = 0 }: Props) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Fond noir uniforme sur toutes les pages, y compris l'accueil : plus de variation
  // d'opacité au scroll (c'est ce qui donnait l'impression d'un header qui "change de
  // couleur" en haut de la page d'accueil).
  const navbarStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9000,
    height: 68,
    background: 'rgba(28,28,30,0.97)',
    backdropFilter: 'blur(20px)',
    borderBottom: '1px solid rgba(232,163,61,0.12)',
  }

  return (
    <>
      {/* Spacer so content doesn't hide under the fixed navbar — same background as the
          navbar itself, otherwise the transparent gap shows the page body's own color
          through it (a stray light band on dark recruiter/admin pages). */}
      <div style={{ height: 68, background: navbarStyle.background }} />

      <header style={navbarStyle}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px', height: '100%', display: 'flex', alignItems: 'center', gap: 32 }}>

          {/* Logo — the file already has "MY BEST CONSULTANT" built into the artwork,
              no separate text needed next to it. */}
          <Link href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl || '/logo.png'}
              alt={siteName || 'MyBestConsultant'}
              style={{ height: 60, width: 'auto', objectFit: 'contain' }}
            />
          </Link>

          {/* Desktop nav links */}
          <nav style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }} className="nav-desktop">
            {navLinks.map(({ label, href }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href))
              return (
                <Link key={href} href={href}
                  style={{
                    padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                    color: active ? '#E8A33D' : 'rgba(255,255,255,0.6)',
                    textDecoration: 'none', transition: 'color 0.2s, background 0.2s',
                    background: active ? 'rgba(232,163,61,0.08)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'white' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)' }}>
                  {label}
                </Link>
              )
            })}
          </nav>

          {/* Right side — desktop */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }} className="nav-desktop">
            {!user && (
              <>
                <Link href="/login"
                  style={{ padding: '7px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', textDecoration: 'none', transition: 'color 0.2s' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'white')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)')}>
                  Connexion
                </Link>
                <Link href="/register"
                  style={{ padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: 'white', textDecoration: 'none', background: 'linear-gradient(135deg,#2C2C2E,#3A3A3C)', border: '1px solid rgba(232,163,61,0.4)', transition: 'border-color 0.2s, box-shadow 0.2s' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(232,163,61,0.8)'; el.style.boxShadow = '0 4px 20px rgba(232,163,61,0.2)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(232,163,61,0.4)'; el.style.boxShadow = 'none' }}>
                  S&apos;inscrire
                </Link>
              </>
            )}

            {/* Support Helpdesk — recruteur et candidat */}
            {user && user.role !== 'admin' && <SupportButton role={user.role} unread={supportUnread} variant="desktop" />}

            {/* Publier une offre — recruteur/admin uniquement */}
            {user && (user.role === 'recruiter' || user.role === 'admin') && (
              <Link href="/recruiter/dashboard"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#E8A33D', textDecoration: 'none', border: '1px solid rgba(232,163,61,0.35)', background: 'rgba(232,163,61,0.07)', transition: 'all 0.2s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(232,163,61,0.14)'; el.style.borderColor = 'rgba(232,163,61,0.6)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'rgba(232,163,61,0.07)'; el.style.borderColor = 'rgba(232,163,61,0.35)' }}>
                <Plus style={{ width: 14, height: 14 }} />
                Publier une offre
              </Link>
            )}

            {user && <UserDropdown user={user} />}
          </div>

          {/* Support Helpdesk — version compacte visible sur mobile */}
          {user && user.role !== 'admin' && <SupportButton role={user.role} unread={supportUnread} variant="mobile" />}

          {/* Mobile burger */}
          <button className="nav-mobile-btn"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: 8, display: 'none' }}
            onClick={() => setMobileOpen(v => !v)}>
            {mobileOpen ? <X style={{ width: 22, height: 22 }} /> : <Menu style={{ width: 22, height: 22 }} />}
          </button>

          {/* "Demander une présentation" — kept outside .nav-desktop so it stays visible on
              mobile too, at the far right of the bar, instead of being hidden inside the
              menu until opened. */}
          <Link href={CALENDLY_URL} target="_blank" rel="noreferrer" className="mbc-nav-cta"
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, color: '#1a1305', textDecoration: 'none', background: 'linear-gradient(135deg,#E8A33D,#F0B860)', boxShadow: '0 4px 16px rgba(232,163,61,0.25)', transition: 'transform 0.15s, box-shadow 0.2s', flexShrink: 0 }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'translateY(-1px)'; el.style.boxShadow = '0 6px 20px rgba(232,163,61,0.4)' }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.transform = 'none'; el.style.boxShadow = '0 4px 16px rgba(232,163,61,0.25)' }}>
            <CalendarDays style={{ width: 15, height: 15 }} />
            <span className="mbc-nav-cta-text">Demander une présentation</span>
          </Link>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div style={{ background: 'rgba(28,28,30,0.98)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(255,255,255,0.07)', padding: '16px 20px 24px' }}>
            {/* Nav links */}
            {navLinks.map(({ label, href }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href))
              return (
                <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                  style={{ display: 'block', padding: '12px 16px', borderRadius: 10, fontSize: 14, fontWeight: 500, color: active ? '#E8A33D' : 'rgba(255,255,255,0.65)', textDecoration: 'none', background: active ? 'rgba(232,163,61,0.08)' : 'transparent', marginBottom: 2 }}>
                  {label}
                </Link>
              )
            })}

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              {user ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', marginBottom: 4 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'white', background: 'linear-gradient(135deg,#2C2C2E,#3A3A3C)', border: '1.5px solid rgba(232,163,61,0.35)' }}>
                      {user.firstName[0]}{user.lastName[0]}
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>{user.firstName} {user.lastName}</p>
                      <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: ROLE_COLOR[user.role] }}>{ROLE_LABEL[user.role]}</span>
                    </div>
                  </div>
                  {user.role !== 'admin' && <SupportButton role={user.role} unread={supportUnread} variant="menu" />}
                  {(PROFILE_LINKS[user.role] ?? []).map(({ label, href, icon }) => (
                    <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, fontSize: 14, color: 'rgba(255,255,255,0.65)', textDecoration: 'none', marginBottom: 2 }}>
                      <span style={{ color: 'rgba(255,255,255,0.3)' }}>{icon}</span>{label}
                    </Link>
                  ))}
                  <form action={logoutAction}>
                    <button type="submit" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', borderRadius: 10, fontSize: 14, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', marginTop: 4 }}>
                      <LogOut style={{ width: 15, height: 15 }} />Déconnexion
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMobileOpen(false)}
                    style={{ display: 'block', padding: '12px 16px', borderRadius: 10, fontSize: 14, color: 'rgba(255,255,255,0.65)', textDecoration: 'none', marginBottom: 6 }}>
                    Connexion
                  </Link>
                  <Link href="/register" onClick={() => setMobileOpen(false)}
                    style={{ display: 'block', padding: '13px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700, color: 'white', textDecoration: 'none', textAlign: 'center', background: 'linear-gradient(135deg,#2C2C2E,#3A3A3C)', border: '1px solid rgba(232,163,61,0.4)' }}>
                    S&apos;inscrire
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <style>{`
        .mbc-support-btn {
          color: #1a1305; background: linear-gradient(135deg, #F8CB7A 0%, #E8A33D 52%, #D48A1C 100%);
          border: 1px solid rgba(255,255,255,0.28);
          box-shadow: 0 4px 16px rgba(232,163,61,0.32), inset 0 1px 0 rgba(255,255,255,0.45);
          transition: transform 0.2s, box-shadow 0.2s, filter 0.2s;
        }
        .mbc-support-btn:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 8px 26px rgba(232,163,61,0.5), inset 0 1px 0 rgba(255,255,255,0.5); }
        .mbc-support-btn svg { transition: transform 0.6s cubic-bezier(.3,1.4,.5,1); }
        .mbc-support-btn:hover svg { transform: rotate(200deg); }
        .mbc-support-badge {
          position: absolute; top: -6px; right: -6px; min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px;
          display: flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 800; color: white;
          background: #ef4444; border: 2px solid rgb(28,28,30); animation: mbc-support-pulse 2s ease-in-out infinite;
        }
        @keyframes mbc-support-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); } }
        .mbc-support-mobile { display: none !important; }
        @media (max-width: 1099px) { .mbc-support-label { display: none; } .mbc-support-btn:not(.mbc-support-btn-menu):not(.mbc-support-mobile) { padding: 9px 11px !important; } }
        @media (min-width: 768px) {
          .nav-desktop { display: flex !important; }
          .nav-mobile-btn { display: none !important; }
        }
        @media (max-width: 767px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-btn { display: flex !important; }
          .mbc-support-mobile { display: flex !important; }
          .mbc-nav-cta { padding: 9px 12px !important; }
          .mbc-nav-cta-text { display: none; }
        }
      `}</style>
    </>
  )
}
