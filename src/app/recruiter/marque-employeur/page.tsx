import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getBrandByTenantId } from '@/lib/appwrite/brand'
import { BrandEditor } from './brand-editor'

export default async function EmployerBrandPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const brand = await getBrandByTenantId(user.tenantId)
  if (!brand) redirect('/recruiter/dashboard')

  return <BrandEditor initial={brand} />
}
