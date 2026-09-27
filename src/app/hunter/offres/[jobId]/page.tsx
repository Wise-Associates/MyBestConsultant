import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById } from '@/lib/appwrite/jobs'
import { listHunterProfiles, listProposals } from '@/lib/hunter'
import { matchProfileToJob } from '@/lib/hunter-match'
import { HunterShell } from '../../hunter-shell'
import { ProposeClient, type ProposeProfile } from './propose-client'

export default async function HunterProposePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')

  const job = await getJobById(jobId)
  if (!job || !job.isActive) notFound()

  const [profiles, proposals] = await Promise.all([listHunterProfiles(user.userId), listProposals(user.userId)])
  const already = new Set(proposals.filter(p => p.jobId === jobId).map(p => p.profileId))

  const rows: ProposeProfile[] = profiles.map(p => {
    const m = matchProfileToJob(p, job)
    return {
      id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), title: p.title, city: p.city, skills: p.skills.slice(0, 8), rate: p.rate,
      availability: p.availability, years: p.yearsOfExperience, hasCv: !!p.cvFileId, alreadyProposed: already.has(p.id),
      score: m.score, matched: m.matchedSkills,
    }
  }).sort((a, b) => b.score - a.score)

  return (
    <HunterShell title={job.title} subtitle={`${job.companyName ? `${job.companyName} · ` : ''}${job.location}`}>
      <ProposeClient
        job={{ id: job.$id, title: job.title, company: job.companyName ?? '', location: job.location, skills: job.skills, description: job.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 700) }}
        profiles={rows} hunterName={`${user.firstName} ${user.lastName}`.trim()}
      />
    </HunterShell>
  )
}
