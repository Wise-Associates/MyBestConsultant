'use client'

import type {
  PageSection, HeroSection, TextSection, ImageTextSection, CtaSection,
  CardsSection, StatsSection, ImageGallerySection, DividerSection, CustomHtmlSection, TrustedLogosSection,
} from '../types'
import { HeroVariantRenderer } from '@/components/hero-variants'
import { HtmlIframe } from '@/components/page-builder/html-iframe'

export function SectionClientRenderer({ section }: { section: PageSection }) {
  switch (section.type) {
    case 'hero':          return <PreviewHero s={section} />
    case 'text':          return <PreviewText s={section} />
    case 'image_text':    return <PreviewImageText s={section} />
    case 'cta':           return <PreviewCta s={section} />
    case 'cards':         return <PreviewCards s={section} />
    case 'stats':         return <PreviewStats s={section} />
    case 'image_gallery': return <PreviewGallery s={section} />
    case 'divider':       return <PreviewDivider s={section} />
    case 'custom_html':   return <PreviewCustomHtml s={section} />
    case 'trusted_logos': return <PreviewTrustedLogos s={section} />
    default:              return null
  }
}

function bg(override: string, fallback: string) {
  return override || fallback
}

function PreviewHero({ s }: { s: HeroSection }) {
  return <HeroVariantRenderer s={s} />
}

function PreviewText({ s }: { s: TextSection }) {
  const maxW = { narrow: 560, normal: 720, wide: '100%' }
  return (
    <section style={{ padding: '3rem 2rem', background: bg(s.bgColor, 'var(--color-background)') }}>
      <div style={{ maxWidth: maxW[s.maxWidth], margin: '0 auto', textAlign: s.align }}>
        {s.title && (
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', marginBottom: '1rem', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.75rem' }}>
            {s.title}
          </h2>
        )}
        {s.content.split('\n').map((p, i) => (
          <p key={i} style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)', marginBottom: '0.75rem', fontFamily: 'var(--font-body)' }}>{p}</p>
        ))}
      </div>
    </section>
  )
}

