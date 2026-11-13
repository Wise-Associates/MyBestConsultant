import { getCurrentUser } from '@/lib/appwrite/auth'
import { Pricing } from './pricing'

export const metadata = { title: 'Abonnements — MyBestConsultant' }

export default async function PricingPage() {
  const user = await getCurrentUser()
  return <Pricing userRole={user?.role ?? null} />
}
