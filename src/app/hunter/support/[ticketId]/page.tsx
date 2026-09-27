import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getUserTicket } from '@/lib/support'
import { TicketView } from '@/components/support/ticket-view'

export default async function HunterTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')
  const data = await getUserTicket(ticketId, user.userId)
  if (!data) notFound()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <TicketView initialTicket={data.ticket} initialMessages={data.messages} mode="user" backHref="/hunter/support" />
    </div>
  )
}
