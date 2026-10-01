export interface CtaButton {
  id: string
  label: string
  href: string
  style: 'filled' | 'outline' | 'ghost'
  bgColor: string
  textColor: string
  rounded: 'none' | 'sm' | 'md' | 'lg' | 'full'
  size: 'sm' | 'md' | 'lg'
  showFor: 'all' | 'guest' | 'logged'
}

// 'all' = partout, string[] = slugs de pages où afficher
export type PageVisibility = 'all' | string[]

export interface NavLink {
  href: string
  label: string
}

export interface HeaderConfig {
  bgColor: string
  textColor: string
  height: number
  sticky: boolean
  backdropBlur: boolean
  showAccentLine: boolean
  accentLineColor: string
  showBorder: boolean
  showShadow: boolean
  logoHeight: number
  navFontSize: string
  navFontWeight: string
  navActiveStyle: 'underline' | 'pill' | 'bold' | 'none'
  navSpacing: 'tight' | 'normal' | 'wide'
  hoverEffect: 'underline' | 'highlight' | 'scale' | 'bold' | 'none'
  navAlign: 'left' | 'center' | 'right'
  ctaButtons: CtaButton[]
  pages: PageVisibility
  navLinks: NavLink[]
}

export const DEFAULT_HEADER: HeaderConfig = {
  bgColor: 'var(--navbar-bg)',
  textColor: 'var(--navbar-text)',
  height: 68,
  sticky: true,
  backdropBlur: false,
  showAccentLine: true,
  accentLineColor: 'var(--color-primary)',
  showBorder: true,
  showShadow: false,
  logoHeight: 36,
  navFontSize: '14px',
  navFontWeight: '500',
  navActiveStyle: 'underline',
  navSpacing: 'normal',
  navAlign: 'left',
  hoverEffect: 'highlight',
  ctaButtons: [
    {
      id: 'cta-1',
      label: 'Publier une offre',
      href: '/register?role=recruiter',
      style: 'filled',
      bgColor: 'var(--color-primary)',
      textColor: '#ffffff',
      rounded: 'full',
      size: 'md',
      showFor: 'guest',
    },
  ],
  pages: 'all',
  navLinks: [
    { href: '/jobs', label: 'Offres' },
    { href: '/a-propos-de-nous', label: 'A propos de nous' },
    { href: '/blog', label: 'Blog' },
  ],
}

export interface FooterColumn {
  id: string
  title: string
  links: { label: string; href: string }[]
}

export interface SocialLink {
  platform: 'linkedin' | 'twitter' | 'github' | 'facebook' | 'instagram' | 'youtube' | 'pinterest' | 'tiktok'
  url: string
}

export interface FooterConfig {
  bgColor: string
  textColor: string
  mutedColor: string
  paddingY: 'sm' | 'md' | 'lg'
  columns: FooterColumn[]
  bottomText: string
  showSocial: boolean
  socialLinks: SocialLink[]
  showLogo: boolean
  showTagline: boolean
  pages: PageVisibility
}

export const DEFAULT_FOOTER: FooterConfig = {
  bgColor: '#2C2C2E',
  textColor: '#ffffff',
  mutedColor: 'rgba(255,255,255,0.45)',
  paddingY: 'lg',
  columns: [
    {
      id: 'col-1',
      title: 'Pour les candidats',
      links: [
        { label: 'Voir les offres', href: '/jobs' },
        { label: 'Créer un compte', href: '/register?role=candidate' },
        { label: 'Mon espace', href: '/candidate/dashboard' },
      ],
    },
    {
      id: 'col-2',
      title: 'Pour les recruteurs',
      links: [
        { label: 'Publier une offre', href: '/register?role=recruiter' },
        { label: 'Abonnements', href: '/abonnement' },
        { label: 'Mon dashboard', href: '/recruiter/dashboard' },
      ],
    },
    {
      id: 'col-3',
      title: 'MyBestConsultant',
      links: [
        { label: 'À propos', href: '/a-propos-de-nous' },
        { label: 'Contact', href: '/contact' },
        { label: 'Mentions légales', href: '/legal' },
      ],
    },
  ],
  bottomText: '© 2026 MyBestConsultant.fr · Propulsé par Wise Associates',
  showSocial: true,
  socialLinks: [
    { platform: 'linkedin', url: 'https://www.linkedin.com/company/mybestconsultant/' },
    { platform: 'facebook', url: 'https://www.facebook.com/profile.php?id=61595015486903' },
    { platform: 'instagram', url: 'https://www.instagram.com/my.best.consultant/' },
    { platform: 'twitter', url: 'https://x.com/mybestconsultan' },
  ],
  showLogo: true,
  showTagline: true,
  pages: 'all',
}
