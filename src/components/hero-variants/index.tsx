import type { HeroSection, HeroVariant } from '@/app/admin/pages/types'
import { HeroAnimated } from './hero-animated'

// ── Shared content layer ────────────────────────────────────────────
function HeroContent({ s, textColor = 'white' }: { s: HeroSection; textColor?: string }) {
  const isLight = textColor !== 'white'
  const center = s.align === 'center'
  return (
    <div style={{
      position: 'relative', zIndex: 2,
      width: '100%', maxWidth: '1152px',
      margin: '0 auto',
      padding: 'clamp(4rem,8vw,7rem) clamp(1.5rem,5vw,3rem)',
      textAlign: s.align,
    }}>
      {/* Eyebrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem', justifyContent: center ? 'center' : 'flex-start' }}>
        <div style={{ width: 28, height: 1, background: isLight ? 'var(--color-accent)' : 'rgba(255,255,255,0.4)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: isLight ? 'var(--color-accent)' : 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-body)' }}>
          MyBestConsultant
        </span>
      </div>

      {/* H1 */}
      <h1 style={{
        fontFamily: 'var(--font-heading)',
        fontSize: 'clamp(2.5rem,5.5vw,4.5rem)',
        fontWeight: 'var(--font-weight-heading, 300)',
        letterSpacing: 'var(--letter-spacing-heading, -0.03em)',
        lineHeight: 1.05,
        color: textColor,
        marginBottom: '1.25rem',
        maxWidth: center ? '820px' : '680px',
        margin: center ? '0 auto 1.25rem' : '0 0 1.25rem',
      }}>
        {s.title || 'Titre principal'}
      </h1>

      {/* Subtitle */}
      {s.subtitle && (
        <p style={{
          color: textColor, opacity: isLight ? 0.65 : 0.72,
          fontSize: '1.15rem',
          maxWidth: '580px',
          margin: center ? '0 auto 2.5rem' : '0 0 2.5rem',
          lineHeight: 1.65, fontFamily: 'var(--font-body)', fontWeight: 400,
        }}>
          {s.subtitle}
        </p>
      )}

      {/* CTAs */}
      <div style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', justifyContent: center ? 'center' : 'flex-start' }}>
        {s.ctaLabel && (
          <a href={s.ctaHref || '#'} style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '0.9rem 2.25rem',
            borderRadius: 'var(--border-radius, 6px)',
            background: 'var(--color-primary)', color: 'var(--color-primary-fg)',
            fontWeight: 700, fontSize: '0.9rem',
            textDecoration: 'none', fontFamily: 'var(--font-body)', letterSpacing: '0.02em',
            transition: 'opacity .15s',
          }}>
            {s.ctaLabel}
          </a>
        )}
        {s.ctaSecondaryLabel && (
          <a href={s.ctaSecondaryHref || '#'} style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '0.9rem 2.25rem',
            borderRadius: 'var(--border-radius, 6px)',
            border: isLight ? '2px solid var(--color-border)' : '2px solid rgba(255,255,255,0.3)',
            color: textColor, fontWeight: 600, fontSize: '0.9rem',
            textDecoration: 'none', fontFamily: 'var(--font-body)', letterSpacing: '0.02em',
          }}>
            {s.ctaSecondaryLabel}
          </a>
        )}
      </div>
    </div>
  )
}

function base(s: HeroSection, bg: string): React.CSSProperties {
  return {
    position: 'relative', overflow: 'hidden',
    minHeight: s.sectionHeight || '580px',
    display: 'flex', alignItems: 'center',
    background: s.bgColor || bg,
  }
}

// ── 1. DEFAULT ──────────────────────────────────────────────────────
export function HeroDefault({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, 'var(--hero-bg)')}>
      {s.imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.imageUrl} alt={s.imageAlt} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: s.imageObjectFit || 'cover', objectPosition: s.imageObjectPosition || 'center', zIndex: 0 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1 }} />
        </>
      )}
      <HeroContent s={s} />
    </section>
  )
}

