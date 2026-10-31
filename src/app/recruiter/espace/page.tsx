import { redirect } from 'next/navigation'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { isJourneyStoreConfigured, listTenantJourneys } from '@/lib/appwrite/consultant-journeys'
import { listTenantRecruiters } from '@/lib/recruiter-assignment'
import {
  jobOnlineStatus, sortRecruitments, summarizeRecruitments, workspaceKpis, type WorkspaceJob, type WorkspaceJourney,
} from '@/lib/recruiter-workspace'
import { WorkspaceView } from './workspace-view'

// « Mon espace » du recruteur (demande de Dav du 2026-10-31) : ses recrutements (offres de l'organisation qui lui sont
// affectées), leur statut et leur avancement ; « Toute l'équipe » : tous ceux de l'organisation. Un seul bloc regroupe
// aussi toutes les rubriques avec leurs chiffres (appels d'offres à valider, parcours, entretiens, vivier…) : la page
// n'a pas le sous-menu (même demande).

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export default async function RecruiterWorkspacePage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  const tenantId = user.tenantId
  const view = (await searchParams).vue === 'equipe' ? 'team' : 'mine'
  const { databases } = createAdminClient()

  // Offres, candidatures et équipe sont indispensables (erreur → page d'erreur) ; entretiens, parcours et vivier
  // complètent les chiffres (échec → chiffres affichés avec un avertissement).
  const [jobDocs, appDocs, recruiters] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [Query.equal('tenantId', tenantId), Query.orderDesc('$createdAt'), Query.limit(200)]),
    databases.listDocuments(DB_ID, COLLECTIONS.APPLICATIONS, [
      Query.equal('tenantId', tenantId), Query.select(['$id', 'jobId', 'status']), Query.limit(1000),
    ]),
    listTenantRecruiters(tenantId),
  ])
  const missing: string[] = []
  const [interviews, journeys, vivierCount, aoToReview] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [Query.equal('tenantId', tenantId), Query.select(['applicationId']), Query.limit(1000)])
      .then(res => ({ total: res.total, applications: new Set(res.documents.map(d => d.applicationId as string)) }))
      .catch(err => { console.error('Mon espace : entretiens illisibles', errorText(err)); missing.push('entretiens'); return null }),
    (isJourneyStoreConfigured() ? listTenantJourneys(tenantId) : Promise.resolve(null))
      .then(list => list && new Map<string, WorkspaceJourney>(list.flatMap(j => (j.journey ? [[j.applicationId, { stage: j.journey.stage, status: j.journey.status }]] : []))))
      .catch(err => { console.error('Mon espace : parcours illisibles', errorText(err)); missing.push('parcours'); return null }),
    // Vivier général du recruteur (CV sans offre), comme la page du vivier.
    databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, [
      Query.equal('tenantId', tenantId), Query.equal('recruiterId', user.$id), Query.isNull('jobId'), Query.select(['$id']), Query.limit(1),
    ]).then(res => res.total).catch(err => { console.error('Mon espace : vivier illisible', errorText(err)); return null }),
    // Appels d'offres à valider de l'organisation (index de la liste, ADR 0019), pour le bloc « Appels d'offres ».
    (COLLECTIONS.AO_OFFER_INDEX
      ? databases.listDocuments(DB_ID, COLLECTIONS.AO_OFFER_INDEX, [
        Query.equal('tenantId', tenantId), Query.equal('status', 'to_review'), Query.select(['$id']), Query.limit(1),
      ]).then(res => res.total)
      : Promise.resolve(null)
    ).catch(err => { console.error('Mon espace : appels d\'offres illisibles', errorText(err)); return null }),
  ])

  const jobs: WorkspaceJob[] = jobDocs.documents.map(d => ({
    id: d.$id,
    title: (d.title as string) || 'Offre',
    isActive: Boolean(d.isActive),
    expiresAt: (d.expiresAt as string | null) ?? undefined,
    recruiterId: (d.recruiterId as string | null) ?? '',
    createdAt: d.$createdAt,
  }))
  const now = new Date()
  const summaries = summarizeRecruitments({
    jobs: view === 'mine' ? jobs.filter(j => j.recruiterId === user.userId) : jobs,
    applications: appDocs.documents.map(d => ({ id: d.$id, jobId: d.jobId as string, status: (d.status as string) ?? '' })),
    interviewed: interviews?.applications ?? new Set<string>(),
    journeys: journeys ?? new Map<string, WorkspaceJourney>(),
    now,
  })

  return (
    <WorkspaceView
      firstName={user.firstName}
      view={view}
      kpis={workspaceKpis(summaries)}
      recruitments={sortRecruitments(summaries)}
      recruiters={recruiters}
      hub={{
        aoToReview,
        activeJourneys: journeys ? [...journeys.values()].filter(j => j.status === 'active').length : null,
        interviews: interviews?.total ?? null,
        onlineJobs: jobs.filter(j => jobOnlineStatus(j, now) === 'online').length,
        teamSize: recruiters.length,
        vivierCount,
      }}
      warning={missing.length ? `Chiffres peut-être incomplets : ${missing.join(' et ')} illisibles pour le moment.` : null}
    />
  )
}
