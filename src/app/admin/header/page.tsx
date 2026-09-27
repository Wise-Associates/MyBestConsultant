import { getSiteConfig, getLayoutConfig } from '@/lib/site-config'
import { getPublishedPages } from '@/app/admin/pages/actions'
import { HeaderFooterEditor } from './header-footer-editor'

export default async function HeaderAdminPage() {
  const [cfg, layout, pages] = await Promise.all([
    getSiteConfig(),
    getLayoutConfig(),
    getPublishedPages().catch(() => []),
  ])

  const availablePages = (pages as { slug: string; title: string }[]).map(p => ({
    slug: p.slug,
    title: p.title,
  }))

  return (
    <HeaderFooterEditor
      initialHeader={layout.header}
      initialFooter={layout.footer}
      siteName={cfg.siteName}
      logoUrl={cfg.logoUrl || undefined}
      availablePages={availablePages}
    />
  )
}