function PreviewImageText({ s }: { s: ImageTextSection }) {
  const imgLeft = s.imagePosition === 'left'
  return (
    <section style={{ padding: '3.5rem 2rem', background: bg(s.bgColor, 'var(--color-surface)') }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: imgLeft ? 'row' : 'row-reverse', gap: '3rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {s.imageUrl ? (
          <div style={{ flex: 1, minWidth: 200, borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt={s.imageAlt} style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block' }} />
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 200, height: 220, borderRadius: 'var(--border-radius-lg)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', opacity: 0.4 }}>Image</span>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 220 }}>
          {s.title && <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', marginBottom: '0.75rem', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.6rem' }}>{s.title}</h2>}
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)', marginBottom: '1.25rem', fontFamily: 'var(--font-body)' }}>{s.content}</p>
          {s.ctaLabel && (
            <span style={{ display: 'inline-flex', padding: '0.6rem 1.25rem', borderRadius: 'var(--border-radius)', background: 'var(--color-primary)', color: 'var(--color-primary-fg)', fontWeight: 600, fontSize: '0.875rem', fontFamily: 'var(--font-body)' }}>
              {s.ctaLabel}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

function PreviewCta({ s }: { s: CtaSection }) {
  const defaultBg = s.style === 'dark' ? 'var(--hero-bg)' : s.style === 'primary' ? 'var(--color-primary)' : 'var(--color-surface)'
  const textColor = s.style === 'light' ? 'var(--color-text)' : 'white'
  return (
    <section style={{ padding: '4rem 2rem', background: bg(s.bgColor, defaultBg), textAlign: 'center' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: textColor, marginBottom: '0.75rem', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.8rem' }}>{s.title}</h2>
      {s.subtitle && <p style={{ color: textColor, opacity: 0.75, marginBottom: '1.5rem', fontFamily: 'var(--font-body)' }}>{s.subtitle}</p>}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        {s.buttonLabel && <span style={{ display: 'inline-flex', padding: '0.8rem 2rem', borderRadius: 'var(--border-radius)', background: 'white', color: 'black', fontWeight: 700, fontSize: '0.9rem', fontFamily: 'var(--font-body)' }}>{s.buttonLabel}</span>}
        {s.buttonSecondaryLabel && <span style={{ display: 'inline-flex', padding: '0.8rem 2rem', borderRadius: 'var(--border-radius)', border: '1px solid rgba(255,255,255,0.4)', color: textColor, fontSize: '0.9rem', fontFamily: 'var(--font-body)' }}>{s.buttonSecondaryLabel}</span>}
      </div>
    </section>
  )
}

function PreviewCards({ s }: { s: CardsSection }) {
  const colMap: Record<2 | 3 | 4, string> = { 2: 'repeat(2, 1fr)', 3: 'repeat(3, 1fr)', 4: 'repeat(4, 1fr)' }
  return (
    <section style={{ padding: '3.5rem 2rem', background: bg(s.bgColor, 'var(--color-background)') }}>
      {(s.title || s.subtitle) && (
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          {s.title && <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>{s.title}</h2>}
          {s.subtitle && <p style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}>{s.subtitle}</p>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: colMap[s.columns], gap: '1.25rem', maxWidth: 960, margin: '0 auto' }}>
        {s.cards.map((card, i) => (
          <div key={i} style={{ padding: '1.5rem', borderRadius: 'var(--border-radius-lg)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
            {card.icon && <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{card.icon}</div>}
            <h3 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', marginBottom: '0.4rem', fontSize: '1rem', letterSpacing: 'var(--letter-spacing-heading)' }}>{card.title}</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', lineHeight: 'var(--line-height)', fontFamily: 'var(--font-body)' }}>{card.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function PreviewStats({ s }: { s: StatsSection }) {
  const defaultBg = s.style === 'dark' ? 'var(--hero-bg)' : 'var(--color-secondary)'
  const textColor = s.style === 'dark' ? 'white' : 'var(--color-text)'
  return (
    <section style={{ padding: '3.5rem 2rem', background: bg(s.bgColor, defaultBg), textAlign: 'center' }}>
      {s.title && <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: textColor, marginBottom: '2rem', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.75rem' }}>{s.title}</h2>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${s.items.length}, 1fr)`, gap: '2rem', maxWidth: 720, margin: '0 auto' }}>
        {s.items.map((item, i) => (
          <div key={i}>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: s.style === 'dark' ? 'white' : 'var(--color-primary)', fontFamily: 'var(--font-heading)', lineHeight: 1.1 }}>{item.value}</div>
            <div style={{ fontWeight: 600, color: textColor, margin: '0.25rem 0', fontFamily: 'var(--font-body)' }}>{item.label}</div>
            {item.description && <div style={{ fontSize: '0.8rem', opacity: 0.6, color: textColor, fontFamily: 'var(--font-body)' }}>{item.description}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

function PreviewGallery({ s }: { s: ImageGallerySection }) {
  const colMap: Record<2 | 3 | 4, string> = { 2: 'repeat(2, 1fr)', 3: 'repeat(3, 1fr)', 4: 'repeat(4, 1fr)' }
  return (
    <section style={{ padding: '3.5rem 2rem', background: bg(s.bgColor, 'var(--color-background)') }}>
      {(s.title || s.subtitle) && (
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          {s.title && <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 'var(--font-weight-heading)', color: 'var(--color-text)', letterSpacing: 'var(--letter-spacing-heading)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>{s.title}</h2>}
          {s.subtitle && <p style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' }}>{s.subtitle}</p>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: colMap[s.columns], gap: '1rem', maxWidth: 1100, margin: '0 auto' }}>
        {s.items.map((item, i) => (
          <div key={i} style={{ borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-card)', position: 'relative', background: 'var(--color-surface)' }}>
            {item.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt={item.alt}
                style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', height: 200, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '2rem', opacity: 0.2 }}>🖼</span>
              </div>
            )}
            {item.caption && (
              <div style={{ padding: '0.6rem 0.9rem', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)', margin: 0 }}>{item.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function PreviewDivider({ s }: { s: DividerSection }) {
  if (s.style === 'space') return <div style={{ height: 48, background: bg(s.bgColor, 'var(--color-background)') }} />
  return (
    <div style={{ padding: '0.5rem 2rem', background: bg(s.bgColor, 'var(--color-background)') }}>
      <div style={{ borderTop: '1px solid var(--color-border)', maxWidth: 960, margin: '0 auto' }} />
    </div>
  )
}

function PreviewCustomHtml({ s }: { s: CustomHtmlSection }) {
  return <HtmlIframe html={s.html} bgColor={s.bgColor} minHeight={s.sectionHeight} />
}

// The real logos come from Admin > Page d'accueil > Logos partenaires (fetched
// server-side on the public page) — this editor preview just shows a placeholder
// since it can't reach that data client-side.
const TL_TITLE_SIZE: Record<'sm' | 'md' | 'lg', string> = { sm: '11px', md: '15px', lg: '20px' }

function PreviewTrustedLogos({ s }: { s: TrustedLogosSection }) {
  const size = s.titleSize || 'sm'
  return (
    <div style={{ padding: '3rem 2rem', textAlign: 'center', background: bg(s.bgColor, 'var(--color-background)') }}>
      <p style={{
        fontSize: TL_TITLE_SIZE[size], fontWeight: s.titleBold ? 800 : 700,
        letterSpacing: size === 'lg' ? '0.04em' : '0.2em', textTransform: size === 'lg' ? 'none' : 'uppercase',
        color: size === 'lg' ? 'var(--color-text)' : 'var(--color-text-muted)', marginBottom: '1rem',
      }}>
        {s.title || 'Ils nous ont fait confiance'}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', opacity: 0.6 }}>
        Bandeau de logos défilant — les vrais logos (gérés dans Admin → Page d&apos;accueil → Logos partenaires) s&apos;affichent sur la page publiée.
      </p>
    </div>
  )
}
