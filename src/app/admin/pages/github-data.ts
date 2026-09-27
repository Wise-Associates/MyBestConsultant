export interface GithubComponent {
  id: string
  name: string
  category: string
  source: string
  rawUrl: string
  previewBg: string
}

// Base URL for HyperUI raw HTML
const HUI = (cat: string, n: number) =>
  `https://raw.githubusercontent.com/markmead/hyperui/main/public/examples/marketing/${cat}/${n}.html`

// Base URL for Preline full templates
const PRE = (name: string) =>
  `https://raw.githubusercontent.com/htmlstreamofficial/preline/main/templates/${name}/index.html`

const CURATED_COMPONENTS: GithubComponent[] = [
  // ── HyperUI — sections/components ────────────────────────────────
  { id: 'hui-cta-1',        name: 'CTA Centré',           category: 'CTA',          source: 'HyperUI', rawUrl: HUI('ctas', 1),              previewBg: '#0f172a' },
  { id: 'hui-cta-2',        name: 'CTA Split',            category: 'CTA',          source: 'HyperUI', rawUrl: HUI('ctas', 2),              previewBg: '#1e1b4b' },
  { id: 'hui-cta-3',        name: 'CTA Banner',           category: 'CTA',          source: 'HyperUI', rawUrl: HUI('ctas', 3),              previewBg: '#030712' },
  { id: 'hui-stats-1',      name: 'Stats Simple',         category: 'Stats',        source: 'HyperUI', rawUrl: HUI('stats', 1),             previewBg: '#0f172a' },
  { id: 'hui-stats-2',      name: 'Stats Icônes',         category: 'Stats',        source: 'HyperUI', rawUrl: HUI('stats', 2),             previewBg: '#f8fafc' },
  { id: 'hui-stats-3',      name: 'Stats Grille',         category: 'Stats',        source: 'HyperUI', rawUrl: HUI('stats', 3),             previewBg: '#f1f5f9' },
  { id: 'hui-cards-1',      name: 'Cards Simple',         category: 'Cards',        source: 'HyperUI', rawUrl: HUI('cards', 1),             previewBg: '#f8fafc' },
  { id: 'hui-cards-2',      name: 'Cards Image',          category: 'Cards',        source: 'HyperUI', rawUrl: HUI('cards', 2),             previewBg: '#ffffff' },
  { id: 'hui-cards-3',      name: 'Cards Horizontal',     category: 'Cards',        source: 'HyperUI', rawUrl: HUI('cards', 3),             previewBg: '#f9fafb' },
  { id: 'hui-feat-1',       name: 'Features 3col',        category: 'Cards',        source: 'HyperUI', rawUrl: HUI('feature-grids', 1),     previewBg: '#f8fafc' },
  { id: 'hui-feat-2',       name: 'Features Icônes',      category: 'Cards',        source: 'HyperUI', rawUrl: HUI('feature-grids', 2),     previewBg: '#ffffff' },
  { id: 'hui-sections-1',   name: 'Section Hero',         category: 'Hero',         source: 'HyperUI', rawUrl: HUI('sections', 1),          previewBg: '#0f172a' },
  { id: 'hui-sections-2',   name: 'Section Split',        category: 'Hero',         source: 'HyperUI', rawUrl: HUI('sections', 2),          previewBg: '#030712' },
  { id: 'hui-headers-1',    name: 'Header Simple',        category: 'Header',       source: 'HyperUI', rawUrl: HUI('headers', 1),           previewBg: '#ffffff' },
  { id: 'hui-faq-1',        name: 'FAQ Accordéon',        category: 'FAQ',          source: 'HyperUI', rawUrl: HUI('faqs', 1),              previewBg: '#f8fafc' },
  { id: 'hui-faq-2',        name: 'FAQ Split',            category: 'FAQ',          source: 'HyperUI', rawUrl: HUI('faqs', 2),              previewBg: '#ffffff' },
  { id: 'hui-team-1',       name: 'Team Grid',            category: 'Team',         source: 'HyperUI', rawUrl: HUI('team-sections', 1),     previewBg: '#f9fafb' },
  { id: 'hui-team-2',       name: 'Team Cards',           category: 'Team',         source: 'HyperUI', rawUrl: HUI('team-sections', 2),     previewBg: '#ffffff' },
  { id: 'hui-pricing-1',    name: 'Pricing 2 tiers',      category: 'Pricing',      source: 'HyperUI', rawUrl: HUI('pricing', 1),           previewBg: '#f8fafc' },
  { id: 'hui-pricing-2',    name: 'Pricing Tableau',      category: 'Pricing',      source: 'HyperUI', rawUrl: HUI('pricing', 2),           previewBg: '#ffffff' },
  { id: 'hui-contact-1',    name: 'Contact Simple',       category: 'Forms',        source: 'HyperUI', rawUrl: HUI('contact-forms', 1),     previewBg: '#f8fafc' },
  { id: 'hui-contact-2',    name: 'Contact Split',        category: 'Forms',        source: 'HyperUI', rawUrl: HUI('contact-forms', 2),     previewBg: '#ffffff' },
  { id: 'hui-newsletter-1', name: 'Newsletter',           category: 'Forms',        source: 'HyperUI', rawUrl: HUI('newsletter-signup', 1), previewBg: '#0f172a' },
  { id: 'hui-banner-1',     name: 'Bannière Top',         category: 'Banner',       source: 'HyperUI', rawUrl: HUI('banners', 1),           previewBg: '#1e1b4b' },
  { id: 'hui-blog-1',       name: 'Blog Cards',           category: 'Blog',         source: 'HyperUI', rawUrl: HUI('blog-cards', 1),        previewBg: '#f9fafb' },
  { id: 'hui-blog-2',       name: 'Blog Grid',            category: 'Blog',         source: 'HyperUI', rawUrl: HUI('blog-cards', 2),        previewBg: '#ffffff' },
  { id: 'hui-logos-1',      name: 'Logo Cloud',           category: 'Social Proof', source: 'HyperUI', rawUrl: HUI('logo-clouds', 1),       previewBg: '#ffffff' },
  { id: 'hui-logos-2',      name: 'Logo Dark',            category: 'Social Proof', source: 'HyperUI', rawUrl: HUI('logo-clouds', 2),       previewBg: '#0f172a' },
  { id: 'hui-footer-1',     name: 'Footer Simple',        category: 'Footer',       source: 'HyperUI', rawUrl: HUI('footers', 1),           previewBg: '#0f172a' },
  { id: 'hui-footer-2',     name: 'Footer Colonnes',      category: 'Footer',       source: 'HyperUI', rawUrl: HUI('footers', 2),           previewBg: '#030712' },

  // ── Preline — full page templates (HTML complet) ─────────────────
  { id: 'pre-agency',       name: 'Agency (page complète)',    category: 'Page complète', source: 'Preline', rawUrl: PRE('agency'),      previewBg: '#0f172a' },
  { id: 'pre-personal',     name: 'Portfolio (page complète)', category: 'Page complète', source: 'Preline', rawUrl: PRE('personal'),    previewBg: '#ffffff' },
  { id: 'pre-ai-chat',      name: 'AI App (page complète)',    category: 'Page complète', source: 'Preline', rawUrl: PRE('ai-chat'),     previewBg: '#030712' },
]

export const GITHUB_CATEGORIES = [
  'Tous', 'Hero', 'Cards', 'Stats', 'CTA', 'Social Proof', 'Pricing',
  'Forms', 'Team', 'FAQ', 'Header', 'Banner', 'Blog', 'Footer', 'Page complète',
]

export const GITHUB_SOURCES = ['Toutes sources', 'HyperUI', 'Preline']

export function getGithubComponents(category: string, source: string): GithubComponent[] {
  return CURATED_COMPONENTS.filter(c => {
    const catOk = category === 'Tous' || c.category === category
    const srcOk = source === 'Toutes sources' || c.source === source
    return catOk && srcOk
  })
}
