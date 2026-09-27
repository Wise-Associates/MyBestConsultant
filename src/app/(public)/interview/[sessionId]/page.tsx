import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { InterviewRoomCandidate } from './interview-room-candidate'

export default async function CandidateInterviewPage({
  params, searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { sessionId } = await params
  const { mode } = await searchParams
  // Webcam by default — audio-only only when a link explicitly asks for it.
  const mediaMode = mode === 'audio' ? 'audio' : 'video'
  const { databases } = createAdminClient()

  let session
  try {
    session = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
  } catch {
    notFound()
  }

  if (session.status === 'completed' || session.status === 'analysed') {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0C10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: 56, marginBottom: '1.5rem' }}>✅</div>
          <h1 style={{ color: 'white', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            Entretien terminé
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>
            Merci {session.candidateName as string}. Votre entretien a bien été enregistré.<br />
            Vous serez contacté prochainement par le recruteur.
          </p>
        </div>
      </div>
    )
  }

  const questions = JSON.parse(session.questions as string ?? '[]')

  return (
    <InterviewRoomCandidate
      sessionId={sessionId}
      candidateName={session.candidateName as string}
      jobTitle={session.jobTitle as string}
      questions={questions}
      mediaMode={mediaMode}
      recordingsBucketId={BUCKETS.RECORDINGS}
    />
  )
}
