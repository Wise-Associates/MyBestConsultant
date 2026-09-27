import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getInterviewSessions } from './actions'
import { InterviewsIndexClient } from './interviews-index-client'

export default async function InterviewsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')

  const sessions = await getInterviewSessions()

  return <InterviewsIndexClient sessions={sessions} />
}
