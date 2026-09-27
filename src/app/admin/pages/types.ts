export type SectionType = 'hero' | 'text' | 'image_text' | 'cta' | 'cards' | 'stats' | 'image_gallery' | 'divider' | 'custom_html' | 'trusted_logos'

export type HeroVariant =
  | 'default'
  | 'aurora'
  | 'particles'
  | 'spotlight'
  | 'beams'
  | 'retro-grid'
  | 'gradient-mesh'
  | 'glass'
  | 'minimal'
  | 'dark-noise'
  | 'animated'

// bgColor: CSS var like 'var(--color-background)' or hex '#RRGGBB', '' = section default
// sectionHeight: '' = auto, else CSS value like '400px', '100vh'
// imageObjectFit: how image fills its container
// imageObjectPosition: e.g. 'center', '30% 40%' — for drag repositioning

export interface HeroSection {
  type: 'hero'
  variant: HeroVariant
  title: string
  subtitle: string
  imageUrl: string
  imageAlt: string
  imageObjectFit: 'cover' | 'contain'
  imageObjectPosition: string
  ctaLabel: string
  ctaHref: string
  ctaSecondaryLabel: string
  ctaSecondaryHref: string
  align: 'left' | 'center'
  bgColor: string
  sectionHeight: string
}

export interface TextSection {
  type: 'text'
  title: string
  content: string
  align: 'left' | 'center'
  maxWidth: 'narrow' | 'normal' | 'wide'
  bgColor: string
  sectionHeight: string
}

export interface ImageTextSection {
  type: 'image_text'
  title: string
  content: string
  imageUrl: string
  imageAlt: string
  imageObjectFit: 'cover' | 'contain'
  imageObjectPosition: string
  imagePosition: 'left' | 'right'
  ctaLabel: string
  ctaHref: string
  bgColor: string
  sectionHeight: string
}

export interface CtaSection {
  type: 'cta'
  title: string
  subtitle: string
  buttonLabel: string
  buttonHref: string
  buttonSecondaryLabel: string
  buttonSecondaryHref: string
  style: 'primary' | 'dark' | 'light'
  bgColor: string
  sectionHeight: string
}

export interface Card {
  icon: string
  title: string
  body: string
  href: string
}

export interface CardsSection {
  type: 'cards'
  title: string
  subtitle: string
  columns: 2 | 3 | 4
  cards: Card[]
  bgColor: string
  sectionHeight: string
}

export interface StatItem {
  value: string
  label: string
  description: string
}

export interface StatsSection {
  type: 'stats'
  title: string
  items: StatItem[]
  style: 'dark' | 'light'
  bgColor: string
  sectionHeight: string
}

export interface GalleryItem {
  url: string
  alt: string
  caption: string
  href: string
  objectPosition: string
}

export interface ImageGallerySection {
  type: 'image_gallery'
  title: string
  subtitle: string
  layout: 'grid' | 'masonry'
  columns: 2 | 3 | 4
  items: GalleryItem[]
  bgColor: string
  sectionHeight: string
}

export interface DividerSection {
  type: 'divider'
  style: 'line' | 'space' | 'wave'
  bgColor: string
  sectionHeight: string
}

export interface CustomHtmlSection {
  type: 'custom_html'
  html: string
  label: string
  bgColor: string
  sectionHeight: string
}

// Reuses the site-wide partner-logos list managed in Admin > Page d'accueil > Logos
// partenaires — this block just controls WHERE that list is displayed, so logos are
// only ever entered once.
export interface TrustedLogosSection {
  type: 'trusted_logos'
  title: string
  titleSize: 'sm' | 'md' | 'lg'
  titleBold: boolean
  bgColor: string
  sectionHeight: string
}

export type PageSection =
  | HeroSection
  | TextSection
  | ImageTextSection
  | CtaSection
  | CardsSection
  | StatsSection
  | ImageGallerySection
  | DividerSection
  | CustomHtmlSection
  | TrustedLogosSection

export const SECTION_DEFAULTS: Record<SectionType, PageSection> = {
  hero: {
    type: 'hero', variant: 'default', title: 'Titre principal', subtitle: 'Sous-titre descriptif',
    imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
    ctaLabel: 'Commencer', ctaHref: '#',
    ctaSecondaryLabel: 'En savoir plus', ctaSecondaryHref: '#',
    align: 'center', bgColor: '', sectionHeight: '',
  },
  text: {
    type: 'text', title: 'Section texte', content: 'Votre contenu ici...',
    align: 'left', maxWidth: 'normal', bgColor: '', sectionHeight: '',
  },
  image_text: {
    type: 'image_text', title: 'Notre approche', content: 'Description détaillée...',
    imageUrl: '', imageAlt: '', imageObjectFit: 'cover', imageObjectPosition: 'center',
    imagePosition: 'right', ctaLabel: 'En savoir plus', ctaHref: '#',
    bgColor: '', sectionHeight: '',
  },
  cta: {
    type: 'cta', title: 'Prêt à commencer ?', subtitle: 'Rejoignez des milliers de professionnels.',
    buttonLabel: 'Démarrer gratuitement', buttonHref: '/register',
    buttonSecondaryLabel: 'En savoir plus', buttonSecondaryHref: '#',
    style: 'primary', bgColor: '', sectionHeight: '',
  },
  cards: {
    type: 'cards', title: 'Nos services', subtitle: '', columns: 3,
    cards: [
      { icon: '🎯', title: 'Service 1', body: 'Description du service 1.', href: '#' },
      { icon: '💡', title: 'Service 2', body: 'Description du service 2.', href: '#' },
      { icon: '🚀', title: 'Service 3', body: 'Description du service 3.', href: '#' },
    ],
    bgColor: '', sectionHeight: '',
  },
  stats: {
    type: 'stats', title: 'En chiffres', style: 'dark',
    items: [
      { value: '2 400+', label: 'Missions', description: 'Offres actives' },
      { value: '380+', label: 'Entreprises', description: 'Partenaires' },
      { value: '15 000+', label: 'Consultants', description: 'Inscrits' },
    ],
    bgColor: '', sectionHeight: '',
  },
  image_gallery: {
    type: 'image_gallery', title: 'Galerie', subtitle: '', layout: 'grid', columns: 3,
    items: [
      { url: '', alt: 'Image 1', caption: '', href: '', objectPosition: 'center' },
      { url: '', alt: 'Image 2', caption: '', href: '', objectPosition: 'center' },
      { url: '', alt: 'Image 3', caption: '', href: '', objectPosition: 'center' },
    ],
    bgColor: '', sectionHeight: '',
  },
  divider: { type: 'divider', style: 'space', bgColor: '', sectionHeight: '' },
  custom_html: { type: 'custom_html', html: '<!-- Collez votre HTML ici -->', label: 'HTML Custom', bgColor: '', sectionHeight: '' },
  trusted_logos: { type: 'trusted_logos', title: 'Ils nous ont fait confiance', titleSize: 'md', titleBold: false, bgColor: '', sectionHeight: '' },
}
