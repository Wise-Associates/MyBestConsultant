import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getBrandByTenantId } from '@/lib/appwrite/brand'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { canManageTeam, roleOf } from '@/lib/team-roles'
import { BrandEditor } from './brand-editor'

export default async function EmployerBrandPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const brand = await getBrandByTenantId(user.tenantId)
  if (!brand) redirect('/recruiter/dashboard')
  // Nom et logo : propriétaire et administrateurs (ADR 0033) ; le reste de la page, toute l'équipe.
  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>

  return <BrandEditor initial={brand} canEditIdentity={canManageTeam(roleOf(user.userId, tenant))} />
}
