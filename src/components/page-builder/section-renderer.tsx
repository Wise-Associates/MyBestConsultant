import Link from 'next/link'
import type {
  PageSection, HeroSection, TextSection, ImageTextSection, CtaSection,
  CardsSection, StatsSection, ImageGallerySection, DividerSection, CustomHtmlSection, TrustedLogosSection,
} from '@/app/admin/pages/types'
import { HeroVariantRenderer } from '@/components/hero-variants'
import { HtmlIframe } from '@/components/page-builder/html-iframe'
import { TrustedLogosMarquee } from '@/components/shared/trusted-logos-marquee'
import { getSiteConfig } from '@/lib/site-config'

export function SectionRenderer({ section }: { section: PageSection }) {
  switch (section.type) {
    case 'hero':          return <HeroBlock s={section} />
    case 'text':          return <TextBlock s={section} />
    case 'image_text':    return <ImageTextBlock s={section} />
    case 'cta':           return <CtaBlock s={section} />
    case 'cards':         return <CardsBlock s={section} />
    case 'stats':         return <StatsBlock s={section} />
    case 'image_gallery': return <GalleryBlock s={section} />
    case 'divider':       return <DividerBlock s={section} />
    case 'custom_html':   return <CustomHtmlBlock s={section} />
    case 'trusted_logos': return <TrustedLogosSectionBlock s={section} />
    default:              return null
  }
}

function b(override: string, fallback: string) { return override || fallback }

function HeroBlock({ s }: { s: HeroSection }) {
  return <HeroVariantRenderer s={s} />
}

function TextBlock({ s }: { s: TextSection }) {
  const maxWidthMap = { narrow: '640px', normal: '800px', wide: '1100px' }
  return (
    <section className="py-16 px-6" style={{ background: b(s.bgColor, 'var(--color-background)') }}>
      <div style={{ maxWidth: maxWidthMap[s.maxWidth], margin: '0 auto', textAlign: s.align }}>
        {s.title && <h2 className="mb-4" style={{ color: 'var(--color-text)' }}>{s.title}</h2>}
        <div style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)' }}>
          {s.content.split('\n').map((para, i) => <p key={i}>{para}</p>)}
        </div>
      </div>
    </section>
  )
}

