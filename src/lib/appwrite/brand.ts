import { Query } from 'node-appwrite'
import { createAdminClient } from './client'
import { DB_ID, COLLECTIONS } from './config'
import { parseBrand, type BrandProfile } from '@/lib/brand'

export interface EmployerBrand {
  tenantId: string
  slug: string
  name: string
  logoUrl: string
  published: boolean
  profile: BrandProfile
}

function docToBrand(doc: Record<string, unknown>): EmployerBrand {
  return {
    tenantId: doc.$id as string,
    slug: (doc.slug as string) ?? '',
    name: (doc.name as string) ?? '',
    logoUrl: (doc.logoUrl as string) ?? '',
    published: doc.brandPublished === true,
    profile: parseBrand(doc.brandJson as string | undefined),
  }
}

export async function getBrandByTenantId(tenantId: string): Promise<EmployerBrand | null> {
  try {
    const { databases } = createAdminClient()
    return docToBrand(await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId) as unknown as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function getBrandBySlug(slug: string): Promise<EmployerBrand | null> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('slug', slug), Query.limit(1)])
    return res.documents[0] ? docToBrand(res.documents[0] as unknown as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function getPublishedBrands(): Promise<EmployerBrand[]> {
  try {
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('brandPublished', true), Query.limit(200)])
    return res.documents.map(d => docToBrand(d as unknown as Record<string, unknown>))
  } catch {
    return []
  }
}
