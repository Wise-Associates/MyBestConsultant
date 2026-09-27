import { FileEdit, Users, Gauge, MessageSquareText } from 'lucide-react'
import { getSiteConfig } from '@/lib/site-config'

const FEATURES = [
  { icon: FileEdit, title: "Rédaction de l'offre assisté par l'IA", desc: "Générez des offres claires et attractives en quelques clics grâce à l'IA." },
  { icon: Users, title: 'Matching automatique', desc: "L'IA analyse et sélectionne les meilleurs profils correspondant à vos besoins." },
  { icon: Gauge, title: 'Scorecard', desc: 'Évaluez objectivement chaque candidat grâce à un scoring intelligent et transparent.' },
  { icon: MessageSquareText, title: 'Entretien avec un consultant RH IA', desc: 'Conduisez des entretiens automatisés et obtenez des recommandations pertinentes.' },
]

const GOLD = '#C49A3C'
const TEXT_DARK = '#221B0C'
const TEXT_MUTED = '#736B5A'

export async function HomepageAbout() {
  const { homepageContent: c } = await getSiteConfig()
  return (
    <section style={{ position: 'relative', overflow: 'hidden', background: '#FAFAF8', padding: '96px 24px' }}>
      {/* Faint gold glow, kept subtle to preserve the light, airy feel */}
      <div aria-hidden style={{ position: 'absolute', top: '-10%', left: '-8%', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(196,154,60,0.08), transparent 70%)', pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', bottom: '-15%', right: '-10%', width: 520, height: 520, borderRadius: '50%', background: 'radial-gradient(circle, rgba(196,154,60,0.06), transparent 70%)', pointerEvents: 'none' }} />

      <div style={{
        position: 'relative', maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr', gap: 56,
      }} className="mbc-about-grid">

        {/* Left — photo with logo badge, styled with a glowing gold frame */}
        <div className="mbc-about-photo" style={{ position: 'relative' }}>
          <div aria-hidden style={{
            position: 'absolute', inset: -14, borderRadius: 32,
            background: 'linear-gradient(135deg, rgba(196,154,60,0.3), transparent 60%)',
            filter: 'blur(2px)', pointerEvents: 'none',
          }} />
          <div style={{
            position: 'relative', borderRadius: 22, overflow: 'hidden', aspectRatio: '4 / 5',
            border: '1px solid rgba(196,154,60,0.3)',
            boxShadow: '0 30px 70px rgba(0,0,0,0.12), 0 0 60px rgba(196,154,60,0.1)',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/homepage/about-portrait.jpg" alt="L'équipe MyBestConsultant"
              className="mbc-about-img"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform 0.6s ease' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,0.25), transparent 40%)' }} />
          </div>
          <div style={{
            position: 'absolute', left: 20, bottom: -20, width: 76, height: 76, borderRadius: '50%',
            background: '#FFFFFF', boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 0 0 4px rgba(196,154,60,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, zIndex: 2,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="MyBestConsultant" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        </div>

        {/* Right — copy */}
        <div>
          <span style={{
            display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: GOLD, marginBottom: 14,
          }}>
            {c.aboutEyebrow}
          </span>
          <h2 style={{ color: TEXT_DARK, fontWeight: 700, marginBottom: 22 }}>
            {c.aboutTitle}
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: TEXT_MUTED, marginBottom: 16 }}>
            {c.aboutParagraph1}
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: TEXT_MUTED, marginBottom: 32 }}>
            {c.aboutParagraph2}
          </p>

          <p style={{
            fontSize: 14, fontWeight: 700, color: GOLD, lineHeight: 1.6,
            borderTop: '1px solid rgba(196,154,60,0.25)', paddingTop: 28, marginBottom: 28,
          }}>
            {c.aboutDifferentiator}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="mbc-about-feature" style={{ padding: 14, borderRadius: 14, transition: 'background 0.25s ease' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(196,154,60,0.12)', marginBottom: 12,
                }}>
                  <Icon style={{ width: 18, height: 18, color: GOLD }} />
                </div>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: TEXT_DARK, margin: '0 0 6px' }}>{title}</p>
                <p style={{ fontSize: 12.5, lineHeight: 1.5, color: TEXT_MUTED, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 960px) {
          .mbc-about-grid { grid-template-columns: 0.85fr 1.15fr !important; align-items: center; }
        }
        .mbc-about-photo:hover .mbc-about-img { transform: scale(1.04); }
        .mbc-about-feature:hover { background: rgba(196,154,60,0.06); }
      `}</style>
    </section>
  )
}
