import { createAdminClient } from '@/lib/appwrite/client'

export interface SceneConfig {
  imgUrl: string
  videoUrl: string
  title: string
  sub: string
  eyebrow?: string
  align?: 'left' | 'center' | 'right'
  titleSize?: 'sm' | 'md' | 'lg' | 'xl'
  overlayOpacity?: number
  overlayColor?: 'dark' | 'navy' | 'warm' | 'none'
  ctaPrimary?: string
  ctaSecondary?: string
  textColor?: 'white' | 'cream' | 'light'
}
// Editable text for the 5 custom homepage sections (hero/mission/about/testimonials).
// Structural content (icons, lists tied to generated images, feature cards) stays
// code-managed — only headline/paragraph copy is exposed here.
export interface HomepageContent {
  heroCaption: string
  missionEyebrow: string
  missionTitleLine1: string
  missionTitleLine2: string
  missionSubtitle: string
  missionCta: string
  aboutEyebrow: string
  aboutTitle: string
  aboutParagraph1: string
  aboutParagraph2: string
  aboutDifferentiator: string
  testimonialsTitle: string
  testimonialsCtaTitle: string
  testimonialsCtaSubtitle: string
  testimonialsCtaButton: string
  featuresTitle: string
  featuresSubtitle: string
}

export const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  heroCaption: 'Ne manquez plus aucune opportunité : recevez automatiquement celles qui correspondent à votre profil.',
  missionEyebrow: 'Notre mission',
  missionTitleLine1: 'Vous trouvez les meilleurs talents,',
  missionTitleLine2: 'plus vite et plus efficacement',
  missionSubtitle: "Grâce à l'intelligence artificielle.",
  missionCta: 'Créer mon profil',
  aboutEyebrow: 'Qui sommes-nous ?',
  aboutTitle: 'À vos côtés pour activer tout le potentiel de votre vivier',
  aboutParagraph1: 'MyBestConsultant est une plateforme de recrutement mettant en relation les cabinets de conseils avec des consultants spécialisés.',
  aboutParagraph2: 'Notre mission : vous aider à valoriser votre vivier de consultants et à leur proposer les meilleures opportunités, plus vite et plus efficacement.',
  aboutDifferentiator: "Ce qui nous différencie des autres acteurs, c'est bénéficier de l'apport de l'IA pour optimiser l'ensemble du processus de recrutement :",
  testimonialsTitle: 'Ils ont accéléré leur recrutement avec MyBestConsultant',
  testimonialsCtaTitle: 'Prêt à accélérer vos recrutements ?',
  testimonialsCtaSubtitle: 'Découvrez MyBestConsultant en action et voyez déjà la différence.',
  testimonialsCtaButton: 'Réserver ma démo',
  featuresTitle: 'Fonctionnalités détaillées',
  featuresSubtitle: 'Tout ce que la plateforme met à votre disposition pour recruter plus vite.',
}

import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getTemplate, templateVarsToCss, DEFAULT_TEMPLATE_ID, type TemplateVars } from './templates'
import { cache } from 'react'
import { type HeaderConfig, type FooterConfig, DEFAULT_HEADER, DEFAULT_FOOTER } from '@/types/layout'

export type { HeaderConfig, FooterConfig }

export interface SiteConfig {
  templateId: string
  customColors: Partial<TemplateVars>  // all design overrides: colors + typo + style
  // Contenu éditorial
  heroTitle: string
  heroSubtitle: string
  heroCtaRecruiter: string
  heroCtaCandidate: string
  siteTagline: string
  siteName: string
  footerText: string
  statsJobs: string
  statsCompanies: string
  statsCandidates: string
  // Media
  heroImageUrl: string
  heroImageAlt: string
  logoUrl: string
  contactEmail: string
  trustedLogos: string[]
  googleTagId: string
  // SEO (page d'accueil)
  seoTitle: string
  seoDescription: string
  seoKeywords: string  // liste de mots-clés séparés par des virgules
  // Cinematic scenes (immersive homepage)
  scenesConfig: SceneConfig[]
  // Text content for the 5 custom homepage sections
  homepageContent: HomepageContent
  // Layout
  headerConfig: HeaderConfig
  footerConfig: FooterConfig
}

