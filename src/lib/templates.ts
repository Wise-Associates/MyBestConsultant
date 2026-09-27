export interface Template {
  id: string
  name: string
  description: string
  preview: string
  vars: TemplateVars
}

export interface TemplateVars {
  // ── Couleurs ────────────────────────────────────────
  colorPrimary: string
  colorPrimaryFg: string
  colorSecondary: string
  colorAccent: string
  colorBackground: string
  colorSurface: string
  colorBorder: string
  colorText: string
  colorTextMuted: string
  // ── Zones spéciales ─────────────────────────────────
  navbarBg: string
  navbarText: string
  heroBg: string
  heroText: string
  // ── Typographie — Familles ───────────────────────────
  fontHeading: string
  fontBody: string
  // ── Typographie — Tailles ───────────────────────────
  fontSizeBase: string
  fontSizeH1: string
  fontSizeH2: string
  fontSizeH3: string
  fontSizeSmall: string
  // ── Typographie — Poids & espacement ────────────────
  fontWeightHeading: string
  fontWeightBody: string
  lineHeight: string
  letterSpacingHeading: string
  letterSpacingBody: string
  // ── Géométrie & Style ───────────────────────────────
  borderRadius: string
  borderRadiusLg: string
  shadowCard: string
  shadowButton: string
}

