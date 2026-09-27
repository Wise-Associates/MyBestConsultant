import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { Metadata } from 'next'
import { SectionRenderer } from '@/components/page-builder/section-renderer'
import type { PageSection } from '@/app/admin/pages/types'
import { SiteNavbar } from '@/components/shared/site-navbar'

// Slugs réservés — ne pas gérer ici
const RESERVED = ['login', 'register', 'jobs', 'candidate', 'recruiter', 'admin', 'api']

interface Props { params: Promise<{ slug: string }> }

async function fetchPage(slug: string) {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, 'pages', [
    Query.equal('slug', slug),
    Query.equal('isPublished', true),
    Query.limit(1),
  ])
  return result.documents[0] ?? null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (RESERVED.includes(slug)) return {}
  const page = await fetchPage(slug)
  if (!page) return {}
  const keywords = (page.metaKeywords as string | undefined)
    ?.split(',').map((k: string) => k.trim()).filter(Boolean)
  return {
    title: `${page.title} — MyBestConsultant`,
    description: page.metaDescription ?? '',
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
  }
}

export default async function PublicPage({ params }: Props) {
  const { slug } = await params
  if (RESERVED.includes(slug)) notFound()

  const page = await fetchPage(slug)
  if (!page) notFound()

  const sections: PageSection[] = page.sections ? JSON.parse(page.sections) : []

  return (
    <div style={{ background: 'var(--color-background)', color: 'var(--color-text)', fontFamily: 'var(--font-body)' }}>
      <SiteNavbar />
      <main>
        {sections.map((section, i) => (
          <SectionRenderer key={i} section={section} />
        ))}
      </main>
    </div>
  )
}
