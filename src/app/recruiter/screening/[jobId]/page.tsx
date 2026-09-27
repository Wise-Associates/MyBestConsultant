import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getApplicationsForJob } from '../actions'
import { ScreeningClient } from '../screening-client'

export default async function ScreeningJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')

  const { apps, job, existingResults, error } = await getApplicationsForJob(jobId)

  if (error || !job) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        color: 'var(--color-text-muted)',
      }} className="flex items-center justify-center">
        <p>{error ?? 'Offre introuvable'}</p>
      </div>
    )
  }

  return (
    <ScreeningClient
      jobId={jobId}
      jobTitle={job.title}
      jobDescription={job.description}
      jobSkills={job.skills}
      applications={apps}
      existingResults={existingResults}
    />
  )
}
