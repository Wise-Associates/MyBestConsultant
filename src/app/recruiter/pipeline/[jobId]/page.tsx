import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById, getApplicationsByJob } from '@/lib/appwrite/jobs'
import { getStagesForJob } from '@/lib/appwrite/funnel'
import { funnelForCandidate } from '@/lib/candidate-funnel'
import { resolveStatus, withOrphanStages } from '@/lib/funnel-stage-utils'
import { resolveCandidateIdentities } from '@/lib/candidate-identity'
import { normalizeWhatsApp } from '@/lib/whatsapp'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { PipelineClient, type PipelineCandidate } from './pipeline-client'
import type { InterviewAnalysis } from '@/app/recruiter/interviews/actions'
import { getEmailsForApplications } from '@/lib/appwrite/application-emails'
import type { FunnelStage } from '@/types'

// Every interview per application (a recruiter can launch as many as they want for the
// same candidate) — shown as sub-card results on the Kanban card, most recent first. Carries
// enough fields to open the interview-detail modal (transcript/analysis/recordings) without
// a second round-trip just to build its header.
async function getInterviewResultsByApplication(applicationIds: string[]) {
  const map = new Map<string, {
    id: string; title?: string; status: string; score?: number; recommendation?: string; summary?: string
    createdAt: string; completedAt?: string; candidateName: string; candidateEmail: string
    jobTitle: string; questionCount: number; transcriptLength: number
  }[]>()
  if (applicationIds.length === 0) return map
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
      Query.equal('applicationId', applicationIds.slice(0, 100)),
      Query.orderDesc('$createdAt'),
      Query.limit(100),
    ])
    for (const doc of result.documents) {
      const appId = doc.applicationId as string
      const analysis: Partial<InterviewAnalysis> = doc.analysis ? JSON.parse(doc.analysis as string) : {}
      let questionCount = 0
      let transcriptLength = 0
      try { questionCount = JSON.parse(doc.questions as string ?? '[]').length } catch { /* */ }
      try { transcriptLength = JSON.parse(doc.transcript as string ?? '[]').length } catch { /* */ }
      const entry = {
        id: doc.$id,
        title: (doc.title as string | null) || undefined,
        status: doc.status as string,
        score: analysis.overallScore,
        recommendation: analysis.recommendation,
        summary: analysis.summary,
        createdAt: doc.$createdAt as string,
        completedAt: doc.completedAt as string | undefined,
        candidateName: (doc.candidateName as string) ?? '',
        candidateEmail: (doc.candidateEmail as string) ?? '',
        jobTitle: (doc.jobTitle as string) ?? '',
        questionCount,
        transcriptLength,
      }
      if (!map.has(appId)) map.set(appId, [])
      map.get(appId)!.push(entry)
    }
  } catch { /* interview results are a bonus display, never block the pipeline */ }
  return map
}

export default async function PipelinePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const [job, apps, { stages, pipeline }] = await Promise.all([
    getJobById(jobId), getApplicationsByJob(jobId), getStagesForJob(user.tenantId, jobId),
  ])
  if (!job) notFound()
  // Admin-published jobs (tenantId '') are shared across recruiters, same access rule
  // as the rest of the recruiter dashboard (getJobsByTenant merges both sets).
  if (job.tenantId !== user.tenantId && job.tenantId !== '') redirect('/recruiter/dashboard')

  // Candidat classique, ou profil du vivier d'un chasseur (contact = le chasseur) : voir lib/candidate-identity.
  const userMap = await resolveCandidateIdentities(apps.map(a => a.candidateId))

  const appIds = apps.map(a => a.$id)
  const [interviewResults, emails] = await Promise.all([getInterviewResultsByApplication(appIds), getEmailsForApplications(appIds)])

  const candidates: PipelineCandidate[] = apps.map(a => {
    const info = userMap.get(a.candidateId)
    return {
      appId: a.$id,
      candidateName: info?.name || `Candidat #${a.candidateId.slice(-6)}`,
      candidateEmail: info?.email ?? '',
      photoUrl: info?.photoUrl,
      // WhatsApp confirmé par le candidat ; à défaut son téléphone (contact possible, mais numéro non confirmé).
      whatsapp: info?.whatsapp || normalizeWhatsApp(info?.phone ?? '').e164 || undefined,
      whatsappConfirmed: !!info?.whatsapp,
      hunterName: info?.hunter?.name,
      cvFileId: a.cvFileId || undefined,
      // Statut rattaché à l'étape actuelle du funnel (une étape recréée sous un autre identifiant
      // ne doit pas faire apparaître les anciennes candidatures dans une colonne en double).
      status: resolveStatus(stages, a.status),
      stageStatus: a.stageStatus,
      // Funnel du candidat : celui qu'il a enregistré, sinon le funnel par défaut aligné sur sa colonne.
      funnel: funnelForCandidate(a.funnelJson, resolveStatus(stages, a.status)).steps,
      // Appwrite returns null (not undefined) for a numeric attribute that was never
      // set — normalize here so downstream `!== undefined` checks work correctly.
      aiScore: a.aiScore ?? undefined,
      aiSummary: a.aiSummary ?? undefined,
      aiRecommendation: a.aiRecommendation ?? undefined,
      interviews: interviewResults.get(a.$id) ?? [],
      tags: a.tags ?? [],
      note: a.note ?? '',
      createdAt: a.createdAt,
    }
  })

  // Une offre peut changer de pipeline : les candidatures dont la phase n'existe pas dans le nouveau pipeline
  // gardent une colonne (sinon elles disparaîtraient du tableau).
  const boardStages: FunnelStage[] = withOrphanStages(stages, candidates.map(c => c.status)).map(s =>
    stages.find(x => x.slug === s.slug) ?? { $id: `orphan-${s.slug}`, tenantId: user.tenantId!, slug: s.slug, label: s.label, color: s.color, order: s.order })

  return <PipelineClient jobId={jobId} tenantId={user.tenantId} jobTitle={job.title} initialCandidates={candidates} initialStages={boardStages} initialEmails={emails} pipeline={pipeline} />
}
