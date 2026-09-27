import { redirect, notFound } from 'next/navigation'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById } from '@/lib/appwrite/jobs'
import { getJobMatches, unmatchedApplicationIds } from '@/lib/matching-core'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'
import { MatchingClient } from './matching-client'

export default async function MatchingPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const job = await getJobById(jobId)
  if (!job) notFound()
  if (job.tenantId !== user.tenantId && job.tenantId !== '') redirect('/recruiter/dashboard')

  const { matches } = await getJobMatches(jobId)

  // Toute candidature doit avoir son matching : celles que l'analyse automatique a manquées sont relancées en tâche de fond.
  const retry = unmatchedApplicationIds(matches)
  if (retry.length > 0) after(async () => { for (const id of retry) await autoScreenApplication(id) })

  return <MatchingClient jobId={jobId} jobTitle={job.title} initialMatches={matches} />
}