export const GOOGLE_FONTS = [
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'Geist', value: "'Geist', sans-serif" },
  { label: 'Poppins', value: "'Poppins', sans-serif" },
  { label: 'DM Sans', value: "'DM Sans', sans-serif" },
  { label: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif" },
  { label: 'Outfit', value: "'Outfit', sans-serif" },
  { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif" },
  { label: 'Manrope', value: "'Manrope', sans-serif" },
  { label: 'Bricolage Grotesque', value: "'Bricolage Grotesque', sans-serif" },
  { label: 'Sora', value: "'Sora', sans-serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
  { label: 'Lora', value: "'Lora', serif" },
  { label: 'Merriweather', value: "'Merriweather', serif" },
  { label: 'Georgia', value: "Georgia, serif" },
]

export const TEMPLATES: Template[] = [
  {
    id: 'modern_blue',
    name: 'Modern Blue',
    description: 'Professionnel et épuré, tons bleus corporate',
    preview: '🔵',
    vars: {
      colorPrimary: '#2563EB',
      colorPrimaryFg: '#FFFFFF',
      colorSecondary: '#EFF6FF',
      colorAccent: '#DBEAFE',
      colorBackground: '#F8FAFC',
      colorSurface: '#FFFFFF',
      colorBorder: '#E2E8F0',
      colorText: '#0F172A',
      colorTextMuted: '#64748B',
      navbarBg: '#0B1D51',
      navbarText: '#FFFFFF',
      heroBg: '#0B1D51',
      heroText: '#FFFFFF',
      fontHeading: "'Inter', sans-serif",
      fontBody: "'Inter', sans-serif",
      fontSizeBase: '16px',
      fontSizeH1: 'clamp(2.4rem, 5vw, 4rem)',
      fontSizeH2: '2rem',
      fontSizeH3: '1.25rem',
      fontSizeSmall: '0.875rem',
      fontWeightHeading: '700',
      fontWeightBody: '400',
      lineHeight: '1.65',
      letterSpacingHeading: '-0.025em',
      letterSpacingBody: '0em',
      borderRadius: '8px',
      borderRadiusLg: '16px',
      shadowCard: '0 1px 4px rgba(0,0,0,0.08)',
      shadowButton: 'none',
    },
  },
  {
    id: 'dark_pro',
    name: 'Dark Pro',
    description: 'Sombre et premium, style tech moderne',
    preview: '⚫',
    vars: {
      colorPrimary: '#818CF8',
      colorPrimaryFg: '#1E1B4B',
      colorSecondary: '#1E1B4B',
      colorAccent: '#312E81',
      colorBackground: '#0F0F0F',
      colorSurface: '#1A1A1A',
      colorBorder: '#2D2D2D',
      colorText: '#F1F5F9',
      colorTextMuted: '#94A3B8',
      navbarBg: '#111111',
      navbarText: '#F1F5F9',
      heroBg: '#0F0F0F',
      heroText: '#F1F5F9',
      fontHeading: "'Space Grotesk', sans-serif",
      fontBody: "'Inter', sans-serif",
      fontSizeBase: '16px',
      fontSizeH1: 'clamp(2.4rem, 5vw, 4.2rem)',
      fontSizeH2: '2rem',
      fontSizeH3: '1.25rem',
      fontSizeSmall: '0.875rem',
      fontWeightHeading: '700',
      fontWeightBody: '400',
      lineHeight: '1.65',
      letterSpacingHeading: '-0.03em',
      letterSpacingBody: '0em',
      borderRadius: '10px',
      borderRadiusLg: '20px',
      shadowCard: '0 2px 12px rgba(0,0,0,0.4)',
      shadowButton: 'none',
    },
  },
  {
    id: 'warm_orange',
    name: 'Warm & Bold',
    description: 'Dynamique et chaleureux, parfait pour attirer les talents',
    preview: '🟠',
    vars: {
      colorPrimary: '#EA580C',
      colorPrimaryFg: '#FFFFFF',
      colorSecondary: '#FFF7ED',
      colorAccent: '#FED7AA',
      colorBackground: '#FFFBF7',
      colorSurface: '#FFFFFF',
      colorBorder: '#FED7AA',
      colorText: '#1C1917',
      colorTextMuted: '#78716C',
      navbarBg: '#FFFFFF',
      navbarText: '#1C1917',
      heroBg: '#EA580C',
      heroText: '#FFFFFF',
      fontHeading: "'Poppins', sans-serif",
      fontBody: "'Inter', sans-serif",
      fontSizeBase: '16px',
      fontSizeH1: 'clamp(2.6rem, 5vw, 4.4rem)',
      fontSizeH2: '2.1rem',
      fontSizeH3: '1.3rem',
      fontSizeSmall: '0.875rem',
      fontWeightHeading: '800',
      fontWeightBody: '400',
      lineHeight: '1.7',
      letterSpacingHeading: '-0.02em',
      letterSpacingBody: '0em',
      borderRadius: '12px',
      borderRadiusLg: '24px',
      shadowCard: '0 2px 8px rgba(234,88,12,0.1)',
      shadowButton: '0 4px 14px rgba(234,88,12,0.3)',
    },
  },
  {
    id: 'minimal_white',
    name: 'Minimal White',
    description: 'Minimaliste et élégant, laisse le contenu parler',
    preview: '⬜',
    vars: {
      colorPrimary: '#18181B',
      colorPrimaryFg: '#FFFFFF',
      colorSecondary: '#F4F4F5',
      colorAccent: '#E4E4E7',
      colorBackground: '#FFFFFF',
      colorSurface: '#FAFAFA',
      colorBorder: '#E4E4E7',
      colorText: '#09090B',
      colorTextMuted: '#71717A',
      navbarBg: '#FFFFFF',
      navbarText: '#09090B',
      heroBg: '#F4F4F5',
      heroText: '#09090B',
      fontHeading: "'Geist', sans-serif",
      fontBody: "'Geist', sans-serif",
      fontSizeBase: '15px',
      fontSizeH1: 'clamp(2.2rem, 4.5vw, 3.8rem)',
      fontSizeH2: '1.875rem',
      fontSizeH3: '1.2rem',
      fontSizeSmall: '0.8125rem',
      fontWeightHeading: '300',
      fontWeightBody: '400',
      lineHeight: '1.7',
      letterSpacingHeading: '-0.04em',
      letterSpacingBody: '0em',
      borderRadius: '4px',
      borderRadiusLg: '8px',
      shadowCard: 'none',
      shadowButton: 'none',
    },
  },
  {
    id: 'mbc_navy_azur',
    name: 'MBC Navy & Azur',
    description: 'Palette officielle MyBestConsultant — marine profond + azur signature',
    preview: '🔷',
    vars: {
      colorPrimary: '#0B2A82',
      colorPrimaryFg: '#FFFFFF',
      colorSecondary: '#EBF4FC',
      colorAccent: '#47B4EA',
      colorBackground: '#F7FAFD',
      colorSurface: '#FFFFFF',
      colorBorder: '#C8DFF0',
      colorText: '#061640',
      colorTextMuted: '#5A7A99',
      navbarBg: '#0B1D51',
      navbarText: '#FFFFFF',
      heroBg: '#0B1D51',
      heroText: '#FFFFFF',
      fontHeading: "'Plus Jakarta Sans', sans-serif",
      fontBody: "'Inter', sans-serif",
      fontSizeBase: '16px',
      fontSizeH1: 'clamp(2.4rem, 5vw, 4.2rem)',
      fontSizeH2: '2rem',
      fontSizeH3: '1.25rem',
      fontSizeSmall: '0.875rem',
      fontWeightHeading: '300',
      fontWeightBody: '400',
      lineHeight: '1.7',
      letterSpacingHeading: '-0.05em',
      letterSpacingBody: '0em',
      borderRadius: '10px',
      borderRadiusLg: '20px',
      shadowCard: '0 2px 12px rgba(11,42,130,0.08)',
      shadowButton: '0 4px 18px rgba(71,180,234,0.25)',
    },
  },
  {
    id: 'corporate_green',
    name: 'Corporate Green',
    description: 'Institutionnel et fiable, inspire confiance',
    preview: '🟢',
    vars: {
      colorPrimary: '#16A34A',
      colorPrimaryFg: '#FFFFFF',
      colorSecondary: '#F0FDF4',
      colorAccent: '#BBF7D0',
      colorBackground: '#F8FBF8',
      colorSurface: '#FFFFFF',
      colorBorder: '#D1FAE5',
      colorText: '#052E16',
      colorTextMuted: '#6B7280',
      navbarBg: '#FFFFFF',
      navbarText: '#052E16',
      heroBg: '#14532D',
      heroText: '#FFFFFF',
      fontHeading: "'Plus Jakarta Sans', sans-serif",
      fontBody: "'Inter', sans-serif",
      fontSizeBase: '16px',
      fontSizeH1: 'clamp(2.4rem, 5vw, 4rem)',
      fontSizeH2: '2rem',
      fontSizeH3: '1.25rem',
      fontSizeSmall: '0.875rem',
      fontWeightHeading: '700',
      fontWeightBody: '400',
      lineHeight: '1.65',
      letterSpacingHeading: '-0.02em',
      letterSpacingBody: '0em',
      borderRadius: '8px',
      borderRadiusLg: '16px',
      shadowCard: '0 1px 4px rgba(0,0,0,0.06)',
      shadowButton: 'none',
    },
  },
]

export const DEFAULT_TEMPLATE_ID = 'modern_blue'

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}

export function templateVarsToCss(vars: TemplateVars): string {
  return `
    --color-primary: ${vars.colorPrimary};
    --color-primary-fg: ${vars.colorPrimaryFg};
    --color-secondary: ${vars.colorSecondary};
    --color-accent: ${vars.colorAccent};
    --color-background: ${vars.colorBackground};
    --color-surface: ${vars.colorSurface};
    --color-border: ${vars.colorBorder};
    --color-text: ${vars.colorText};
    --color-text-muted: ${vars.colorTextMuted};
    --navbar-bg: ${vars.navbarBg};
    --navbar-text: ${vars.navbarText};
    --hero-bg: ${vars.heroBg};
    --hero-text: ${vars.heroText};
    --font-heading: ${vars.fontHeading};
    --font-body: ${vars.fontBody};
    --font-size-base: ${vars.fontSizeBase};
    --font-size-h1: ${vars.fontSizeH1};
    --font-size-h2: ${vars.fontSizeH2};
    --font-size-h3: ${vars.fontSizeH3};
    --font-size-small: ${vars.fontSizeSmall};
    --font-weight-heading: ${vars.fontWeightHeading};
    --font-weight-body: ${vars.fontWeightBody};
    --line-height: ${vars.lineHeight};
    --letter-spacing-heading: ${vars.letterSpacingHeading};
    --letter-spacing-body: ${vars.letterSpacingBody};
    --border-radius: ${vars.borderRadius};
    --border-radius-lg: ${vars.borderRadiusLg};
    --shadow-card: ${vars.shadowCard};
    --shadow-button: ${vars.shadowButton};
  `.trim()
}
