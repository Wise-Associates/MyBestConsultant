import { displayEmail } from '@/lib/candidate-identity'
import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant, getApplicationsByTenant, getApplicationsOfJobs, getTenantJobsOfRecruiters, countMatchesByJob } from '@/lib/appwrite/jobs'
import { getFunnelStages } from '@/lib/appwrite/funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { jobFacts, summarize } from '@/lib/recruiter-dashboard'
import { formatDateFr } from '@/lib/format-date'
import { listTenantRecruiters, recruiterOptions } from '@/lib/recruiter-assignment'
import { parseRecruiterSelection } from '@/lib/recruiter-job-filters'
import { loadOfferViewer } from '@/lib/offer-viewer'
import type { CandidateApp } from './applications-panel'
import { JobsListClient, type DashboardJobRow } from './jobs-list-client'
import { DashboardStats } from './dashboard-stats'
import { RecruiterFilter } from './recruiter-filter'
import type { Application } from '@/types'

// Les Server Actions de cette page (« Publier sur les réseaux », « Republier ») envoient la publication en arrière-plan :
// photo de l'affiche par OpenAI (jusqu'à 2 min) puis envoi à Make. La création d'une offre est sur « Publier un job ».
export const maxDuration = 300

// 25 identifiants par requête ; seuls les 25 premiers candidats étaient lus, les autres s'affichaient par leur identifiant.
const NAME_BATCH = 25
const PARALLEL_BATCHES = 8

async function resolveCandidateNames(
  applications: Application[]
): Promise<Map<string, { name: string; email: string }>> {
  const map = new Map<string, { name: string; email: string }>()
  const candidateIds = [...new Set(applications.map(a => a.candidateId))]
  if (candidateIds.length === 0) return map
  const batches: string[][] = []
  for (let i = 0; i < candidateIds.length; i += NAME_BATCH) batches.push(candidateIds.slice(i, i + NAME_BATCH))
  try {
    const { databases } = createAdminClient()
    for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
      const results = await Promise.all(batches.slice(i, i + PARALLEL_BATCHES).map(ids =>
        databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('$id', ids), Query.limit(NAME_BATCH)])))
      for (const doc of results.flatMap(r => r.documents)) {
        map.set(doc.$id, {
          name: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim(),
          email: displayEmail(doc),
        })
      }
    }
  } catch (e) {
    // Les candidatures restent affichées, par l'identifiant du candidat.
    console.error('[dashboard] noms des candidats non lus', e instanceof Error ? e.message : e)
  }
  return map
}