export const DEFAULT_CONFIG: SiteConfig = {
  templateId: DEFAULT_TEMPLATE_ID,
  customColors: {},
  heroTitle: 'Trouvez votre prochaine mission de consulting',
  heroSubtitle: 'MyBestConsultant connecte les meilleurs consultants aux entreprises qui ont besoin de leur expertise.',
  heroCtaRecruiter: 'Publier une offre',
  heroCtaCandidate: 'Trouver une mission',
  siteTagline: 'La plateforme AI des consultants',
  siteName: 'MyBestConsultant',
  footerText: '© 2026 MyBestConsultant.fr · Propulsé par Wise Associates',
  statsJobs: '2 400+',
  statsCompanies: '380+',
  statsCandidates: '15 000+',
  heroImageUrl: '',
  heroImageAlt: 'Consultants au travail',
  logoUrl: '',
  contactEmail: '',
  trustedLogos: [],
  googleTagId: '',
  seoTitle: '',
  seoDescription: '',
  seoKeywords: '',
  scenesConfig: [],
  homepageContent: DEFAULT_HOMEPAGE_CONTENT,
  headerConfig: DEFAULT_HEADER,
  footerConfig: DEFAULT_FOOTER,
}

export const getSiteConfig = cache(async (): Promise<SiteConfig> => {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return DEFAULT_CONFIG
    const doc = result.documents[0]
    return {
      ...DEFAULT_CONFIG,
      templateId: doc.activeTemplate ?? DEFAULT_TEMPLATE_ID,
      customColors: (() => {
        if (!doc.customColors) return {}
        const parsed = JSON.parse(doc.customColors as string)
        const {
          __scenes: _s, __llm: _l, __contactEmail: _c, __trustedLogos: _t, __googleTagId: _g,
          __seoTitle: _st, __seoDescription: _sd, __seoKeywords: _sk, ...colors
        } = parsed
        return colors
      })(),
      contactEmail: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__contactEmail) return parsed.__contactEmail as string
          }
        } catch { /* */ }
        return ''
      })(),
      trustedLogos: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (Array.isArray(parsed.__trustedLogos)) return parsed.__trustedLogos as string[]
          }
        } catch { /* */ }
        return []
      })(),
      googleTagId: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__googleTagId) return parsed.__googleTagId as string
          }
        } catch { /* */ }
        return ''
      })(),
      seoTitle: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__seoTitle) return parsed.__seoTitle as string
          }
        } catch { /* */ }
        return ''
      })(),
      seoDescription: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__seoDescription) return parsed.__seoDescription as string
          }
        } catch { /* */ }
        return ''
      })(),
      seoKeywords: (() => {
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__seoKeywords) return parsed.__seoKeywords as string
          }
        } catch { /* */ }
        return ''
      })(),
      heroTitle: doc.heroTitle ?? DEFAULT_CONFIG.heroTitle,
      heroSubtitle: doc.heroSubtitle ?? DEFAULT_CONFIG.heroSubtitle,
      heroCtaRecruiter: doc.heroCtaRecruiter ?? DEFAULT_CONFIG.heroCtaRecruiter,
      heroCtaCandidate: doc.heroCtaCandidate ?? DEFAULT_CONFIG.heroCtaCandidate,
      siteTagline: doc.siteTagline ?? DEFAULT_CONFIG.siteTagline,
      siteName: doc.siteName ?? DEFAULT_CONFIG.siteName,
      footerText: doc.footerText ?? DEFAULT_CONFIG.footerText,
      statsJobs: doc.statsJobs ?? DEFAULT_CONFIG.statsJobs,
      statsCompanies: doc.statsCompanies ?? DEFAULT_CONFIG.statsCompanies,
      statsCandidates: doc.statsCandidates ?? DEFAULT_CONFIG.statsCandidates,
      heroImageUrl: doc.heroImageUrl ?? '',
      heroImageAlt: doc.heroImageAlt ?? DEFAULT_CONFIG.heroImageAlt,
      logoUrl: doc.logoUrl ?? '',
      scenesConfig: (() => {
        // Scenes are stored inside customColors JSON under __scenes key
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__scenes) {
              const scenes = JSON.parse(parsed.__scenes)
              if (Array.isArray(scenes) && scenes.length === 5) {
                // Rewrite Appwrite storage video URLs to use the server proxy
                const endpoint = process.env.APPWRITE_ENDPOINT ?? 'https://appwrite.dat-articles.com/v1'
                return (scenes as SceneConfig[]).map(s => {
                  const v = s.videoUrl ?? ''
                  // Proxy Appwrite URLs (need auth) and plain http:// URLs (mixed-content block on HTTPS)
                  const needsProxy = v && (v.startsWith(endpoint) || v.startsWith('http://'))
                  return { ...s, videoUrl: needsProxy ? `/api/media/video?url=${encodeURIComponent(v)}` : v }
                })
              }
            }
          }
        } catch { /* fall through to empty */ }
        return []
      })(),
      homepageContent: (() => {
        // Homepage section copy is stored inside customColors JSON under __homepage key
        try {
          if (doc.customColors) {
            const parsed = JSON.parse(doc.customColors as string)
            if (parsed.__homepage) {
              const saved = JSON.parse(parsed.__homepage)
              return { ...DEFAULT_HOMEPAGE_CONTENT, ...saved }
            }
          }
        } catch { /* fall through to defaults */ }
        return DEFAULT_HOMEPAGE_CONTENT
      })(),
      headerConfig: DEFAULT_HEADER,
      footerConfig: DEFAULT_FOOTER,
    }
  } catch {
    return DEFAULT_CONFIG
  }
})

