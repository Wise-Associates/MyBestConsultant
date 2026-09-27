import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getInterviewSessions } from '../../actions'
import { InterviewRoom } from '../../interview-room'

export default async function InterviewRoomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')

  const sessions = await getInterviewSessions()
  const session = sessions.find(s => s.$id === sessionId)

  if (!session) redirect('/recruiter/interviews')

  return (
    <InterviewRoom
      sessionId={session.$id}
      candidateName={session.candidateName}
      jobTitle={session.jobTitle}
      questions={session.questions}
    />
  )
}
