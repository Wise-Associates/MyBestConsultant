import type { Job } from '@/types'

// Chiffres du tableau de bord recruteur (maquette « Tableau de bord recruteur — proposition », demande du 2026-11-02) :
// indicateurs du haut, tuiles « À traiter » et faits de chaque ligne de « Mes offres ». Règles pures, heure injectée,
// testées dans recruiter-dashboard.test.ts. La page leur passe toutes les offres et candidatures de l'organisation.

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** Une offre en ligne qui expire dans ce nombre de jours ou moins « expire bientôt ». */
export const EXPIRING_SOON_DAYS = 7
/** Semaines du petit graphique des candidatures ; la dernière = les 7 derniers jours. */
export const WEEKS_SHOWN = 8

/** En ligne ; expirée (encore active, mais sa date est passée : le cron la désactivera) ; archivée (désactivée). */
export type JobState = 'online' | 'expired' | 'archived'

export function jobState(job: Pick<Job, 'isActive' | 'expiresAt'>, now: Date): JobState {
  if (!job.isActive) return 'archived'
  return job.expiresAt && Date.parse(job.expiresAt) < now.getTime() ? 'expired' : 'online'
}

/** Jours restants (arrondis au jour supérieur) d'une offre en ligne qui expire bientôt ; null sinon. */
export function expiresInDays(job: Pick<Job, 'isActive' | 'expiresAt'>, now: Date): number | null {
  if (!job.expiresAt || jobState(job, now) !== 'online') return null
  const days = Math.max(1, Math.ceil((Date.parse(job.expiresAt) - now.getTime()) / DAY_MS))
  return days <= EXPIRING_SOON_DAYS ? days : null
}

/** Candidature telle que le tableau de bord la lit ; `status` déjà rattaché aux étapes du funnel (resolveStatus). */
export interface DashboardApp {
  status: string
  aiScore?: number | null
  createdAt: string
}

/**
 * Statuts qui comptent : `newStatus` = l'étape où arrive toute candidature (statut « pending » de createApplication,
 * rattaché au funnel) ; une candidature qui y est encore est « nouvelle », à traiter. `acceptedStatus` = embauché.
 */
export interface StatusKeys { newStatus: string; acceptedStatus: string }

export interface JobFacts {
  state: JobState
  expiresInDays: number | null
  applications: number
  newApplications: number
  /** Score IA moyen des candidatures notées, arrondi ; null sans aucune note. */
  avgScore: number | null
  /** Dernière diffusion sur les réseaux en échec, pour une offre en ligne (à relancer). */
  diffusionFailed: boolean
}

const average = (scores: number[]) => scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : null
const scoresOf = (apps: DashboardApp[]) => apps.map(a => a.aiScore).filter((s): s is number => typeof s === 'number')

export function jobFacts(
  job: Pick<Job, 'isActive' | 'expiresAt'>, apps: DashboardApp[], keys: StatusKeys,
  diffusionStatus: string | undefined, now: Date,
): JobFacts {
  const state = jobState(job, now)
  return {
    state,
    expiresInDays: expiresInDays(job, now),
    applications: apps.length,
    newApplications: apps.filter(a => a.status === keys.newStatus).length,
    avgScore: average(scoresOf(apps)),
    diffusionFailed: state === 'online' && diffusionStatus === 'failed',
  }
}

export interface DashboardSummary {
  jobs: {
    total: number
    online: number
    /** Archivées et expirées : toutes celles qui ne sont pas en ligne. */
    offline: number
  }
  applications: {
    total: number
    /** Candidatures par tranche de 7 jours, la plus ancienne d'abord ; la dernière = les 7 derniers jours. */
    weekly: number[]
    scored: number
    avgScore: number | null
    accepted: number
    /** Embauchés / candidatures, en %, arrondi ; null sans candidature. */
    selectionRate: number | null
    new: number
    /** Offres qui ont au moins une nouvelle candidature. */
    jobsWithNew: number
  }
}

export function summarize(
  jobs: Pick<Job, 'isActive' | 'expiresAt'>[], appsByJob: DashboardApp[][], keys: StatusKeys, now: Date,
): DashboardSummary {
  const apps = appsByJob.flat()
  const online = jobs.filter(j => jobState(j, now) === 'online').length
  const weekly = new Array<number>(WEEKS_SHOWN).fill(0)
  for (const a of apps) {
    const age = Math.max(0, now.getTime() - Date.parse(a.createdAt))
    const week = Math.floor(age / WEEK_MS)
    if (week < WEEKS_SHOWN) weekly[WEEKS_SHOWN - 1 - week]++
  }
  const scores = scoresOf(apps)
  const accepted = apps.filter(a => a.status === keys.acceptedStatus).length
  return {
    jobs: { total: jobs.length, online, offline: jobs.length - online },
    applications: {
      total: apps.length,
      weekly,
      scored: scores.length,
      avgScore: average(scores),
      accepted,
      selectionRate: apps.length ? Math.round((accepted / apps.length) * 100) : null,
      new: apps.filter(a => a.status === keys.newStatus).length,
      jobsWithNew: appsByJob.filter(list => list.some(a => a.status === keys.newStatus)).length,
    },
  }
}