// getSiteConfig() rewrites videoUrl to a /api/media/video proxy path for public playback.
// The homepage editor needs the original, unproxied URLs — saving the proxied path back
// as if it were the source would corrupt it. This reads the same __scenes JSON with no rewrite.
export const getRawScenesConfig = cache(async (): Promise<SceneConfig[]> => {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return []
    const doc = result.documents[0]
    if (!doc.customColors) return []
    const parsed = JSON.parse(doc.customColors as string)
    if (!parsed.__scenes) return []
    const scenes = JSON.parse(parsed.__scenes)
    return Array.isArray(scenes) && scenes.length === 5 ? scenes as SceneConfig[] : []
  } catch {
    return []
  }
})

export const getLayoutConfig = cache(async (): Promise<{ header: HeaderConfig; footer: FooterConfig }> => {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.SITE_LAYOUT, [Query.limit(1)])
    if (result.documents.length === 0) return { header: DEFAULT_HEADER, footer: DEFAULT_FOOTER }
    const raw = result.documents[0].config
    if (!raw) return { header: DEFAULT_HEADER, footer: DEFAULT_FOOTER }
    const parsed = JSON.parse(raw)
    return {
      header: parsed.header ? { ...DEFAULT_HEADER, ...parsed.header } : DEFAULT_HEADER,
      footer: parsed.footer ? { ...DEFAULT_FOOTER, ...parsed.footer } : DEFAULT_FOOTER,
    }
  } catch {
    return { header: DEFAULT_HEADER, footer: DEFAULT_FOOTER }
  }
})

export function buildCssVars(config: SiteConfig): string {
  const template = getTemplate(config.templateId)
  const merged: TemplateVars = { ...template.vars, ...config.customColors }
  return templateVarsToCss(merged)
}
