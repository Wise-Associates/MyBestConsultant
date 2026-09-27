import { getCurrentUser } from '@/lib/appwrite/auth'
import { PricingClient } from './pricing-client'

export const metadata = { title: 'Abonnements — MyBestConsultant' }

export default async function PricingPage() {
  const user = await getCurrentUser()
  return <PricingClient userRole={user?.role ?? null} />
}
