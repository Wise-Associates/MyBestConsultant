import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import type { InterviewQuestion } from '@/app/recruiter/interviews/actions'
import { VoiceInterviewRoom } from './voice-interview-room'

// Entretien vocal sans clic (ADR 0035) : même entretien et même lien d'invitation que /interview/<session>, avec /v2.
// La salle actuelle (../page.tsx) reste inchangée.
export default async function VoiceInterviewPage({
  params, searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { sessionId } = await params
  const { mode } = await searchParams
  // Webcam par défaut, comme la salle actuelle ; audio seul quand le lien le demande.
  const mediaMode = mode === 'audio' ? 'audio' : 'video'
  // Identifiant Appwrite invalide : Appwrite répondrait 400 (page d'erreur) au lieu d'un lien introuvable.
  if (!/^[\w-]{1,36}$/.test(sessionId)) notFound()
  const { databases } = createAdminClient()

  let session
  try {
    session = await databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
  } catch (err) {
    if ((err as { code?: number } | null)?.code === 404) notFound()
    throw err
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

  let questions: InterviewQuestion[] = []
  try { questions = JSON.parse(String(session.questions ?? '[]')) } catch { questions = [] }
  if (!Array.isArray(questions) || questions.length === 0) notFound()

  return (
    <VoiceInterviewRoom
      sessionId={session.$id}
      candidateName={session.candidateName as string}
      jobTitle={session.jobTitle as string}
      questions={questions}
      mediaMode={mediaMode}
      recordingsBucketId={BUCKETS.RECORDINGS}
    />
  )
}
