import { getCurrentUser } from '@/lib/appwrite/auth'
import { listAllTickets } from '@/lib/support'
import { AdminSupportClient } from './admin-support-client'

export default async function AdminSupportPage() {
  const user = await getCurrentUser() // l'accès admin est déjà garanti par admin/layout.tsx
  const tickets = await listAllTickets().catch(() => [])
  return <AdminSupportClient tickets={tickets} adminName={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()} now={new Date().toISOString()} />
}
