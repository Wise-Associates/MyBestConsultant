'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createApplication, hasApplied } from '@/lib/appwrite/jobs'
import { autoScreenApplication } from '@/app/recruiter/screening/actions'

export async function applyToJob(jobId: string, tenantId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=/jobs/${jobId}`)
  if (user.role !== 'candidate') redirect(`/jobs/${jobId}`)
  if (!user.cvFileId) redirect(`/candidate/dashboard`)

  const already = await hasApplied(jobId, user.$id)
  if (!already) {
    const application = await createApplication({
      jobId,
      tenantId,
      candidateId: user.$id,
      cvFileId: user.cvFileId,
    })
    // This route bypasses /api/apply entirely, so it was the one path where a
    // candidature never got auto-scored — fire-and-forget, same as /api/apply.
    after(() => autoScreenApplication(application.$id))
  }

  redirect(`/candidate/dashboard?applied=${jobId}`)
}
