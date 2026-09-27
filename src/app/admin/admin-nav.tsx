'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Palette, Briefcase,
  Building2, Users, BrainCircuit, Home, Layout, PanelTop, Network, Video, Share2, Users2, CreditCard, Radar, FolderSearch, Mic, FileText, Activity, Search, Star, LifeBuoy, Megaphone,
} from 'lucide-react'

const SECTIONS = [
  {
    label: 'SITE',
    items: [
      { href: '/admin/dashboard', label: 'Vue globale',     sub: 'Statistiques',        icon: LayoutDashboard },
      { href: '/admin/analytics', label: 'Analytics',       sub: 'Trafic en temps réel', icon: Activity },
      { href: '/admin/homepage',  label: "Page d'accueil",  sub: 'Éditeur immersif',     icon: Home },
      { href: '/admin/content',   label: 'Contenu & SEO',   sub: 'Textes, contact, mots-clés', icon: Search },
      { href: '/admin/pages',     label: 'Autres pages',    sub: 'Créer & gérer',        icon: Layout },
      { href: '/admin/blog',      label: 'Blog',            sub: 'Articles',             icon: FileText },
      { href: '/admin/design',    label: 'Design & Thèmes', sub: 'Couleurs, polices',    icon: Palette },
      { href: '/admin/header',    label: 'Header & Footer', sub: 'Navigation, boutons',  icon: PanelTop },
    ],
  },
  {
    label: 'RECRUTEMENT',
    items: [
      { href: '/admin/jobs',        label: 'Offres',        sub: 'Toutes les missions',    icon: Briefcase },
      { href: '/admin/sourcing',    label: 'Sourcing IA',   sub: 'Repérer des candidats',  icon: Radar },
      { href: '/admin/cvtheque',    label: 'CV Thèque',     sub: 'Recherche par compétence', icon: FolderSearch },
      { href: '/admin/interviews',  label: 'Entretiens IA', sub: 'Candidats & analyses',   icon: Video },
      { href: '/admin/recordings',  label: 'Enregistrements', sub: 'Stockage sécurisé',    icon: Mic },
      { href: '/admin/tenants',     label: 'Entreprises',   sub: 'Clients & partenaires',  icon: Building2 },
      { href: '/admin/users',       label: 'Utilisateurs',  sub: 'Comptes & rôles',        icon: Users },
      { href: '/admin/subscriptions', label: 'Abonnements', sub: 'Facturation recruteurs', icon: CreditCard },
    ],
  },
  {
    label: 'SUPPORT',
    items: [
      { href: '/admin/support', label: 'Help Desk', sub: 'Tickets utilisateurs', icon: LifeBuoy },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { href: '/admin/llm-config',      label: 'Config IA',        sub: 'Clés API & modèles',    icon: BrainCircuit },
      { href: '/admin/scoring',         label: 'Pondération IA',   sub: 'Score de matching',      icon: Star },
      { href: '/admin/linkedin',        label: 'Scraping LinkedIn', sub: 'Offres automatiques',   icon: Network },
      { href: '/admin/social',          label: 'Réseaux sociaux',   sub: 'Diffusion des offres', icon: Megaphone },
      { href: '/admin/linkedin-posts',  label: 'LinkedIn Posts',    sub: 'Diffusion & suivi',     icon: Share2 },
      { href: '/admin/linkedin-groups', label: 'Groupes LinkedIn',  sub: 'File d\'attente',       icon: Users2 },
    ],
  },
]

export function AdminNav({ pendingGroupsCount = 0, supportCount = 0 }: { pendingGroupsCount?: number; supportCount?: number }) {
  const path = usePathname()

  function isActive(href: string) {
    if (href === '/admin/homepage') return path === '/admin/homepage'
    if (href === '/admin/pages') return path === '/admin/pages'
    return path === href || path.startsWith(href + '/')
  }

  return (
    <nav className="px-3 space-y-5">
      {SECTIONS.map(section => (
        <div key={section.label}>
          <p className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.14em]"
            style={{ color: '#adb5cc' }}>
            {section.label}
          </p>
          <div className="space-y-0.5">
            {section.items.map(item => {
              const active = isActive(item.href)
              return (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative"
                  style={active ? {
                    background: 'linear-gradient(135deg, rgba(11,29,81,0.09) 0%, rgba(11,29,81,0.05) 100%)',
                    borderLeft: '2px solid #B8860B',
                  } : {
                    borderLeft: '2px solid transparent',
                  }}>
                  <item.icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: active ? '#B8860B' : '#8a90a8', opacity: 1 }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-tight flex items-center gap-1.5"
                      style={{ color: active ? '#0B1D51' : '#3d4566' }}>
                      {item.label}
                      {item.href === '/admin/support' && supportCount > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                          style={{ background: '#B8860B', color: '#fff' }}>
                          {supportCount}
                        </span>
                      )}
                      {item.href === '/admin/linkedin-groups' && pendingGroupsCount > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
                          style={{ background: '#B8860B', color: '#fff' }}>
                          {pendingGroupsCount}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] leading-tight truncate mt-0.5"
                      style={{ color: active ? '#7a82a0' : '#adb5cc' }}>
                      {item.sub}
                    </p>
                  </div>
                  {active && (
                    <div className="absolute right-3 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: '#B8860B' }} />
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
