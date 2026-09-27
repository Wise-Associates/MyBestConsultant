import Link from 'next/link'
import {
  Zap, TrendingUp, FileEdit, ClipboardCheck, Users, Share2,
  Filter, LayoutDashboard, Bot, Building2, ArrowRight,
} from 'lucide-react'
import { getSiteConfig } from '@/lib/site-config'

const STATS = [
  { icon: Zap, title: '3x PLUS VITE', desc: 'Accélérez chaque étape du recrutement grâce à l’IA.' },
  { icon: TrendingUp, title: '3x PLUS EFFICACE', desc: 'Identifiez les meilleurs profils et concentrez-vous sur ceux qui comptent.' },
]

const CHECKLIST = [
  { icon: FileEdit, text: "Rédaction de l'annonce assistée par l'IA" },
  { icon: ClipboardCheck, text: 'Screening et cotation des CV reçus sur l’annonce' },
  { icon: Users, text: 'Matching automatique avec les CV de la base MBC et de votre vivier' },
  { icon: Share2, text: 'Diffusion simultanée sur les réseaux sociaux avec votre avatar et votre univers' },
  { icon: Filter, text: 'Processus de recrutement clair et auditable (un funnel personnalisable)' },
  { icon: LayoutDashboard, text: 'Dashboard de suivi des recrutements' },
  { icon: Bot, text: "Entretien IA pour vous faire gagner du temps" },
  { icon: Building2, text: 'Création de la page avec votre marque employeur' },
]

const GOLD = '#C49A3C'
const TEXT_DARK = '#221B0C'
const TEXT_MUTED = '#736B5A'

export async function HomepageMission() {
  const { homepageContent: c } = await getSiteConfig()
  return (
    <section style={{ background: '#FFFFFF', padding: '96px 24px' }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr', gap: 56,
      }} className="mbc-mission-grid">

        {/* Left — copy */}
        <div>
          <span style={{
            display: 'inline-block', padding: '5px 14px', borderRadius: 999, marginBottom: 18,
            background: 'rgba(196,154,60,0.1)', color: '#8a6d1f', fontSize: 11.5, fontWeight: 800,
            letterSpacing: '0.08em', textTransform: 'uppercase', border: `1px solid rgba(196,154,60,0.3)`,
          }}>
            {c.missionEyebrow}
          </span>
          <h2 style={{ color: TEXT_DARK, fontWeight: 700, marginBottom: 4 }}>
            {c.missionTitleLine1}<br />
            <span style={{ color: GOLD }}>{c.missionTitleLine2}</span>
          </h2>
          <p style={{ fontSize: 15, color: TEXT_MUTED, marginBottom: 32 }}>
            {c.missionSubtitle}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 36 }}>
            {STATS.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                padding: '18px 16px', borderRadius: 14, background: 'rgba(196,154,60,0.06)',
                border: '1px solid rgba(196,154,60,0.25)',
              }}>
                <Icon style={{ width: 20, height: 20, color: GOLD, marginBottom: 8 }} />
                <p style={{ fontSize: 15, fontWeight: 800, color: TEXT_DARK, margin: '0 0 4px' }}>{title}</p>
                <p style={{ fontSize: 12, lineHeight: 1.4, color: TEXT_MUTED, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>

          <ul style={{ listStyle: 'none', margin: '0 0 36px', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {CHECKLIST.map(({ icon: Icon, text }) => (
              <li key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(196,154,60,0.12)',
                }}>
                  <Icon style={{ width: 14, height: 14, color: GOLD }} />
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5, color: TEXT_DARK, opacity: 0.85, paddingTop: 4 }}>{text}</span>
              </li>
            ))}
          </ul>

          <Link href="/register?role=recruiter"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 12, fontSize: 14, fontWeight: 700, color: 'white', textDecoration: 'none', background: `linear-gradient(135deg,${GOLD},#B8862A)`, boxShadow: '0 10px 26px rgba(196,154,60,0.35)' }}>
            {c.missionCta}
            <ArrowRight style={{ width: 15, height: 15 }} />
          </Link>
        </div>

        {/* Right — video, framed with a decorative light-ring backdrop */}
        <div className="mbc-mission-video" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            {[420, 320, 220].map(size => (
              <span key={size} style={{
                position: 'absolute', width: size, height: size, borderRadius: '50%',
                border: '1px solid rgba(196,154,60,0.2)',
              }} />
            ))}
          </div>

          <div style={{
            position: 'relative', width: '100%', maxWidth: 380, aspectRatio: '3 / 4', borderRadius: 24,
            overflow: 'hidden', border: '1px solid rgba(196,154,60,0.3)',
            boxShadow: '0 30px 70px rgba(0,0,0,0.12), 0 0 60px rgba(196,154,60,0.15)',
          }}>
            <video
              autoPlay muted loop playsInline
              poster="/homepage/mission-portrait.jpg"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            >
              <source src="https://wise-portage.fr/wp-content/uploads/2026/09/0910-2.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 960px) {
          .mbc-mission-grid { grid-template-columns: 1.1fr 0.9fr !important; align-items: center; }
        }
        @media (max-width: 959px) {
          .mbc-mission-video { order: -1; margin-bottom: 40px; }
        }
      `}</style>
    </section>
  )
}
