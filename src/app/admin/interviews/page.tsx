import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getAdminInterviews } from './actions'
import { InterviewsClient } from './interviews-client'

export default async function AdminInterviewsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') redirect('/login')

  const { rows, stats, error } = await getAdminInterviews()

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f9fc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'rgba(11,29,81,0.4)', fontSize: 14 }}>{error}</p>
      </div>
    )
  }

  return <InterviewsClient rows={rows} stats={stats} />
}
