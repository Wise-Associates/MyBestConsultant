import { Building2, Users, Briefcase, BrainCircuit, TrendingUp, ArrowUpRight, Palette, Settings, ChevronRight, Activity, Zap, Home } from 'lucide-react'
import Link from 'next/link'

const STATS = [
  {
    label: 'Entreprises actives',
    value: '0',
    sub: 'Tenants en ligne',
    icon: Building2,
    color: '#2563eb',
    href: '/admin/tenants',
  },
  {
    label: 'Utilisateurs',
    value: '0',
    sub: 'Comptes créés',
    icon: Users,
    color: '#7c3aed',
    href: '/admin/users',
  },
  {
    label: 'Offres publiées',
    value: '0',
    sub: 'Missions actives',
    icon: Briefcase,
    color: '#10b981',
    href: '/admin/jobs',
  },
  {
    label: 'Modèle IA actif',
    value: 'IA Actif',
    sub: 'Moteur IA configuré',
    icon: BrainCircuit,
    color: '#f59e0b',
    href: '/admin/llm-config',
  },
]

const QUICK_ACTIONS = [
  { label: 'Page d\'accueil', desc: 'Contenu, design, page builder', icon: Home, href: '/admin/homepage', color: '#7c3aed' },
  { label: 'Design & Thèmes', desc: 'Couleurs, typo, templates', icon: Palette, href: '/admin/design', color: '#2563eb' },
  { label: 'Config IA', desc: 'Modèle LLM et pricing', icon: BrainCircuit, href: '/admin/llm-config', color: '#f59e0b' },
  { label: 'Paramètres', desc: 'Général & intégrations', icon: Settings, href: '/admin/settings', color: 'var(--color-primary)' },
]

const MODULES = [
  { name: 'Auth & Utilisateurs', status: 'live', desc: 'Login, register, rôles' },
  { name: 'Design System', status: 'live', desc: '5 templates + personnalisation' },
  { name: 'Contenu éditorial', status: 'live', desc: 'Landing page, copy' },
  { name: 'Jobs CRUD', status: 'dev', desc: 'Offres recruteur' },
  { name: 'Candidatures', status: 'dev', desc: 'CV, profil candidat' },
  { name: 'Screening IA', status: 'pending', desc: 'Analyse CV par IA' },
  { name: 'Interview virtuel', status: 'pending', desc: 'Agent conversationnel IA' },
  { name: 'Backoffice recruteur', status: 'pending', desc: 'Pipeline, export' },
]

const STATUS_STYLE = {
  live: { label: 'En ligne', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  dev: { label: 'En dev', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  pending: { label: 'Planifié', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

export default function AdminDashboard() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div style={{
      minHeight: '100%',
      backgroundColor: 'var(--color-background)',
      backgroundImage: `linear-gradient(rgba(11,29,81,0.55), rgba(11,29,81,0.55)), url('/recruiter-bg.jpg')`,
      backgroundSize: 'cover',
      backgroundPosition: 'top center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
    }}>
      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(16,185,129,0.18)', color: '#34d399' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                Système opérationnel
              </span>
            </div>
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Vue d&apos;ensemble</h1>
            <p className="text-sm mt-0.5 capitalize" style={{ color: 'rgba(255,255,255,0.5)' }}>{dateStr}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/design"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}>
              <Palette className="h-4 w-4" />
              Personnaliser
            </Link>
            <Link href="/" target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold no-underline transition-all"
              style={{ background: '#2563eb', color: 'white', boxShadow: '0 8px 20px rgba(37,99,235,0.3)' }}>
              <ArrowUpRight className="h-4 w-4" />
              Voir le site
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {STATS.map(s => (
            <Link key={s.label} href={s.href}
              className="group relative overflow-hidden rounded-3xl p-5 no-underline transition-all duration-300 hover:-translate-y-1"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
                style={{ background: `radial-gradient(circle, ${s.color}38, transparent 70%)` }} />
              <div className="relative flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${s.color}18`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                  <s.icon className="h-5 w-5" style={{ color: s.color }} />
                </div>
                <ChevronRight className="h-4 w-4 transition-colors" style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
              </div>
              <div className="relative text-2xl font-bold mb-0.5" style={{ color: 'var(--color-text)' }}>{s.value}</div>
              <div className="relative text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{s.label}</div>
              <div className="relative text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{s.sub}</div>
            </Link>
          ))}
        </div>

        {/* Middle row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Quick actions — 3/5 */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Accès rapide</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {QUICK_ACTIONS.map(a => (
                <Link key={a.label} href={a.href}
                  className="group relative overflow-hidden rounded-3xl p-5 no-underline transition-all duration-300 hover:-translate-y-1"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
                  <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
                    style={{ background: `radial-gradient(circle, ${a.color}38, transparent 70%)` }} />
                  <div className="relative w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${a.color}18`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                    <a.icon className="h-5 w-5" style={{ color: a.color }} />
                  </div>
                  <div className="relative font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{a.label}</div>
                  <div className="relative text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{a.desc}</div>
                </Link>
              ))}
            </div>
          </div>

          {/* Activity — 2/5 */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>Activité récente</h2>
            </div>
            <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {[
                  { msg: 'Site configuré', time: "À l'instant", color: '#10b981' },
                  { msg: 'Moteur IA actif', time: 'Il y a 1 min', color: '#2563eb' },
                  { msg: 'Design: Modern Blue', time: 'Il y a 2 min', color: '#7c3aed' },
                  { msg: 'Admin connecté', time: 'Il y a 3 min', color: '#f59e0b' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                    <span className="text-sm flex-1 truncate" style={{ color: 'var(--color-text)' }}>{item.msg}</span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>{item.time}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 text-center" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Aucune autre activité</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modules status */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>État des modules</h2>
          </div>
          <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {MODULES.map(m => {
                const s = STATUS_STYLE[m.status as keyof typeof STATUS_STYLE]
                return (
                  <div key={m.name} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{m.name}</span>
                      <span className="text-xs ml-3" style={{ color: 'var(--color-text-muted)' }}>{m.desc}</span>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: s.bg, color: s.color }}>
                      {s.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