// ── 2. AURORA ───────────────────────────────────────────────────────
export function HeroAurora({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#030014')}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: '65%', height: '65%', top: '-20%', left: '-10%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(44,44,46,0.9) 0%, rgba(88,28,135,0.5) 50%, transparent 70%)', animation: 'mbc-aurora-1 9s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: '60%', height: '60%', top: '5%', right: '-15%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(232,163,61,0.35) 0%, rgba(99,102,241,0.3) 50%, transparent 70%)', animation: 'mbc-aurora-2 11s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: '50%', height: '50%', bottom: '-15%', left: '25%', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(99,102,241,0.55) 0%, rgba(44,44,46,0.25) 50%, transparent 70%)', animation: 'mbc-aurora-3 13s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(100px)' }} />
      </div>
      {/* Grid */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)', backgroundSize: '72px 72px' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 3. PARTICLES ────────────────────────────────────────────────────
export function HeroParticles({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#03001C')}>
      {/* Animated dot field */}
      <div style={{ position: 'absolute', inset: '-64px', backgroundImage: 'radial-gradient(rgba(232,163,61,0.45) 1px, transparent 1px)', backgroundSize: '28px 28px', animation: 'mbc-dots-drift 3s linear infinite' }} />
      {/* Center radial fade */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 75% 65% at 50% 50%, rgba(3,0,28,0) 0%, #03001C 65%)' }} />
      {/* Accent glow */}
      <div style={{ position: 'absolute', width: '45%', height: '45%', top: '15%', left: '27%', background: 'radial-gradient(ellipse, rgba(44,44,46,0.6) 0%, transparent 70%)', animation: 'mbc-pulse-blob 6s ease-in-out infinite' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 4. SPOTLIGHT ────────────────────────────────────────────────────
export function HeroSpotlight({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#050A14')}>
      {/* Spotlight cone from top */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 55% 60% at 50% -5%, rgba(99,102,241,0.28) 0%, transparent 60%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 35% 40% at 50% 5%, rgba(232,163,61,0.14) 0%, transparent 55%)' }} />
      {/* Floor glow */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', background: 'linear-gradient(to top, rgba(99,102,241,0.07), transparent)' }} />
      {/* Grid */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
      {/* Top hairline glow */}
      <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.7), rgba(232,163,61,0.5), rgba(99,102,241,0.7), transparent)', boxShadow: '0 0 20px rgba(99,102,241,0.4)' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 5. BEAMS ────────────────────────────────────────────────────────
export function HeroBeams({ s }: { s: HeroSection }) {
  const beams = [
    { left: '12%', delay: '0s', opacity: 0.45, dur: '6s' },
    { left: '32%', delay: '1.8s', opacity: 0.28, dur: '7.5s' },
    { left: '55%', delay: '3.5s', opacity: 0.38, dur: '6.8s' },
    { left: '76%', delay: '0.9s', opacity: 0.22, dur: '8s' },
  ]
  return (
    <section style={base(s, '#030712')}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {/* Narrow light beams */}
        {beams.map((b, i) => (
          <div key={i} style={{
            position: 'absolute', top: 0, left: b.left,
            width: '1.5px', height: '75%',
            background: `linear-gradient(to bottom, rgba(99,102,241,${b.opacity}), rgba(232,163,61,${b.opacity * 0.6}), transparent)`,
            transform: 'rotate(12deg)', transformOrigin: 'top center',
            animation: `mbc-beam ${b.dur} ease-in-out ${b.delay} infinite`,
          }} />
        ))}
        {/* Wide soft beam */}
        <div style={{ position: 'absolute', top: 0, left: '15%', width: '35%', height: '100%', background: 'linear-gradient(to bottom right, rgba(99,102,241,0.07) 0%, transparent 55%)', transform: 'rotate(12deg)', transformOrigin: 'top left' }} />
      </div>
      {/* Top glow line */}
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '65%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.7), rgba(232,163,61,0.5), transparent)', boxShadow: '0 0 24px rgba(99,102,241,0.35), 0 0 60px rgba(99,102,241,0.12)' }} />
      {/* Dark radial center */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 60% at 50% 50%, transparent 30%, rgba(3,7,18,0.6) 100%)' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 6. RETRO GRID ───────────────────────────────────────────────────
export function HeroRetroGrid({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#020209')}>
      {/* Perspective grid floor */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', bottom: '0', left: '-60%', right: '-60%', height: '60%',
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.28) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.28) 1px,transparent 1px)',
          backgroundSize: '64px 64px',
          transform: 'perspective(350px) rotateX(72deg)',
          transformOrigin: 'bottom center',
          animation: 'mbc-grid-scroll 2.5s linear infinite',
        }} />
        {/* Top/bottom fades */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, #020209 0%, transparent 35%, transparent 65%, #020209 100%)' }} />
      </div>
      {/* Horizon glow */}
      <div style={{ position: 'absolute', bottom: '40%', left: '50%', transform: 'translateX(-50%)', width: '80%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(232,163,61,0.9), rgba(99,102,241,0.7), rgba(232,163,61,0.9), transparent)', boxShadow: '0 0 30px rgba(232,163,61,0.5), 0 0 80px rgba(99,102,241,0.25)' }} />
      {/* Star field */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1px, transparent 1px)', backgroundSize: '55px 55px', backgroundPosition: '20px 20px', opacity: 0.18 }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 7. GRADIENT MESH ────────────────────────────────────────────────
export function HeroGradientMesh({ s }: { s: HeroSection }) {
  return (
    <section style={{
      ...base(s, '#2C2C2E'),
      background: s.bgColor || 'linear-gradient(-45deg,#2C2C2E,#1a0533,#0d1f55,#0e1260)',
      backgroundSize: '400% 400%',
      animation: 'mbc-gradient-shift 8s ease infinite',
    }}>
      {/* Gold dot mesh */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(232,163,61,0.18) 1.5px, transparent 1.5px)', backgroundSize: '36px 36px', opacity: 0.7 }} />
      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, transparent, #E8A33D 40%, rgba(232,163,61,0.3) 60%, transparent)' }} />
      {/* Soft center highlight */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 65% 55% at 50% 50%, rgba(255,255,255,0.04) 0%, transparent 70%)' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── 8. GLASSMORPHISM ────────────────────────────────────────────────
export function HeroGlass({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#08021A')}>
      {/* Bokeh blobs */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 420, height: 420, top: -120, left: -100, background: 'radial-gradient(circle, rgba(99,102,241,0.55) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(70px)', animation: 'mbc-float 7s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 380, height: 380, bottom: -80, right: -80, background: 'radial-gradient(circle, rgba(232,163,61,0.45) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(70px)', animation: 'mbc-float 9s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', width: 320, height: 320, top: '25%', right: '15%', background: 'radial-gradient(circle, rgba(44,44,46,0.8) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(50px)', animation: 'mbc-aurora-2 11s ease-in-out infinite' }} />
      </div>
      {/* Glass card */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: '100%', maxWidth: 920, margin: '2rem auto',
        padding: '4rem 3rem',
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '24px',
        textAlign: s.align,
        boxShadow: '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
      }}>
        <HeroContent s={s} />
      </div>
    </section>
  )
}

// ── 9. MINIMAL ──────────────────────────────────────────────────────
export function HeroMinimal({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, 'var(--color-background)')}>
      {/* Gold top stripe */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, var(--color-primary) 0%, var(--color-accent) 50%, var(--color-primary) 100%)' }} />
      {/* Subtle grid */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(var(--color-border) 1px,transparent 1px),linear-gradient(90deg,var(--color-border) 1px,transparent 1px)', backgroundSize: '80px 80px', opacity: 0.35 }} />
      {/* Radial center white-out */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 70% at 50% 50%, var(--color-background) 20%, transparent 100%)' }} />
      {/* Accent orb */}
      <div style={{ position: 'absolute', top: '-10%', right: '5%', width: 320, height: 320, background: 'radial-gradient(circle, rgba(232,163,61,0.08) 0%, transparent 70%)', borderRadius: '50%', animation: 'mbc-pulse-blob 8s ease-in-out infinite' }} />
      <HeroContent s={s} textColor="var(--color-text)" />
    </section>
  )
}

// ── 10. DARK NOISE ──────────────────────────────────────────────────
export function HeroDarkNoise({ s }: { s: HeroSection }) {
  return (
    <section style={base(s, '#080A10')}>
      {/* Noise texture */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.045, backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")", backgroundSize: '200px 200px' }} />
      {/* Bottom radial gradient */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(to top, rgba(44,44,46,0.45) 0%, transparent 100%)' }} />
      {/* Top gold hairline */}
      <div style={{ position: 'absolute', top: 0, left: '8%', right: '8%', height: '1px', background: 'linear-gradient(90deg, transparent, rgba(232,163,61,0.7), transparent)', boxShadow: '0 0 16px rgba(232,163,61,0.25)' }} />
      {/* Ambient top glow */}
      <div style={{ position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)', width: '65%', height: '65%', background: 'radial-gradient(ellipse, rgba(44,44,46,0.35) 0%, transparent 70%)', animation: 'mbc-pulse-blob 9s ease-in-out infinite' }} />
      <HeroContent s={s} />
    </section>
  )
}

// ── Dispatcher ──────────────────────────────────────────────────────
export function HeroVariantRenderer({ s }: { s: HeroSection }) {
  // Backward compat: sections saved before variant was added default to 'default'
  switch (s.variant ?? 'default') {
    case 'aurora':         return <HeroAurora s={s} />
    case 'particles':      return <HeroParticles s={s} />
    case 'spotlight':      return <HeroSpotlight s={s} />
    case 'beams':          return <HeroBeams s={s} />
    case 'retro-grid':     return <HeroRetroGrid s={s} />
    case 'gradient-mesh':  return <HeroGradientMesh s={s} />
    case 'glass':          return <HeroGlass s={s} />
    case 'minimal':        return <HeroMinimal s={s} />
    case 'dark-noise':     return <HeroDarkNoise s={s} />
    case 'animated':       return <HeroAnimated s={s} />
    default:               return <HeroDefault s={s} />
  }
}

// ── Template picker metadata ─────────────────────────────────────────
export interface HeroTemplate {
  id: HeroVariant
  name: string
  desc: string
  // Inline CSS for the thumbnail bg
  thumbBg: string
  thumbAccent: string
  darkThumb: boolean
}

export const HERO_TEMPLATES: HeroTemplate[] = [
  {
    id: 'default',
    name: 'Classique',
    desc: 'Navy plein fond, image de couverture optionnelle',
    thumbBg: 'linear-gradient(135deg,#2C2C2E 0%,#1a2d70 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    desc: 'Blobs colorés animés — effet galaxie premium',
    thumbBg: 'linear-gradient(135deg,#030014 0%,#1a0533 50%,#2C2C2E 100%)',
    thumbAccent: '#6366f1',
    darkThumb: true,
  },
  {
    id: 'particles',
    name: 'Particles',
    desc: 'Grille de points dorés sur fond sombre animé',
    thumbBg: 'linear-gradient(135deg,#03001C 0%,#070028 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    desc: 'Faisceau lumineux centré sur fond nuit',
    thumbBg: 'linear-gradient(180deg,#050A14 0%,#0d1525 100%)',
    thumbAccent: '#6366f1',
    darkThumb: true,
  },
  {
    id: 'beams',
    name: 'Beams',
    desc: 'Faisceaux de lumière diagonaux animés',
    thumbBg: 'linear-gradient(135deg,#030712 0%,#0a0f1e 100%)',
    thumbAccent: '#818cf8',
    darkThumb: true,
  },
  {
    id: 'retro-grid',
    name: 'Retro Grid',
    desc: 'Grille en perspective façon synthwave',
    thumbBg: 'linear-gradient(180deg,#020209 0%,#08041a 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
  {
    id: 'gradient-mesh',
    name: 'Gradient Mesh',
    desc: 'Dégradé animé navy/indigo en boucle',
    thumbBg: 'linear-gradient(-45deg,#2C2C2E,#1a0533,#0d1f55,#0e1260)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
  {
    id: 'glass',
    name: 'Glassmorphism',
    desc: 'Carte en verre dépoli sur fond bokeh',
    thumbBg: 'linear-gradient(135deg,#08021A 0%,#1a0533 100%)',
    thumbAccent: '#6366f1',
    darkThumb: true,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    desc: 'Blanc pur, grille subtile — consulting grade',
    thumbBg: 'linear-gradient(135deg,#FAFBFF 0%,#F0F3FA 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: false,
  },
  {
    id: 'dark-noise',
    name: 'Dark Noise',
    desc: 'Noir avec texture grain et accents gold',
    thumbBg: 'linear-gradient(135deg,#080A10 0%,#0d1020 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
  {
    id: 'animated',
    name: 'Animé ✦',
    desc: 'Typewriter + pills de services + barre de recherche — hero interactif',
    thumbBg: 'linear-gradient(135deg,#2C2C2E 0%,#3A3A3C 100%)',
    thumbAccent: '#E8A33D',
    darkThumb: true,
  },
]
