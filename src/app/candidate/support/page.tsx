import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listUserTickets } from '@/lib/support'
import { SupportCenter } from '@/components/support/support-center'

export default async function CandidateSupportPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'candidate') redirect('/login')
  const tickets = await listUserTickets(user.userId)
  return <SupportCenter tickets={tickets} basePath="/candidate/support" backHref="/candidate/dashboard" now={new Date().toISOString()} />
}