export default async function RecruiterDashboard({ searchParams }: {
  searchParams: Promise<{ offre?: string | string[]; recruteurs?: string | string[] }>
}) {
  // ?offre=<id> : offre à montrer dans « Mes offres » (lien « Republier depuis le tableau de bord » du suivi des appels
  // d'offres). Seulement comparé aux identifiants des offres déjà chargées pour l'organisation.
  // ?recruteurs= : filtre « Recruteurs » (recruiter-job-filters.ts), appliqué ici : seules les offres choisies et leurs
  // candidatures sont lues, et tous les chiffres de la page portent sur elles.
  const { offre, recruteurs } = await searchParams
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.tenantId) redirect('/login')
  const tenantId = user.tenantId
  // ADR 0043 : le propriétaire et les administrateurs voient toutes les offres de l'organisation (et le filtre
  // « Recruteurs ») ; un membre seulement celles qui lui sont affectées (profil, ou compte Auth pour une valeur ancienne).
  const viewer = await loadOfferViewer(user)
  const memberOnly = viewer.seesAllOffers ? null : { ids: [user.$id, user.userId], unassigned: false }

  const { latestPostsByJob, isDiffusionConfigured } = await import('@/lib/social')
  // Équipe, pour le recruteur affecté à chaque offre et le filtre : illisible, les offres s'affichent sans ce choix ni
  // ce filtre (la sélection ne peut pas être vérifiée : toutes les offres).
  const recruitersRead = listTenantRecruiters(tenantId).catch((e: unknown) => {
    console.error('[dashboard] recruteurs de l’organisation non lus', e instanceof Error ? e.message : e)
    return null
  })
  // Toutes les lectures partent ensemble : seules les offres attendent l'équipe, qui valide la sélection.
  const selectionRead = recruteurs === undefined || memberOnly ? Promise.resolve(null)
    : recruitersRead.then(team => parseRecruiterSelection(recruteurs, team?.map(r => r.id) ?? []))
  const jobsAndApplications = selectionRead.then(selection => {
    const scope = memberOnly ?? selection
    return scope
      ? getTenantJobsOfRecruiters(tenantId, scope).then(async jobs => [jobs, await getApplicationsOfJobs(tenantId, jobs.map(job => job.$id))] as const)
      : Promise.all([getJobsByTenant(tenantId), getApplicationsByTenant(tenantId)])
  })
  const [selection, [jobs, allApplications], matchCountByJob, funnelStages, socialPosts, recruiters] = await Promise.all([
    selectionRead,
    jobsAndApplications,
    countMatchesByJob(tenantId),
    getFunnelStages(tenantId),
    // Illisible : un avertissement dans « Mes offres », plutôt que des offres affichées comme jamais diffusées.
    latestPostsByJob(tenantId).catch((e: unknown) => {
      console.error('[dashboard] diffusions non lues', e instanceof Error ? e.message : e)
      return null
    }),
    recruitersRead,
  ])

  const candidateMap = await resolveCandidateNames(allApplications)

  const appsByJob = new Map<string, Application[]>()
  for (const app of allApplications) {
    if (!appsByJob.has(app.jobId)) appsByJob.set(app.jobId, [])
    appsByJob.get(app.jobId)!.push(app)
  }

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

  const now = new Date()
  // « pending » : statut de toute candidature à sa création (createApplication) ; « accepted » : embauché.
  const keys = { newStatus: resolveStatus(funnelStages, 'pending'), acceptedStatus: resolveStatus(funnelStages, 'accepted') }
  const summary = summarize(jobs, Object.values(appsByJobRecord), keys, now)
  const rows: DashboardJobRow[] = jobs.map(job => {
    const post = socialPosts?.[job.$id]
    return {
      job,
      facts: jobFacts(job, appsByJobRecord[job.$id] ?? [], keys, post?.status, now),
      publishedOn: formatDateFr(job.createdAt),
      shared: job.tenantId !== tenantId,
      matches: matchCountByJob[job.$id] ?? 0,
      social: post && { status: post.status, results: post.results, stale: post.stale, sentOn: formatDateFr(post.sentAt ?? post.createdAt) },
    }
  })

  // Sélection en clair au-dessus des indicateurs : ils ne portent plus sur toute l'organisation.
  const selectionNames = selection && recruiters ? [
    ...recruiters.filter(r => selection.ids.includes(r.id)).map(r => (r.id === user.$id ? 'vous' : r.name)),
    ...(selection.unassigned ? ['offres non affectées'] : []),
  ] : []

  // Au-dessus de « Mes offres ».
  const header = (
    <>
      {recruteurs !== undefined && !memberOnly && recruiters === null && (
        <p role="status" className="px-3.5 py-2.5 rounded-xl text-[13px]" style={{ background: '#b4530914', color: '#b45309' }}>
          Le filtre « Recruteurs » n’a pas pu être appliqué (équipe illisible) : toutes les offres sont affichées. Rechargez la page dans quelques instants.
        </p>
      )}
      {selectionNames.length > 0 && (
        <p className="text-[13px] -mb-2 sm:-mb-3 min-[90rem]:mb-0" style={{ color: 'var(--color-text-muted)' }}>
          Indicateurs et offres de : <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{selectionNames.join(', ')}</span>
          {' · '}
          <Link href="/recruiter/dashboard" className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>Tous les recruteurs</Link>
        </p>
      )}
      <DashboardStats summary={summary} />
    </>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      {/* Grand écran (1440 px et plus) : toute la largeur, jusqu'à 1920 px, avec le panneau d'aperçu de « Mes offres »
          dès 1800 px (dashboard-layout.ts). Les filtres sont dans le panneau du bouton « Filtres » (jobs-filter-panel.tsx). */}
      <div className="max-w-6xl min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 sm:py-8 min-[90rem]:py-6 space-y-6 sm:space-y-7">
        {/* Indicateurs puis « Mes offres » ; les tuiles « À traiter » sont dans le panneau « Filtres » et filtrent la liste.
            Les autres outils sont dans le menu latéral de l'espace (layout recruteur). */}
        <JobsListClient rows={rows} appsByJob={appsByJobRecord} funnelStages={funnelStages} header={header}
          socialEnabled={isDiffusionConfigured()} socialUnavailable={socialPosts === null} recruiters={recruiters && recruiterOptions(recruiters)} jobsWithNew={summary.applications.jobsWithNew}
          focusJobId={typeof offre === 'string' ? offre : undefined}
          recruiterFiltered={selection !== null} recruiterChip={selectionNames.join(', ')}
          recruiterFilter={recruiters && !memberOnly && (
            <Suspense fallback={null}>
              <RecruiterFilter recruiters={recruiterOptions(recruiters)} selection={selection} currentRecruiterId={user.$id} />
            </Suspense>
          )}
          />

        <p className="text-center text-xs sm:text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          Une question, un souci ? <Link href="/recruiter/support" className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>Contactez le support</Link>
        </p>
      </div>
    </div>
  )
}