function ImageTextBlock({ s }: { s: ImageTextSection }) {
  // Image is always the first DOM element — on mobile that means it naturally lands on
  // top with a plain column layout (no reversal). The left/right `imagePosition` setting
  // only kicks in from the md breakpoint up, via flex-row / flex-row-reverse.
  // (Previously an inline `flexDirection` style overrode the responsive classes at every
  // breakpoint, so the mobile layout never actually stacked — that was the bug.)
  const imgFirst = s.imagePosition === 'left'
  return (
    <section className="py-14 md:py-20 px-6" style={{ background: b(s.bgColor, 'var(--color-surface)') }}>
      <div className={`max-w-6xl mx-auto flex flex-col ${imgFirst ? 'md:flex-row' : 'md:flex-row-reverse'} items-center gap-8 md:gap-12`}>
        {s.imageUrl && (
          <div className="w-full md:flex-1 rounded-[var(--border-radius-lg)] overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.imageUrl} alt={s.imageAlt} className="w-full h-56 sm:h-72 md:h-96 object-cover" />
          </div>
        )}
        <div className="w-full md:flex-1 space-y-4 md:space-y-5">
          {s.title && <h2 style={{ color: 'var(--color-text)' }}>{s.title}</h2>}
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)' }}>{s.content}</p>
          {s.ctaLabel && (
            <Link href={s.ctaHref} className="inline-flex items-center px-6 py-3 rounded-[var(--border-radius)] font-semibold text-sm"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', boxShadow: 'var(--shadow-button)' }}>
              {s.ctaLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

function CtaBlock({ s }: { s: CtaSection }) {
  const defaultBg = s.style === 'dark' ? 'var(--hero-bg)' : s.style === 'primary' ? 'var(--color-primary)' : 'var(--color-surface)'
  const textColor = s.style === 'light' ? 'var(--color-text)' : 'white'
  return (
    <section className="py-14 md:py-20 px-6" style={{ background: b(s.bgColor, defaultBg) }}>
      <div className="max-w-3xl mx-auto text-center space-y-6">
        <h2 style={{ color: textColor }}>{s.title}</h2>
        {s.subtitle && <p className="text-lg opacity-75" style={{ color: textColor }}>{s.subtitle}</p>}
        <div className="flex flex-wrap gap-3 justify-center">
          {s.buttonLabel && (
            <Link href={s.buttonHref} className="inline-flex items-center px-8 py-3.5 rounded-[var(--border-radius)] font-semibold text-sm bg-white hover:bg-white/90 transition-colors"
              style={{ color: s.style === 'light' ? 'var(--color-primary)' : 'black' }}>
              {s.buttonLabel}
            </Link>
          )}
          {s.buttonSecondaryLabel && (
            <Link href={s.buttonSecondaryHref} className="inline-flex items-center px-8 py-3.5 rounded-[var(--border-radius)] font-semibold text-sm border border-white/40 hover:border-white/70 transition-colors" style={{ color: textColor }}>
              {s.buttonSecondaryLabel}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}

function CardsBlock({ s }: { s: CardsSection }) {
  const colClass = { 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' }
  return (
    <section className="py-14 md:py-20 px-6" style={{ background: b(s.bgColor, 'var(--color-background)') }}>
      <div className="max-w-6xl mx-auto">
        {(s.title || s.subtitle) && (
          <div className="text-center mb-12 space-y-3">
            {s.title && <h2 style={{ color: 'var(--color-text)' }}>{s.title}</h2>}
            {s.subtitle && <p style={{ color: 'var(--color-text-muted)' }}>{s.subtitle}</p>}
          </div>
        )}
        <div className={`grid ${colClass[s.columns]} gap-6`}>
          {s.cards.map((card, i) => (
            <div key={i} className="p-6 rounded-[var(--border-radius-lg)]"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              {card.icon && <div className="text-3xl mb-4">{card.icon}</div>}
              <h3 className="mb-2" style={{ color: 'var(--color-text)' }}>{card.title}</h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)', lineHeight: 'var(--line-height)' }}>{card.body}</p>
              {card.href && card.href !== '#' && (
                <Link href={card.href} className="inline-flex items-center mt-4 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  En savoir plus →
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function StatsBlock({ s }: { s: StatsSection }) {
  const defaultBg = s.style === 'dark' ? 'var(--hero-bg)' : 'var(--color-secondary)'
  const textColor = s.style === 'dark' ? 'white' : 'var(--color-text)'
  return (
    <section className="py-14 md:py-20 px-6" style={{ background: b(s.bgColor, defaultBg) }}>
      <div className="max-w-5xl mx-auto text-center">
        {s.title && <h2 className="mb-12" style={{ color: textColor }}>{s.title}</h2>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {s.items.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="text-4xl font-bold" style={{ color: s.style === 'dark' ? 'white' : 'var(--color-primary)', fontFamily: 'var(--font-heading)' }}>{item.value}</div>
              <div className="font-semibold text-lg" style={{ color: textColor }}>{item.label}</div>
              {item.description && <div className="text-sm opacity-60" style={{ color: textColor }}>{item.description}</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function GalleryBlock({ s }: { s: ImageGallerySection }) {
  const colClass = { 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' }
  return (
    <section className="py-14 md:py-20 px-6" style={{ background: b(s.bgColor, 'var(--color-background)') }}>
      <div className="max-w-6xl mx-auto">
        {(s.title || s.subtitle) && (
          <div className="text-center mb-12 space-y-3">
            {s.title && <h2 style={{ color: 'var(--color-text)' }}>{s.title}</h2>}
            {s.subtitle && <p style={{ color: 'var(--color-text-muted)' }}>{s.subtitle}</p>}
          </div>
        )}
        <div className={`grid ${colClass[s.columns]} gap-4`}>
          {s.items.map((item, i) => (
            <div key={i} className="rounded-[var(--border-radius-lg)] overflow-hidden group relative"
              style={{ boxShadow: 'var(--shadow-card)', background: 'var(--color-surface)' }}>
              {item.url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.alt} className="w-full h-56 object-cover group-hover:scale-105 transition-transform duration-500" />
                  {item.href && item.href !== '#' && (
                    <Link href={item.href} className="absolute inset-0" aria-label={item.alt} />
                  )}
                </>
              ) : (
                <div className="w-full h-56 flex items-center justify-center" style={{ background: 'var(--color-surface)' }}>
                  <span className="text-3xl opacity-20">🖼</span>
                </div>
              )}
              {item.caption && (
                <div className="px-4 py-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{item.caption}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DividerBlock({ s }: { s: DividerSection }) {
  if (s.style === 'space') return <div className="py-10" style={{ background: b(s.bgColor, 'var(--color-background)') }} />
  return (
    <div className="px-6 py-4" style={{ background: b(s.bgColor, 'var(--color-background)') }}>
      <div className="max-w-6xl mx-auto border-t" style={{ borderColor: 'var(--color-border)' }} />
    </div>
  )
}

async function TrustedLogosSectionBlock({ s }: { s: TrustedLogosSection }) {
  const cfg = await getSiteConfig()
  return (
    <TrustedLogosMarquee
      logos={cfg.trustedLogos} title={s.title} bgColor={s.bgColor}
      titleSize={s.titleSize || 'sm'} titleBold={s.titleBold ?? false}
    />
  )
}

function CustomHtmlBlock({ s }: { s: CustomHtmlSection }) {
  return <HtmlIframe html={s.html} bgColor={s.bgColor} minHeight={s.sectionHeight} />
}
