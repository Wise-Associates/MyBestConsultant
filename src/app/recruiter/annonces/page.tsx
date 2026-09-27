import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { loadTenantOverview } from './data'
import { AnnoncesClient, type AnnoncesData } from './annonces-client'

export default async function AnnoncesPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { jobs, apps, stages, interviews, matches, viviers, names } = await loadTenantOverview(user.tenantId)

  const data: AnnoncesData = {
    jobs: jobs.map(j => ({
      id: j.$id, title: j.title, location: j.location, contractType: j.contractType ?? null,
      remote: j.remote ?? null, isActive: j.isActive, createdAt: j.createdAt, expiresAt: j.expiresAt ?? null,
    })),
    stages: stages.map(s => ({ slug: s.slug, label: s.label, color: s.color, order: s.order, autoAction: s.autoAction ?? null })),
    apps: apps.map(a => ({
      id: a.$id, jobId: a.jobId, name: names.get(a.candidateId) ?? 'Candidat', status: a.status,
      score: a.aiScore ?? null, createdAt: a.createdAt,
    })),
    interviews: interviews.map(i => ({ appId: i.applicationId as string, status: i.status as string })),
    matchCountByJob: (() => {
      const c: Record<string, number> = {}
      for (const m of matches) c[m.jobId as string] = (c[m.jobId as string] ?? 0) + 1
      for (const v of viviers) if (v.matchScore != null) c[v.jobId as string] = (c[v.jobId as string] ?? 0) + 1
      return c
    })(),
    generatedAt: new Date().toISOString(),
  }

  return <AnnoncesClient data={data} />
}
