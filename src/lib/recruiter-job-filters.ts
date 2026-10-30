import type { Job } from '@/types'

// Filtres de « Mes offres » sur le tableau de bord recruteur (demande du 2026-10-30) : appliqués dans le navigateur,
// toutes les offres de l'organisation étant déjà chargées par la page. Règles pures, testées dans
// recruiter-job-filters.test.ts.

export type JobStatusFilter = 'all' | 'active' | 'archived'
export type JobContractFilter = 'all' | NonNullable<Job['contractType']>

export interface JobFilters {
  /** Intitulé, ville ou entreprise affichée ; sans tenir compte de la casse ni des accents. */
  q: string
  status: JobStatusFilter
  contract: JobContractFilter
}

export const EMPTY_JOB_FILTERS: JobFilters = { q: '', status: 'all', contract: 'all' }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filterJobs<T extends Pick<Job, 'title' | 'location' | 'isActive' | 'contractType' | 'companyName'>>(jobs: T[], f: JobFilters): T[] {
  const q = fold(f.q.trim())
  return jobs.filter(job => {
    if (f.status === 'active' && !job.isActive) return false
    if (f.status === 'archived' && job.isActive) return false
    if (f.contract !== 'all' && job.contractType !== f.contract) return false
    return !q || fold([job.title, job.location, job.companyName ?? ''].join(' ')).includes(q)
  })
}

export const isFiltering = (f: JobFilters) => f.q.trim() !== '' || f.status !== 'all' || f.contract !== 'all'
