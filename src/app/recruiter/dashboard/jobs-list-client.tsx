'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MapPin, Brain, ChevronRight, Layers, Search } from 'lucide-react'
import { JobActions } from './job-actions'
import { JobApplicationsModal } from './job-applications-modal'
import type { CandidateApp } from './applications-panel'
import { SocialStatus, type SocialInfo } from './social-status'
import type { Job, FunnelStage } from '@/types'
import { EMPTY_JOB_FILTERS, filterJobs, isFiltering, type JobFilters } from '@/lib/recruiter-job-filters'
import { startNavigationProgress } from '@/components/shared/navigation-progress'

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}

/** Champs de la barre de filtres : même hauteur que le bouton « Créer une offre » (44 px sur mobile, 40 px ensuite). */
const field = 'h-11 sm:h-10 px-3 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-primary)'
const fieldStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

export function JobsListClient({
  jobs, appsByJob, tenantId, matchCountByJob, funnelStages, socialByJob = {}, socialEnabled = false, focusJobId, action,
}: {
  jobs: Job[]; appsByJob: Record<string, CandidateApp[]>; tenantId: string
  matchCountByJob: Record<string, number>; funnelStages: FunnelStage[]
  socialByJob?: Record<string, SocialInfo>; socialEnabled?: boolean
  /** Offre à montrer (?offre= de la page, depuis le suivi d'un appel d'offres publié). */
  focusJobId?: string
  /** Bouton au bout de la barre de filtres (« Créer une offre »), aligné sur elle. */
  action?: ReactNode
}) {
  const router = useRouter()
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [filters, setFilters] = useState<JobFilters>(EMPTY_JOB_FILTERS)
  const set = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => setFilters(f => ({ ...f, [key]: value }))
  const filtering = isFiltering(filters)
  const shown = filterJobs(jobs, filters)
  const openJob = openJobId ? jobs.find(j => j.$id === openJobId) : null
  const sortedStages = [...funnelStages].sort((a, b) => a.order - b.order)

  // Amenée à l'écran à l'arrivée seulement : les rafraîchissements de l'état des diffusions (SocialStatus) ne font pas
  // redéfiler la page. Le focus suit, pour le clavier et les lecteurs d'écran.
  const focusRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = focusRef.current
    if (!row) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    row.focus({ preventScroll: true })
  }, [focusJobId])

  return (
    <>
      {/* Filtres de la liste, et la création d'une offre au bout de la même ligne. */}
      <div role="search" aria-label="Filtrer mes offres" className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <div className="relative flex-1 min-w-0 sm:min-w-60">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
          <input type="search" value={filters.q} onChange={e => set('q', e.target.value)} aria-label="Rechercher une offre"
            placeholder="Rechercher un intitulé, une ville…" className={`${field} w-full pl-9`} style={fieldStyle} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <select aria-label="Statut de l’offre" value={filters.status} onChange={e => set('status', e.target.value as JobFilters['status'])} className={field} style={fieldStyle}>
            <option value="all">Tous les statuts</option>
            <option value="active">En ligne</option>
            <option value="archived">Archivées</option>
          </select>
          <select aria-label="Type de contrat" value={filters.contract} onChange={e => set('contract', e.target.value as JobFilters['contract'])} className={field} style={fieldStyle}>
            <option value="all">Tous les contrats</option>
            {Object.entries(CONTRACT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {filtering && (
          <button type="button" onClick={() => setFilters(EMPTY_JOB_FILTERS)} className="self-start sm:self-auto text-xs font-semibold underline underline-offset-2"
            style={{ color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Réinitialiser
          </button>
        )}
        {action && <div className="sm:ml-auto">{action}</div>}
      </div>

      <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.14)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Mes offres ({filtering ? `${shown.length} sur ${jobs.length}` : jobs.length})
          </h2>
          {jobs.length > 0 && (
            <Link href="/recruiter/annonces"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>
              <Layers className="h-3.5 w-3.5" /> Suivi &amp; rapports
            </Link>
          )}
        </div>

        {shown.length === 0 ? (
          <div className="py-16 text-center px-6">
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
              {jobs.length === 0 ? 'Aucune offre. Créez votre première offre pour commencer.' : 'Aucune offre ne correspond à ces filtres.'}
            </p>
            {jobs.length > 0 && (
              <button type="button" onClick={() => setFilters(EMPTY_JOB_FILTERS)} className="text-sm font-semibold underline underline-offset-2"
                style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Réinitialiser les filtres
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {shown.map(job => {
              const jobApps = appsByJob[job.$id] ?? []
              const appCount = jobApps.length
              const isSelected = openJobId === job.$id
              const isFocused = focusJobId === job.$id
              const stageCounts = sortedStages
                .map(stage => ({ stage, count: jobApps.filter(a => a.status === stage.slug).length }))
                .filter(s => s.count > 0)
              return (
                <div key={job.$id}
                  ref={isFocused ? focusRef : undefined} tabIndex={isFocused ? -1 : undefined}
                  onClick={() => { startNavigationProgress(); router.push(`/recruiter/pipeline/${job.$id}/matching`) }}
                  className="group px-5 py-4 transition-colors hover:bg-[rgba(139,92,246,0.05)] cursor-pointer focus:outline-none"
                  style={{
                    background: isSelected ? 'rgba(11,29,81,0.05)' : isFocused ? 'rgba(232,163,61,0.1)' : 'transparent',
                    boxShadow: isFocused ? 'inset 3px 0 0 var(--color-primary)' : undefined,
                  }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{job.title}</p>
                        {!job.isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}>
                            Archivée
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                          <MapPin className="h-3 w-3" />{job.location}
                        </span>
                        {job.contractType && (
                          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {CONTRACT_LABELS[job.contractType]}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div onClick={e => e.stopPropagation()}>
                        <JobActions job={job} tenantId={tenantId} />
                      </div>
                      <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" style={{ color: '#8b5cf6' }} />
                    </div>
                  </div>

                  {/* État du pipeline en direct — une pastille par étape du funnel où le
                      recruteur a personnalisé le sien, pas des statuts figés en dur. */}
                  {stageCounts.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                      {stageCounts.map(({ stage, count }) => (
                        <span key={stage.slug} className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: `${stage.color}16`, color: stage.color }}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: stage.color }} />
                          {count} {stage.label.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}

                  {job.isActive && <SocialStatus jobId={job.$id} info={socialByJob[job.$id]} canPublish={socialEnabled} />}

                  {/* Bottom row: candidatures + aperçu du Matching IA (clic sur la ligne
                      entière pour ouvrir la liste complète et sélectionner qui ajouter). */}
                  <div className="flex items-center justify-between mt-3">
                    <button
                      onClick={e => { e.stopPropagation(); setOpenJobId(job.$id) }}
                      className="text-xs font-semibold transition-opacity hover:opacity-70"
                      style={{ color: appCount > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {appCount} candidature{appCount !== 1 ? 's' : ''} →
                    </button>

                    {matchCountByJob[job.$id] > 0 && (
                      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#8b5cf6' }}>
                        <Brain className="h-3.5 w-3.5" />
                        {matchCountByJob[job.$id]} correspondance{matchCountByJob[job.$id] > 1 ? 's' : ''} IA
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Candidatures — grand modal 3D, purement client, ouverture/fermeture instantanées */}
      {openJob && (
        <JobApplicationsModal
          job={{
            title: openJob.title,
            location: openJob.location,
            contractType: openJob.contractType,
            createdAt: openJob.createdAt,
          }}
          apps={appsByJob[openJob.$id] ?? []}
          onClose={() => setOpenJobId(null)}
        />
      )}
    </>
  )
}
