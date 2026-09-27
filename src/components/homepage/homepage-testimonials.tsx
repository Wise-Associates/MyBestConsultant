import Link from 'next/link'
import { Clock, Target, TrendingDown, Users, CalendarDays } from 'lucide-react'
import { CALENDLY_URL } from '@/lib/site-links'
import { getSiteConfig } from '@/lib/site-config'

const TESTIMONIALS = [
  { quote: 'Grâce à MyBestConsultant, nous avons réduit notre temps de sourcing de 70% et trouvé les bons profils beaucoup plus rapidement.', name: 'Sophie Martin', role: 'Directrice Recrutement', company: 'AXYON Consulting', photo: '/homepage/testimonials/sophie.jpg' },
  { quote: 'Le matching automatisé est d’une précision impressionnante. Nous recevons uniquement des profils pertinents.', name: 'Julien Moreau', role: 'Responsable Talent Acquisition', company: 'Alteo Conseil', photo: '/homepage/testimonials/julien.jpg' },
  { quote: 'L’IA nous aide à mieux qualifier les consultants et à sécuriser chaque étape du processus de recrutement.', name: 'Claire Dubois', role: 'DRH', company: 'Nexova Group', photo: '/homepage/testimonials/claire.jpg' },
]

const STATS = [
  { icon: Clock, value: '48h', label: 'Recrutement finalisé en moyenne' },
  { icon: Target, value: '92%', label: 'Taux de matching pertinent' },
  { icon: TrendingDown, value: '-70%', label: 'Temps gagné par les recruteurs' },
  { icon: Users, value: '+3x', label: "Plus d'opportunités pour vos consultants" },
]

const GOLD = '#C49A3C'
const TEXT_DARK = '#221B0C'
const TEXT_MUTED = '#736B5A'

export async function HomepageTestimonials() {
  const { homepageContent: c } = await getSiteConfig()
  return (
    <section style={{ background: '#FAFAF8', padding: '96px 24px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto 48px' }}>
          <h2 style={{ color: TEXT_DARK, fontWeight: 700, marginBottom: 14 }}>
            {c.testimonialsTitle}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20, marginBottom: 64 }} className="mbc-testi-grid">
          {TESTIMONIALS.map(t => (
            <div key={t.name} style={{
              background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: 16, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.04)',
            }}>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: TEXT_DARK, opacity: 0.8, marginBottom: 18 }}>
                &ldquo;{t.quote}&rdquo;
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.photo} alt={t.name} style={{
                  width: 36, height: 36, borderRadius: '50%', objectFit: 'cover',
                  border: `1.5px solid rgba(196,154,60,0.5)`, flexShrink: 0,
                }} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>{t.name}</p>
                  <p style={{ fontSize: 11.5, color: TEXT_MUTED, margin: 0 }}>{t.role} · {t.company}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16, marginBottom: 40 }} className="mbc-stats-grid">
          {STATS.map(({ icon: Icon, value, label }) => (
            <div key={label} style={{
              textAlign: 'center', padding: '24px 16px', borderRadius: 16,
              background: 'rgba(196,154,60,0.05)', border: '1px solid rgba(196,154,60,0.2)',
            }}>
              <Icon style={{ width: 20, height: 20, color: GOLD, margin: '0 auto 10px' }} />
              <p style={{ fontSize: 26, fontWeight: 700, color: TEXT_DARK, margin: 0 }}>{value}</p>
              <p style={{ fontSize: 11.5, color: TEXT_MUTED, margin: '4px 0 0', lineHeight: 1.4 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* CTA banner — solid gold, the strongest accent block on the page */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20,
          background: `linear-gradient(135deg,${GOLD},#B8862A)`,
          borderRadius: 20, padding: '28px 32px', boxShadow: '0 20px 50px rgba(196,154,60,0.3)',
        }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: 'white', margin: '0 0 4px' }}>
              {c.testimonialsCtaTitle}
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
              {c.testimonialsCtaSubtitle}
            </p>
          </div>
          <Link href={CALENDLY_URL} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px', borderRadius: 12, fontSize: 13.5, fontWeight: 700, color: GOLD, textDecoration: 'none', background: 'white', whiteSpace: 'nowrap' }}>
            <CalendarDays style={{ width: 15, height: 15 }} />
            {c.testimonialsCtaButton}
          </Link>
        </div>
      </div>

      <style>{`
        @media (min-width: 720px) {
          .mbc-testi-grid { grid-template-columns: repeat(3,1fr) !important; }
        }
        @media (min-width: 620px) {
          .mbc-stats-grid { grid-template-columns: repeat(4,1fr) !important; }
        }
      `}</style>
    </section>
  )
}
