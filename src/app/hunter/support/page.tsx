import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listUserTickets } from '@/lib/support'
import { SupportCenter } from '@/components/support/support-center'

export default async function HunterSupportPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')
  const tickets = await listUserTickets(user.userId)
  return <SupportCenter tickets={tickets} basePath="/hunter/support" backHref="/hunter/dashboard" now={new Date().toISOString()} />
}
