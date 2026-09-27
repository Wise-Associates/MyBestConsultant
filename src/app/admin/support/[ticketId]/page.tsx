import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getSupportTicket } from '@/lib/support'
import { TicketView } from '@/components/support/ticket-view'

export default async function AdminTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  const user = await getCurrentUser() // l'accès admin est déjà garanti par admin/layout.tsx
  if (!user || user.role !== 'admin') notFound()
  const data = await getSupportTicket(ticketId)
  if (!data) notFound()
  return <TicketView initialTicket={data.ticket} initialMessages={data.messages} mode="admin" backHref="/admin/support" adminName={`${user.firstName} ${user.lastName}`.trim()} />
}
