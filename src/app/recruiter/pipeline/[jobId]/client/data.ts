import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getApplicationsByJob, getJobById } from '@/lib/appwrite/jobs'
import { getStagesForJob } from '@/lib/appwrite/funnel'
import { resolveCandidateIdentities } from '@/lib/candidate-identity'
import { funnelForCandidate } from '@/lib/candidate-funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { recruiterCanOpenJob, recruiterCanSeeApplication } from '@/lib/job-ownership'
import { parseClientSubmission, sentSteps, synthesisSteps, type ClientSubmission } from '@/lib/client-response'
import { loadRecruiterWeights } from '@/lib/scoring-weights-store'
import { personalScore } from '@/lib/scoring-weights'
import { formatDateFr } from '@/lib/format-date'
import type { Job } from '@/types'

/** Identifiant Appwrite : l'adresse ne doit pas viser un autre chemin de l'API. */
const JOB_ID = /^[\w-]{1,36}$/

/** Une étape de la synthèse envoyée au client : ce qu'en voit le recruteur et ce qui est imprimé. */
export interface SynthesisStep { id: string; label: string; report: string; validatedBy?: string; validatedAt?: string }

/** Une candidature de l'offre, vue de l'onglet « Réponse client ». */
export interface ClientRow {
  appId: string
  name: string
  email: string
  /** Score aux poids du recruteur, comme dans le funnel. */
  score?: number
  /** Phase actuelle dans le funnel. */
  stageLabel: string
  /** Envoi au client ; null : pas encore envoyé. */
  submission: ClientSubmission | null
  /** « 14 nov. 2026 » : date de l'envoi, formatée par le serveur (même texte au rendu et dans le navigateur). */
  sentOn?: string
  /** Envoyé : la synthèse envoyée ; sinon, les étapes qu'un envoi reprendrait (vide : pas encore envoyable). */
  steps: SynthesisStep[]
}

/**
 * Candidatures d'une offre pour l'onglet « Réponse client » et sa synthèse imprimable. Mêmes règles d'accès que le funnel :
 * recruteur connecté, offre de son organisation ou de la plateforme, candidatures d'une autre organisation jamais lues.
 */
export async function loadClientRows(jobId: string): Promise<{ job: Job; rows: ClientRow[] }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  if (!JOB_ID.test(jobId)) notFound()
  const tenantId = user.tenantId

  const [job, allApps, { stages }, { weights }] = await Promise.all([
    getJobById(jobId), getApplicationsByJob(jobId), getStagesForJob(tenantId, jobId), loadRecruiterWeights(user.userId),
  ])
  if (!job) notFound()
  if (!recruiterCanOpenJob(job.tenantId, tenantId)) redirect('/recruiter/dashboard')
  const apps = allApps.filter(a => recruiterCanSeeApplication(job.tenantId, a.tenantId ?? '', tenantId))
  const identities = await resolveCandidateIdentities(apps.map(a => a.candidateId))

  const rows = apps.map((a): ClientRow => {
    const status = resolveStatus(stages, a.status)
    const funnel = funnelForCandidate(a.funnelJson, status).steps
    const submission = parseClientSubmission(a.clientJson)
    const info = identities.get(a.candidateId)
    return {
      appId: a.$id,
      name: info?.name || `Candidat #${a.candidateId.slice(-6)}`,
      email: info?.email ?? '',
      score: a.aiScore == null ? undefined : personalScore(a.aiScore, a.aiSummary ?? '', weights),
      stageLabel: stages.find(s => s.slug === status)?.label ?? status,
      submission,
      sentOn: submission ? formatDateFr(submission.sentAt) : undefined,
      steps: (submission ? sentSteps(funnel, submission) : synthesisSteps(funnel))
        .map(s => ({ id: s.id, label: s.label, report: s.report ?? '', validatedBy: s.validatedBy, validatedAt: s.validatedAt })),
    }
  })
  return { job, rows }
}
