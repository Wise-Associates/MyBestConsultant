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
import { Briefcase, Users, Star, TrendingUp, Upload, Brain, MessageSquare, Building2, Calendar, FolderSearch, FolderOpen, BarChart3, Layers, GitBranch, Users as TeamIcon } from 'lucide-react'
import { CreateJobDialog } from './create-job-dialog'
import type { CandidateApp } from './applications-panel'
import { JobsListClient } from './jobs-list-client'
import type { Application } from '@/types'

// "Matching IA" badge on the jobs list — how many candidates (pool + vivier) the AI has
// already matched for each job, without opening the dedicated Matching page per job.
async function countMatchesByJob(tenantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  try {
    const { databases } = createAdminClient()
    const [poolRes, vivierRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('tenantId', tenantId), Query.limit(500)]),
      databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', tenantId), Query.limit(500)]),
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

function ToolTile({ href, title, subtitle, rgb, iconColor, children }: {
  href: string; title: string; subtitle: string; rgb: string; iconColor: string; children: React.ReactNode
}) {
  return (
    <Link href={href}
      className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)]"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
        style={{ background: `radial-gradient(circle, rgba(${rgb},0.22), transparent 70%)` }} />
      <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `rgba(${rgb},0.12)`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)', color: iconColor }}>
        {children}
      </div>
      <div className="relative">
        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
      </div>
    </Link>
  )
}

export default async function RecruiterDashboard() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.tenantId) redirect('/login')

  const { latestPostsByJob, isMakeConfigured } = await import('@/lib/social')
  const [jobs, allApplications, tenant, matchCountByJob, funnelStages, socialPosts] = await Promise.all([
    getJobsByTenant(user.tenantId),
    getApplicationsByTenant(user.tenantId),
    createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId).catch(() => null),
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

  const memberSince = tenant ? new Date(tenant.$createdAt as string).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Espace recruteur
            </p>
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>
              Bonjour, {user.firstName} 👋
            </h1>
          </div>

          {tenant && (
            <div className="flex items-center gap-4 px-5 py-3.5 rounded-2xl"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center font-bold"
                style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 0 0 3px rgba(255,255,255,0.12)' }}>
                {tenant.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={tenant.logoUrl as string} alt="" className="w-full h-full object-cover" />
                  : <Building2 className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: 'white' }}>{tenant.name as string}</p>
                {memberSince && (
                  <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <Calendar className="h-3 w-3" />Membre depuis {memberSince}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
          <Suspense fallback={<div className="rounded-3xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} />}>
            <CreateJobDialog tenantId={user.tenantId} companyName={user.firstName + ' ' + user.lastName} variant="tile" />
          </Suspense>
          <Link href="/recruiter/reporting"
            className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)] hover:shadow-[0_20px_45px_-12px_rgba(14,165,233,0.3)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
              style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.22), transparent 70%)' }} />
            <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
              <BarChart3 className="h-5 w-5" style={{ color: '#0ea5e9' }} />
            </div>
            <div className="relative">
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Reporting</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Suivi et performance</p>
            </div>
          </Link>
          <Link href="/recruiter/vivier"
            className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)] hover:shadow-[0_20px_45px_-12px_rgba(232,163,61,0.3)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
              style={{ background: 'radial-gradient(circle, rgba(232,163,61,0.22), transparent 70%)' }} />
            <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(232,163,61,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
              <FolderOpen className="h-5 w-5" style={{ color: '#b8862f' }} />
            </div>
            <div className="relative">
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Mon vivier</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>CV importés par offre</p>
            </div>
          </Link>
          <Link href="/recruiter/screening"
            className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)] hover:shadow-[0_20px_45px_-12px_rgba(124,58,237,0.3)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
              style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.22), transparent 70%)' }} />
            <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,58,237,0.1)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
              <Brain className="h-5 w-5" style={{ color: '#7c3aed' }} />
            </div>
            <div className="relative">
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Screening CV</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Analyse IA des candidatures</p>
            </div>
          </Link>
          <Link href="/recruiter/interviews"
            className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)] hover:shadow-[0_20px_45px_-12px_rgba(16,185,129,0.3)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
              style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.22), transparent 70%)' }} />
            <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
              <MessageSquare className="h-5 w-5" style={{ color: '#10b981' }} />
            </div>
            <div className="relative">
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Entretiens IA</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Candidats et analyses</p>
            </div>
          </Link>
          <Link href="/recruiter/cvtheque"
            className="group relative overflow-hidden rounded-3xl p-5 flex flex-col gap-3 no-underline transition-all duration-300 hover:-translate-y-1 shadow-[0_10px_30px_-10px_rgba(11,29,81,0.14)] hover:shadow-[0_20px_45px_-12px_rgba(184,134,11,0.3)]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full transition-transform duration-500 group-hover:scale-125"
              style={{ background: 'radial-gradient(circle, rgba(184,134,11,0.22), transparent 70%)' }} />
            <div className="relative w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(184,134,11,0.12)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
              <FolderSearch className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div className="relative">
              <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>CV Thèque</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Rechercher un profil candidat</p>
            </div>
          </Link>
          <ToolTile href="/recruiter/annonces" title="Suivi des annonces" subtitle="Avancement et rapports PDF" rgb="99,102,241" iconColor="#6366f1"><Layers className="h-5 w-5" /></ToolTile>
          <ToolTile href="/recruiter/funnel" title="Processus de recrutement" subtitle="Pipelines, phases et statuts" rgb="245,158,11" iconColor="#d97706"><GitBranch className="h-5 w-5" /></ToolTile>
          <ToolTile href="/recruiter/marque-employeur" title="Marque employeur" subtitle="Votre page publique" rgb="236,72,153" iconColor="#db2777"><Building2 className="h-5 w-5" /></ToolTile>
          <ToolTile href="/recruiter/equipe" title="Mon équipe" subtitle="Inviter et partager" rgb="20,184,166" iconColor="#0d9488"><TeamIcon className="h-5 w-5" /></ToolTile>
        </div>

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

        {/* Mes offres */}
        <JobsListClient jobs={jobs} appsByJob={appsByJobRecord} tenantId={user.tenantId} matchCountByJob={matchCountByJob} funnelStages={funnelStages} socialByJob={socialByJob} socialEnabled={isMakeConfigured()} />

        <p className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Une question, un souci ? <Link href="/recruiter/support" className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>Contactez le support</Link>
        </p>
      </div>
    </div>
  )
}
