import { getPage } from '../actions'
import { PageEditor } from './page-editor'
import { notFound } from 'next/navigation'
import type { PageSection } from '../types'
import { getSiteConfig, buildCssVars } from '@/lib/site-config'

export default async function AdminPageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let page
  try {
    page = await getPage(id)
  } catch {
    notFound()
  }

  const sections: PageSection[] = page.sections ? JSON.parse(page.sections) : []
  const config = await getSiteConfig()
  const cssVars = buildCssVars(config)

  return (
    <PageEditor
      pageId={id}
      initialSections={sections}
      initialCssVars={cssVars}
      initialMeta={{
        title: page.title,
        slug: page.slug,
        metaDescription: page.metaDescription ?? '',
        metaKeywords: page.metaKeywords ?? '',
        isPublished: page.isPublished ?? false,
      }}
    />
  )
}
