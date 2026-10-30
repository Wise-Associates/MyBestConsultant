import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { getJourney, isJourneyStoreConfigured, type StoredJourney } from '@/lib/appwrite/consultant-journeys'
import { JourneyView } from './journey-view'

// Parcours d'un consultant sur une offre (ADR 0021). Candidature d'une autre organisation : 404.

export default async function ConsultantJourneyPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { databases } = createAdminClient()
  const application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId).catch(err => {
    if ((err as { code?: number }).code === 404) return null
    throw err
  })
  if (!application || application.tenantId !== user.tenantId) notFound()

  const jobId = application.jobId as string
  const configured = isJourneyStoreConfigured()
  const [candidate, job, stored] = await Promise.all([
    databases.getDocument(DB_ID, COLLECTIONS.USERS, application.candidateId as string).catch(() => null),
    databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(() => null),
    configured ? getJourney(applicationId) : Promise.resolve<StoredJourney | null>(null),
  ])
  // Document d'une autre organisation sous cet identifiant : traité comme absent (ne devrait pas arriver).
  const journeyDoc = stored && stored.tenantId === user.tenantId ? stored : null
  const journey = journeyDoc?.journey ?? null
  const unreadable = journeyDoc !== null && journey === null

  // Une offre publiée depuis un appel d'offres a l'identifiant « ao<offre> » (src/lib/ao/offer-actions.ts).
  const aoOfferId = jobId.startsWith('ao') ? jobId.slice(2) : null

  return (
    <JourneyView
      applicationId={applicationId}
      jobId={jobId}
      candidateName={candidate ? `${candidate.firstName ?? ''} ${candidate.lastName ?? ''}`.trim() || 'Candidat' : 'Candidat'}
      jobTitle={job ? (job.title as string) : null}
      aoOfferId={aoOfferId}
      score={typeof application.aiScore === 'number' ? application.aiScore : null}
      configured={configured}
      journey={journey}
      version={journeyDoc ? journeyDoc.version : null}
      unreadable={unreadable}
    />
  )
}
