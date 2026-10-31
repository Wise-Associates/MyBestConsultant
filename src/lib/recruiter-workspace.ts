// Espace du recruteur (« Mon espace », /recruiter/espace ; demande de Dav du 2026-10-31) : ses recrutements en cours,
// leur statut et leur avancement. Un recrutement = une offre de l'organisation affectée au recruteur
// (jobs.recruiterId = identifiant Auth du recruteur). Règles pures, testées dans recruiter-workspace.test.ts.

import { stageIndex, type JourneyStageKey } from './consultant-journey'

/** Avancement d'un recrutement : le candidat le plus avancé le décide. */
export type RecruitmentLevel = 'matching' | 'interview' | 'validated'

export const LEVEL_LABEL: Record<RecruitmentLevel, string> = {
  matching: 'Matching',
  interview: 'Entretiens',
  validated: 'Recrue validée',
}

export type JobOnlineStatus = 'online' | 'expired' | 'inactive'

export const ONLINE_STATUS_LABEL: Record<JobOnlineStatus, string> = {
  online: 'En ligne',
  expired: 'Expirée',
  inactive: 'Désactivée',
}

export interface WorkspaceJob {
  id: string
  title: string
  isActive: boolean
  expiresAt?: string
  /** Recruteur affecté (identifiant Auth) ; vide : non affecté. */
  recruiterId: string
  createdAt: string
}

export interface WorkspaceApplication {
  id: string
  jobId: string
  status: string
}

export interface WorkspaceJourney {
  stage: JourneyStageKey
  status: 'active' | 'abandoned'
}

export interface RecruitmentSummary {
  job: WorkspaceJob
  online: JobOnlineStatus
  level: RecruitmentLevel
  /** Candidats encore en lice, par niveau (refusés et parcours abandonnés à part). */
  counts: Record<RecruitmentLevel, number>
  closed: number
}

export function jobOnlineStatus(job: Pick<WorkspaceJob, 'isActive' | 'expiresAt'>, now: Date): JobOnlineStatus {
  if (!job.isActive) return 'inactive'
  if (job.expiresAt && new Date(job.expiresAt) < now) return 'expired'
  return 'online'
}

/**
 * Niveau d'un candidat ; null s'il n'est plus en lice (refusé, parcours abandonné). Recrue validée : candidature
 * acceptée, ou parcours arrivé au contrat (le client l'a retenu). Entretien : au moins un entretien IA, candidature à
 * l'étape « entretien », ou parcours arrivé aux entretiens.
 */
export function candidateLevel(
  app: WorkspaceApplication, hasInterview: boolean, journey: WorkspaceJourney | undefined,
): RecruitmentLevel | null {
  if (app.status === 'rejected' || journey?.status === 'abandoned') return null
  if (app.status === 'accepted' || (journey && stageIndex(journey.stage) >= stageIndex('contrat'))) return 'validated'
  if (hasInterview || app.status === 'interview' || (journey && stageIndex(journey.stage) >= stageIndex('entretiens'))) return 'interview'
  return 'matching'
}

const RANK: Record<RecruitmentLevel, number> = { matching: 0, interview: 1, validated: 2 }

export function summarizeRecruitments(input: {
  jobs: WorkspaceJob[]
  applications: WorkspaceApplication[]
  /** Candidatures qui ont au moins un entretien IA. */
  interviewed: Set<string>
  journeys: Map<string, WorkspaceJourney>
  now: Date
}): RecruitmentSummary[] {
  const byJob = new Map<string, WorkspaceApplication[]>()
  for (const app of input.applications) byJob.set(app.jobId, [...(byJob.get(app.jobId) ?? []), app])
  return input.jobs.map(job => {
    const counts: Record<RecruitmentLevel, number> = { matching: 0, interview: 0, validated: 0 }
    let closed = 0
    for (const app of byJob.get(job.id) ?? []) {
      const level = candidateLevel(app, input.interviewed.has(app.id), input.journeys.get(app.id))
      if (level) counts[level]++
      else closed++
    }
    const level = (['validated', 'interview', 'matching'] as const).find(l => counts[l] > 0) ?? 'matching'
    return { job, online: jobOnlineStatus(job, input.now), level, counts, closed }
  })
}

export interface WorkspaceKpis {
  /** Recrutements en ligne. */
  inProgress: number
  /** Recrutements en ligne, par niveau atteint. */
  matching: number
  interview: number
  validated: number
}

export function workspaceKpis(summaries: RecruitmentSummary[]): WorkspaceKpis {
  const online = summaries.filter(s => s.online === 'online')
  return {
    inProgress: online.length,
    matching: online.filter(s => s.level === 'matching').length,
    interview: online.filter(s => s.level === 'interview').length,
    validated: online.filter(s => s.level === 'validated').length,
  }
}

/** En ligne d'abord, puis du plus avancé au moins avancé, puis du plus récent au plus ancien. */
export function sortRecruitments(summaries: RecruitmentSummary[]): RecruitmentSummary[] {
  const onlineRank = (s: RecruitmentSummary) => (s.online === 'online' ? 0 : 1)
  return [...summaries].sort((a, b) =>
    onlineRank(a) - onlineRank(b) || RANK[b.level] - RANK[a.level] || b.job.createdAt.localeCompare(a.job.createdAt))
}
