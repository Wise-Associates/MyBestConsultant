import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getApplicationsByJob, getJobById } from '@/lib/appwrite/jobs'
import { getStagesForJob } from '@/lib/appwrite/funnel'
import { resolveCandidateIdentities } from '@/lib/candidate-identity'
import { funnelForCandidate } from '@/lib/candidate-funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { viewerCanOpenJob, viewerCanSeeApplication } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { parseClientSubmission, REJECTED_COLUMN, sentSteps, synthesisSteps, type ClientSubmission } from '@/lib/client-response'
import { buildClientSheet, type ClientSheet } from '@/lib/client-sheet'
import { getJobClient, isJobClientsConfigured } from '@/lib/appwrite/job-clients'
import type { JobClient } from '@/lib/client-response'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { loadRecruiterWeights } from '@/lib/scoring-weights-store'
import { personalScore } from '@/lib/scoring-weights'
import { formatDateFr } from '@/lib/format-date'
import type { Job, UserProfile } from '@/types'

/** Identifiant Appwrite : l'adresse ne doit pas viser un autre chemin de l'API. */
const JOB_ID = /^[\w-]{1,36}$/

/** Une étape de la synthèse envoyée au client : ce qu'en voit le recruteur et ce qui est imprimé. */
export interface SynthesisStep { id: string; label: string; report: string; validatedBy?: string; validatedAt?: string }

/** Une candidature de l'offre, vue de l'onglet « Réponse client ». */
export interface ClientRow {
  appId: string
  /** Document « users » du candidat (export « CV format cabinet »). */
  candidateId: string
  /** Profil d'un chasseur : pas de compte candidat, pas d'export « CV format cabinet » (loadCandidate). */
  hunterProfile: boolean
  name: string
  email: string
  /** Score aux poids du recruteur, comme dans le funnel. */
  score?: number
  /** Phase actuelle dans le funnel. */
  stageLabel: string
  /** Dans « Refusé » : pas proposé au client. */
  rejected: boolean
  /** Candidature directe à une offre de la plateforme : son envoi serait commun à toutes les organisations, refusé (actions.ts). */
  shared: boolean
  /** Envoi au client ; null : pas encore envoyé. */
  submission: ClientSubmission | null
  /** « 14 nov. 2026 » : date de l'envoi, formatée par le serveur (même texte au rendu et dans le navigateur). */
  sentOn?: string
  /** Envoyé : la synthèse envoyée ; sinon, les étapes qu'un envoi reprendrait (vide : pas encore envoyable). */
  steps: SynthesisStep[]
}

/**
 * Candidatures d'une offre pour l'onglet « Réponse client » et ses fiches imprimables. Mêmes règles d'accès que le funnel :
 * recruteur connecté, offre de son organisation ou de la plateforme, candidatures d'une autre organisation jamais lues.
 */
async function loadClientData(jobId: string) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')
  if (!JOB_ID.test(jobId)) notFound()
  const tenantId = user.tenantId

  const [job, allApps, { stages }, { weights }] = await Promise.all([
    getJobById(jobId), getApplicationsByJob(jobId), getStagesForJob(tenantId, jobId), loadRecruiterWeights(user.userId),
  ])
  if (!job) notFound()
  const viewer = await loadOfferViewer(user)
  if (!viewerCanOpenJob(job, viewer)) redirect('/recruiter/dashboard')
  const apps = allApps.filter(a => viewerCanSeeApplication(job, a.tenantId ?? '', viewer))
  const [identities, client] = await Promise.all([
    resolveCandidateIdentities(apps.map(a => a.candidateId)),
    // Client de l'offre : illisible, l'onglet s'affiche quand même et le signale (« unavailable »).
    getJobClient(tenantId, jobId).catch(err => {
      console.error('[réponse client] client de l\'offre illisible', jobId, err instanceof Error ? err.message : err)
      return 'unavailable' as const
    }),
  ])

  const rows = apps.map((a): ClientRow => {
    const status = resolveStatus(stages, a.status)
    const funnel = funnelForCandidate(a.funnelJson, status).steps
    const submission = parseClientSubmission(a.clientJson)
    const info = identities.get(a.candidateId)
    return {
      appId: a.$id,
      candidateId: a.candidateId,
      hunterProfile: !!info?.hunter,
      name: info?.name || `Candidat #${a.candidateId.slice(-6)}`,
      email: info?.email ?? '',
      score: a.aiScore == null ? undefined : personalScore(a.aiScore, a.aiSummary ?? '', weights),
      stageLabel: stages.find(s => s.slug === status)?.label ?? status,
      rejected: status === REJECTED_COLUMN,
      shared: (a.tenantId ?? '') !== tenantId && job.tenantId !== tenantId,
      submission,
      sentOn: submission ? formatDateFr(submission.sentAt) : undefined,
      steps: (submission ? sentSteps(funnel, submission) : synthesisSteps(funnel))
        .map(s => ({ id: s.id, label: s.label, report: s.report ?? '', validatedBy: s.validatedBy, validatedAt: s.validatedAt })),
    }
  })
  return { user, job, apps, rows, weights, client }
}

/** Client de l'offre : null s'il n'est pas renseigné ; 'unavailable' : illisible ; 'off' : collection non configurée. */
export type ClientState = JobClient | null | 'unavailable' | 'off'

export async function loadClientRows(jobId: string): Promise<{ user: UserProfile; job: Job; rows: ClientRow[]; client: ClientState }> {
  const { user, job, rows, client } = await loadClientData(jobId)
  return { user, job, rows, client: isJobClientsConfigured() ? client : 'off' }
}

/**
 * Fiches des candidatures `ids` déjà notées comme envoyées au client (client-sheet.ts : initiales, sans coordonnées), avec
 * l'envoi (date, recruteur). Le CV analysé et la ville sont lus sur le compte du candidat.
 */
export async function loadClientSheets(jobId: string, ids: Set<string>): Promise<{ job: Job; client: JobClient | null; sheets: (ClientSheet & { sentBy: string; sentOn: string })[] }> {
  const { job, apps, rows, weights, client } = await loadClientData(jobId)
  const shown = rows.filter(r => r.submission && ids.has(r.appId))
  const appOf = new Map(apps.map(a => [a.$id, a]))
  const candidateIds = [...new Set(shown.map(r => appOf.get(r.appId)!.candidateId))]
  const { databases } = createAdminClient()
  const people = candidateIds.length === 0 ? [] : (await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
    Query.equal('$id', candidateIds), Query.select(['$id', 'firstName', 'lastName', 'city', 'cvProfileJson']), Query.limit(candidateIds.length),
  ])).documents
  const personOf = new Map(people.map(d => [d.$id, d]))

  const sheets = shown.map(r => {
    const app = appOf.get(r.appId)!
    const person = personOf.get(app.candidateId)
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      ...buildClientSheet({
        appId: r.appId, firstName: str(person?.firstName), lastName: str(person?.lastName), city: str(person?.city),
        cvProfileJson: person?.cvProfileJson, score: r.score, aiSummary: app.aiSummary ?? undefined, weights,
        steps: r.steps.map(s => ({ id: s.id, label: s.label, report: s.report, validatedAt: s.validatedAt })),
      }),
      sentBy: r.submission!.sentBy,
      sentOn: r.sentOn ?? '',
    }
  })
  return { job, client: client === 'unavailable' ? null : client, sheets }
}
