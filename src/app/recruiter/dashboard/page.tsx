import { displayEmail } from '@/lib/candidate-identity'
import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant, getApplicationsByTenant } from '@/lib/appwrite/jobs'
import { getFunnelStages } from '@/lib/appwrite/funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { Briefcase, Users, Star, TrendingUp } from 'lucide-react'
import { CreateJobDialog } from './create-job-dialog'
import type { CandidateApp } from './applications-panel'
import { JobsListClient } from './jobs-list-client'
import type { Application } from '@/types'

// Les Server Actions de cette page (création d'offre, import, « Publier sur les réseaux ») envoient la publication
// en arrière-plan : photo de l'affiche par OpenAI (jusqu'à 2 min) puis envoi à Make.
export const maxDuration = 300

// "Matching IA" badge on the jobs list — how many candidates (pool + vivier) the AI has
// already matched for each job, without opening the dedicated Matching page per job.
async function countMatchesByJob(tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  try {
    const { databases } = createAdminClient()
    const [poolRes, vivierRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('tenantId', tenantId), Query.limit(500)]),
      // Vivier général (CV sans offre) exclu : il ne compte pas ici et remplirait la limite.
      databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', tenantId), Query.isNotNull('jobId'), Query.limit(500)]),
    ])
    for (const d of poolRes.documents) counts[d.jobId as string] = (counts[d.jobId as string] ?? 0) + 1
    for (const d of vivierRes.documents) {
      if (d.matchScore == null) continue
      counts[d.jobId as string] = (counts[d.jobId as string] ?? 0) + 1
    }
  } catch { /* badge just stays hidden for those jobs */ }
  return counts
}

async function resolveCandidateNames(
  applications: Application[]
): Promise<Map<string, { name: string; email: string }>> {
  const map = new Map<string, { name: string; email: string }>()
  if (applications.length === 0) return map
  try {
    const candidateIds = [...new Set(applications.map(a => a.candidateId))]
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('$id', candidateIds.slice(0, 25)),
      Query.limit(25),
    ])
    for (const doc of result.documents) {
      map.set(doc.$id, {
        name: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim(),
        email: displayEmail(doc),
      })
    }
  } catch { /* silently skip */ }
  return map
}

export default async function RecruiterDashboard({ searchParams }: { searchParams: Promise<{ offre?: string | string[] }> }) {
  // ?offre=<id> : offre à montrer dans « Mes offres » (lien « Republier depuis le tableau de bord » du suivi des appels
  // d'offres). Seulement comparé aux identifiants des offres déjà chargées pour l'organisation.
  const { offre } = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.tenantId) redirect('/login')

  const { latestPostsByJob, isMakeConfigured } = await import('@/lib/social')
  const [jobs, allApplications, matchCountByJob, funnelStages, socialPosts] = await Promise.all([
    getJobsByTenant(user.tenantId),
    getApplicationsByTenant(user.tenantId),
    countMatchesByJob(user.tenantId),
    getFunnelStages(user.tenantId),
    latestPostsByJob(user.tenantId),
  ])
  const socialByJob = Object.fromEntries(Object.entries(socialPosts).map(([id, p]) => [id, { status: p.status, results: p.results, stale: p.stale }]))

  const candidateMap = await resolveCandidateNames(allApplications)

  const activeJobs = jobs.filter(j => j.isActive)
  const appsByJob = new Map<string, Application[]>()
  for (const app of allApplications) {
    if (!appsByJob.has(app.jobId)) appsByJob.set(app.jobId, [])
    appsByJob.get(app.jobId)!.push(app)
  }

  const scoredApps = allApplications.filter(a => a.aiScore != null)
  const avgScore = scoredApps.length > 0
    ? Math.round(scoredApps.reduce((s, a) => s + (a.aiScore ?? 0), 0) / scoredApps.length)
    : null
  const acceptedCount = allApplications.filter(a => a.status === 'accepted').length
  const selectionRate = allApplications.length > 0
    ? Math.round((acceptedCount / allApplications.length) * 100)
    : null

  // Pre-built for every job (not just one) so opening/closing the candidatures
  // modal is a pure client-side state flip — no server round-trip per click.
  const appsByJobRecord: Record<string, CandidateApp[]> = {}
  for (const [jobId, jobApps] of appsByJob) {
    appsByJobRecord[jobId] = jobApps.map(app => {
      const cand = candidateMap.get(app.candidateId)
      return {
        appId: app.$id,
        jobId: app.jobId,
        candidateId: app.candidateId,
        candidateName: cand?.name ?? '',
        candidateEmail: cand?.email ?? app.candidateId,
        cvFileId: app.cvFileId,
        status: resolveStatus(funnelStages, app.status),
        aiScore: app.aiScore,
        aiSummary: app.aiSummary,
        createdAt: app.createdAt,
      }
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Offres actives', value: activeJobs.length, icon: <Briefcase className="h-4 w-4" /> },
            { label: 'Candidatures', value: allApplications.length, icon: <Users className="h-4 w-4" /> },
            { label: 'Score moyen IA', value: avgScore !== null ? `${avgScore}/100` : '—', icon: <Star className="h-4 w-4" /> },
            { label: 'Taux sélection', value: selectionRate !== null ? `${selectionRate}%` : '—', icon: <TrendingUp className="h-4 w-4" /> },
          ].map(s => (
            <div key={s.label} className="p-4 rounded-2xl transition-transform duration-300 hover:-translate-y-0.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{s.label}</span>
                <span style={{ color: 'var(--color-primary)' }}>{s.icon}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Mes offres : filtres, création d'une offre au bout de leur ligne, puis la liste. Les autres outils sont dans le
            sous-menu de l'espace (layout recruteur). */}
        <JobsListClient jobs={jobs} appsByJob={appsByJobRecord} tenantId={user.tenantId} matchCountByJob={matchCountByJob} funnelStages={funnelStages} socialByJob={socialByJob} socialEnabled={isMakeConfigured()}
          focusJobId={typeof offre === 'string' ? offre : undefined}
          action={
            <Suspense fallback={null}>
              <CreateJobDialog tenantId={user.tenantId} companyName={user.firstName + ' ' + user.lastName} variant="primary" />
            </Suspense>
          } />

        <p className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Une question, un souci ? <Link href="/recruiter/support" className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>Contactez le support</Link>
        </p>
      </div>
    </div>
  )
}
