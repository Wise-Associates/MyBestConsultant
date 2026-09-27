import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { listHunterProfiles, listProposals } from '@/lib/hunter'
import { matchProfileToJob } from '@/lib/hunter-match'
import { HunterShell } from '../hunter-shell'
import { OffersClient, type OfferRow } from './offers-client'

export default async function HunterOffersPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')

  const [jobs, profiles, proposals] = await Promise.all([getActiveJobs().catch(() => []), listHunterProfiles(user.userId), listProposals(user.userId)])
  const usable = profiles.filter(p => p.cvFileId)
  const proposedByJob = new Map<string, number>()
  for (const p of proposals) proposedByJob.set(p.jobId, (proposedByJob.get(p.jobId) ?? 0) + 1)

  const rows: OfferRow[] = jobs.map(job => {
    let best: OfferRow['best'] = null
    for (const p of usable) {
      const m = matchProfileToJob(p, job)
      if (!best || m.score > best.score) best = { score: m.score, name: `${p.firstName} ${p.lastName}`.trim() }
    }
    return {
      id: job.$id, title: job.title, company: job.companyName ?? '', location: job.location, contractType: job.contractType ?? null,
      remote: job.remote ?? null, createdAt: job.createdAt, skills: job.skills.slice(0, 6), best, proposed: proposedByJob.get(job.$id) ?? 0,
    }
  })

  return (
    <HunterShell title="Offres" subtitle="Toutes les offres ouvertes — proposez-y les profils de votre vivier">
      <OffersClient rows={rows} hasProfiles={usable.length > 0} />
    </HunterShell>
  )
}
