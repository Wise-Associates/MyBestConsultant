import type { Metadata } from 'next'
import { getPublishedBrands } from '@/lib/appwrite/brand'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { EmployersDirectory } from './directory-client'

export const metadata: Metadata = {
  title: 'Marque employeur | MyBestConsultant',
  description: 'Découvrez la culture, les valeurs et les offres ouvertes des entreprises qui recrutent des consultants et experts IT sur MyBestConsultant.',
}

export default async function EmployersDirectoryPage() {
  const [brands, jobs] = await Promise.all([getPublishedBrands(), getActiveJobs().catch(() => [])])
  const open = new Map<string, number>()
  for (const j of jobs) open.set(j.tenantId, (open.get(j.tenantId) ?? 0) + 1)

  return (
    <EmployersDirectory brands={brands.map(b => ({
      tenantId: b.tenantId, slug: b.slug, name: b.name, logoUrl: b.logoUrl, tagline: b.profile.tagline, sector: b.profile.sector,
      headquarters: b.profile.headquarters, size: b.profile.size, coverUrl: b.profile.coverUrl, openJobs: open.get(b.tenantId) ?? 0,
    }))} />
  )
}
