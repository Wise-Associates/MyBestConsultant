'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Inbox, Users, AlertTriangle, Clock, ArrowRight, Layers, Search, X } from 'lucide-react'
import { JobRow, ROW_GRID } from './job-row'
import { JobApplicationsModal } from './job-applications-modal'
import { JobPreviewPanel } from './job-preview-panel'
import type { CandidateApp } from './applications-panel'
import type { SocialInfo } from './social-status'
import type { Job, FunnelStage } from '@/types'
import type { JobFacts } from '@/lib/recruiter-dashboard'
import type { RecruiterOption } from '@/lib/recruiter-assignment'
import {
  EMPTY_JOB_FILTERS, filterJobs, isFiltering, jobFiltersFromSearchParams, matchesFocus, withJobFilters,
  type JobFilters, type JobFocus, type JobSort, type JobStatusFilter,
} from '@/lib/recruiter-job-filters'
import { initialUrlListSync, noteListWrite, syncFromUrl } from '@/lib/url-list-state'

/** Une ligne de « Mes offres », préparée par la page (faits et dates calculés sur le serveur). */
export interface DashboardJobRow {
  job: Job
  facts: JobFacts
  /** « 3 nov. 2026 » : publication de l'offre. */
  publishedOn: string
  /** Offre partagée de la plateforme (tenantId '') : listée, mais ni modifiable ni diffusable par le recruteur. */
  shared: boolean
  /** Candidats déjà notés par l'IA pour l'offre (base et vivier de l'offre). */
  matches: number
  social?: SocialInfo
}

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}
const SORT_LABELS: Record<JobSort, string> = {
  recent: 'Plus récentes', applications: 'Plus de candidatures', score: 'Meilleur score IA', expiry: 'Expiration proche',
}
const FOCUS_CHIPS: Record<JobFocus, string> = {
  new: 'Nouvelles candidatures', noApplications: 'Sans candidature', diffusionFailed: 'Diffusion en échec', expiringSoon: 'Expire bientôt',
}
/**
 * Lignes affichées à la fois (demande du 2026-11-02, comme le tableau des AO). Les offres et candidatures restent toutes
 * lues par la page (celles des recruteurs choisis avec le filtre « Recruteurs ») : indicateurs et tuiles « À traiter »
 * comptent sur toutes.
 */
const PAGE_SIZE = 50

const muted: CSSProperties = { color: 'var(--color-text-muted)' }
const field = 'h-11 sm:h-10 px-3 rounded-xl text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-text)'
const fieldStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)
const railCard = 'rounded-[20px] p-3.5'
const railCardStyle: CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }
const railHeading = 'font-semibold uppercase mb-2 px-0.5'
// En style : les règles h1–h6 de globals.css (hors couche Tailwind) l'emportent sur les classes de taille.
const railHeadingStyle: CSSProperties = { ...muted, fontSize: 11, letterSpacing: '0.06em', lineHeight: 1.4 }

export function JobsListClient({
  rows, appsByJob, funnelStages, socialEnabled, socialUnavailable, recruiters, jobsWithNew, focusJobId, action, recruiterFilter, recruiterFiltered, header,
}: {
  rows: DashboardJobRow[]; appsByJob: Record<string, CandidateApp[]>; funnelStages: FunnelStage[]
  socialEnabled: boolean
  /** L'état des diffusions n'a pas pu être lu : la colonne « Diffusion » n'est pas fiable. */
  socialUnavailable: boolean
  /** Recruteurs de l'organisation (recruteur affecté à chaque offre) ; null : équipe illisible, choix masqué. */
  recruiters: RecruiterOption[] | null
  /** Offres qui ont au moins une nouvelle candidature (sous-titre de la tuile). */
  jobsWithNew: number
  /** Offre à montrer (?offre= de la page, depuis le suivi d'un appel d'offres publié). */
  focusJobId?: string
  /** Bouton « Créer une offre », dans l'en-tête de « Mes offres ». */
  action?: ReactNode
  /** Filtre « Recruteurs » (appliqué par le serveur : `rows` ne contient que les offres choisies). */
  recruiterFilter?: ReactNode
  recruiterFiltered: boolean
  /** Indicateurs du haut de la page : en tête de la colonne de la liste (à côté du rail sur grand écran). */
  header?: ReactNode
}) {
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  // Offre du panneau d'aperçu (écrans d'au moins 1800 px) ; par défaut, la première de la liste filtrée.
  const [previewJobId, setPreviewJobId] = useState<string | null>(focusJobId ?? null)
  // Filtres repris de l'adresse : « Retour » depuis une offre, Précédent du navigateur et rechargement retrouvent la liste.
  const searchParams = useSearchParams()
  const urlFilters = jobFiltersFromSearchParams(searchParams)
  const urlQuery = withJobFilters(new URLSearchParams(), urlFilters).toString()
  const [filters, setFilters] = useState<JobFilters>(urlFilters)
  const [urlSync, setUrlSync] = useState(() => initialUrlListSync(urlQuery))
  // L'offre demandée par ?offre= doit être affichée, même au-delà des 50 premières.
  const [visible, setVisible] = useState(() =>
    Math.max(PAGE_SIZE, filterJobs(rows, filters).findIndex(r => r.job.$id === focusJobId) + 1))
  // Adresse changée sans la liste (onglet « Tableau de bord » du sous-menu) : ses filtres remplacent ceux affichés.
  if (urlQuery !== urlSync.seen) {
    const step = syncFromUrl(urlSync, urlQuery)
    setUrlSync(step.sync)
    if (step.adopt) {
      setFilters(urlFilters)
      setVisible(PAGE_SIZE)
    }
  }
  const update = (patch: Partial<JobFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    setVisible(PAGE_SIZE)
    setUrlSync(sync => noteListWrite(sync, withJobFilters(new URLSearchParams(), next).toString()))
    // Adresse mise à jour sans relire la page (filtres appliqués dans le navigateur) ni ajouter d'étape à l'historique.
    const query = withJobFilters(new URLSearchParams(window.location.search), next).toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }
  const filtering = isFiltering(filters)
  const shown = filterJobs(rows, filters)
  const openJob = openJobId ? rows.find(r => r.job.$id === openJobId)?.job : null
  const sortedStages = [...funnelStages].sort((a, b) => a.order - b.order)
  const online = rows.filter(r => r.facts.state === 'online').length
  const sharedCount = rows.filter(r => r.shared).length

  // Amenée à l'écran à l'arrivée seulement : les rafraîchissements de l'état des diffusions (SocialStatus) ne font pas
  // redéfiler la page. Le focus suit, pour le clavier et les lecteurs d'écran.
  const focusRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const row = focusRef.current
    if (!row) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
    row.focus({ preventScroll: true })
  }, [focusJobId])

  const count = (focus: JobFocus) => rows.filter(r => matchesFocus(r.facts, focus)).length
  const newApplications = rows.reduce((sum, r) => sum + r.facts.newApplications, 0)
  const noApplications = count('noApplications')
  const noApplicationsWithMatches = rows.filter(r => matchesFocus(r.facts, 'noApplications') && r.matches > 0).length
  const failed = count('diffusionFailed')
  const expiring = count('expiringSoon')
  const tiles: { focus: JobFocus; n: number; label: string; sub: string; icon: ReactNode; ink: string }[] = [
    { focus: 'new', n: newApplications, label: plural(newApplications, 'nouvelle candidature en attente', 'nouvelles candidatures en attente'),
      sub: newApplications > 0 ? `Réparties sur ${jobsWithNew} ${plural(jobsWithNew, 'offre', 'offres')}` : 'Toutes ont été traitées',
      icon: <Inbox className="h-4.5 w-4.5" />, ink: 'var(--color-primary)' },
    { focus: 'noApplications', n: noApplications, label: plural(noApplications, 'offre sans candidature', 'offres sans candidature'),
      sub: noApplicationsWithMatches > 0 ? `Dont ${noApplicationsWithMatches} avec des correspondances IA` : 'Offres en ligne',
      icon: <Users className="h-4.5 w-4.5" />, ink: 'var(--color-text)' },
    { focus: 'diffusionFailed', n: failed, label: plural(failed, 'diffusion en échec', 'diffusions en échec'),
      sub: 'Réseaux sociaux, à relancer', icon: <AlertTriangle className="h-4.5 w-4.5" />, ink: '#b91c1c' },
    { focus: 'expiringSoon', n: expiring, label: plural(expiring, 'offre expire bientôt', 'offres expirent bientôt'),
      sub: 'Dans les 7 prochains jours', icon: <Clock className="h-4.5 w-4.5" />, ink: '#b45309' },
  ]

  const tabs: { status: JobStatusFilter; label: string; n: number }[] = [
    { status: 'all', label: 'Toutes', n: rows.length },
    { status: 'active', label: 'En ligne', n: online },
    { status: 'archived', label: 'Archivées', n: rows.length - online },
  ]
  const displayed = Math.min(visible, shown.length)
  const previewRow = shown.find(r => r.job.$id === previewJobId) ?? shown[0]

  const searchInput = (placeholder: string) => (
    <label className="relative block flex-1 min-w-0 sm:min-w-60 min-[1440px]:min-w-0">
      <span className="sr-only">Rechercher une offre</span>
      <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={muted} />
      <input type="search" value={filters.q} onChange={e => update({ q: e.target.value })}
        placeholder={placeholder} className={`${field} w-full pl-9 font-normal text-sm`}
        style={{ ...fieldStyle, background: 'color-mix(in srgb, var(--color-text) 3%, var(--color-surface))' }} />
    </label>
  )
  const contractSelect = (
    <select aria-label="Type de contrat" value={filters.contract} onChange={e => update({ contract: e.target.value as JobFilters['contract'] })} className={field} style={fieldStyle}>
      <option value="all">Tous les contrats</option>
      {Object.entries(CONTRACT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )
  const sortSelect = (
    <select aria-label="Trier les offres" value={filters.sort} onChange={e => update({ sort: e.target.value as JobSort })} className={field} style={fieldStyle}>
      {Object.entries(SORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )
  const focusChip = filters.focus && (
    <button type="button" onClick={() => update({ focus: null })} aria-label={`Retirer le filtre « ${FOCUS_CHIPS[filters.focus]} »`}
      className="self-start sm:self-auto h-8 pl-3 pr-2.5 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
      style={{ background: 'var(--color-text)', color: 'var(--color-surface)', border: '1px solid var(--color-text)' }}>
      {FOCUS_CHIPS[filters.focus]}<X className="h-3.5 w-3.5" aria-hidden />
    </button>
  )

  return (
    <div className="flex flex-col gap-6 sm:gap-7 min-[1440px]:grid min-[1440px]:grid-cols-[248px_minmax(0,1fr)] min-[1800px]:grid-cols-[248px_minmax(0,1fr)_340px] min-[1440px]:gap-6 min-[1440px]:items-start">
      {/* Grand écran : recherche, « À traiter » et filtres dans un rail collant (sous la barre fixe de 68 px). Les mêmes
          réglages restent dans « Mes offres » en dessous de 1440 px ; un seul des deux est affiché. */}
      <aside aria-label="Filtrer mes offres" className="hidden min-[1440px]:flex flex-col gap-3.5 sticky top-[84px]">
        <div role="search" aria-label="Rechercher une offre" className="flex">{searchInput('Intitulé, ville…')}</div>
        <section aria-labelledby="a-traiter-rail" className={railCard} style={railCardStyle}>
          <h2 id="a-traiter-rail" className={railHeading} style={railHeadingStyle}>À traiter</h2>
          <div className="flex flex-col gap-1.5">
            {tiles.map(t => {
              const on = filters.focus === t.focus
              return (
                <button key={t.focus} type="button" aria-pressed={on} disabled={t.n === 0 && !on}
                  onClick={() => update({ focus: on ? null : t.focus })}
                  className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer transition-colors hover:border-(--color-text-muted) disabled:cursor-default disabled:opacity-60 disabled:hover:border-(--color-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={{
                    background: on ? 'color-mix(in srgb, var(--color-primary) 5%, var(--color-surface))' : 'var(--color-surface)',
                    border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    color: 'var(--color-text)',
                  }}>
                  <span aria-hidden className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${t.ink} 10%, transparent)`, color: t.ink }}>
                    {t.icon}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-medium leading-snug"><span className="text-[15px] font-semibold tabular-nums">{t.n}</span> {t.label}</span>
                    <span className="text-[11px] leading-snug" style={muted}>{t.sub}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
        <div className={`${railCard} flex flex-col gap-3`} style={railCardStyle}>
          <div role="group" aria-labelledby="statut-rail">
            <h2 id="statut-rail" className={railHeading} style={railHeadingStyle}>Statut</h2>
            {tabs.map(tab => {
              const on = filters.status === tab.status
              return (
                <button key={tab.status} type="button" aria-pressed={on} onClick={() => update({ status: tab.status })}
                  className="w-full h-8 px-2.5 rounded-lg border-0 flex items-center justify-between text-[13px] cursor-pointer focus-visible:outline-2 focus-visible:outline-(--color-text)"
                  style={{
                    background: on ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'transparent',
                    color: 'var(--color-text)', fontWeight: on ? 600 : 500,
                  }}>
                  {tab.label} <span className="text-xs tabular-nums" style={muted}>{tab.n}</span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className={railHeading} style={railHeadingStyle}>Contrat et recruteur</h2>
            {contractSelect}
            {recruiterFilter}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex flex-col gap-6 sm:gap-7 min-[1440px]:gap-4">
        {header}
        <section aria-labelledby="a-traiter" className="flex flex-col gap-3 min-[1440px]:hidden">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h2 id="a-traiter" className="text-base font-bold tracking-[-0.01em]" style={{ color: 'var(--color-text)' }}>À traiter</h2>
            <p className="text-[13px]" style={muted}>Un clic filtre la liste de vos offres.</p>
          </div>
          <div className="flex gap-2.5 overflow-x-auto -mx-4 px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-2 lg:grid-cols-4 sm:gap-3 sm:overflow-visible">
            {tiles.map(t => {
              const on = filters.focus === t.focus
              return (
                <button key={t.focus} type="button" aria-pressed={on} disabled={t.n === 0 && !on}
                  onClick={() => update({ focus: on ? null : t.focus })}
                  className="flex-none w-57.5 sm:w-auto text-left flex items-center gap-3.5 px-4 py-3.5 rounded-2xl cursor-pointer transition-colors hover:border-(--color-text-muted) disabled:cursor-default disabled:opacity-60 disabled:hover:border-(--color-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={{
                    background: on ? 'color-mix(in srgb, var(--color-primary) 5%, var(--color-surface))' : 'var(--color-surface)',
                    border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    boxShadow: on ? '0 0 0 1px var(--color-primary)' : undefined,
                    color: 'var(--color-text)',
                  }}>
                  <span aria-hidden className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: `color-mix(in srgb, ${t.ink} 10%, transparent)`, color: t.ink }}>
                    {t.icon}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-sm font-semibold"><span className="text-lg tabular-nums">{t.n}</span> {t.label}</span>
                    <span className="text-xs" style={muted}>{t.sub}</span>
                  </span>
                  <ArrowRight aria-hidden className="h-4 w-4 shrink-0" style={muted} />
                </button>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="mes-offres" className="rounded-[20px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 id="mes-offres" className="text-lg sm:text-xl font-bold tracking-[-0.015em]" style={{ color: 'var(--color-text)' }}>Mes offres</h2>
              <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 tabular-nums"
                style={{ background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' }}>
                {rows.length}
              </span>
              {sharedCount > 0 && <span className="text-xs" style={muted}>dont {sharedCount} de la plateforme</span>}
              <span className="hidden min-[1440px]:contents">{focusChip}</span>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap w-full sm:w-auto">
              <span className="hidden min-[1440px]:contents">{sortSelect}</span>
              {rows.length > 0 && (
                <Link href="/recruiter/annonces"
                  className="inline-flex items-center gap-2 h-11 sm:h-10 px-3.5 rounded-[10px] text-[13px] font-semibold no-underline transition-opacity hover:opacity-80"
                  style={{ background: 'rgba(232,163,61,0.14)', color: '#8f5e12' }}>
                  <Layers className="h-3.75 w-3.75" aria-hidden /> Suivi &amp; rapports
                </Link>
              )}
              {action && <div className="flex-1 sm:flex-none">{action}</div>}
            </div>
          </div>

          <div role="search" aria-label="Filtrer mes offres" className="px-4 sm:px-6 pb-4 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 min-[1440px]:hidden">
            {searchInput('Rechercher un intitulé, une ville…')}
            <div role="group" aria-label="Statut de l’offre" className="grid grid-cols-3 sm:flex gap-0.5 p-[3px] rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
              {tabs.map(tab => {
                const on = filters.status === tab.status
                return (
                  <button key={tab.status} type="button" aria-pressed={on} onClick={() => update({ status: tab.status })}
                    className="h-[38px] sm:h-[34px] px-3 rounded-[9px] border-0 inline-flex items-center justify-center gap-1.5 text-[13px] cursor-pointer focus-visible:outline-2 focus-visible:outline-(--color-text)"
                    style={{
                      background: on ? 'var(--color-surface)' : 'transparent', color: 'var(--color-text)', fontWeight: on ? 600 : 500,
                      boxShadow: on ? '0 1px 2px rgba(28,28,30,0.08), 0 0 0 1px rgba(28,28,30,0.04)' : undefined,
                    }}>
                    {tab.label} <span className="text-xs tabular-nums" style={muted}>{tab.n}</span>
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:flex">
              {contractSelect}
              {sortSelect}
            </div>
            {recruiterFilter}
            {focusChip}
          </div>

          {socialUnavailable && (
            <p role="status" className="mx-4 sm:mx-6 mb-4 px-3.5 py-2.5 rounded-xl text-[13px]" style={{ background: '#b4530914', color: '#b45309' }}>
              L’état des diffusions sur les réseaux n’a pas pu être lu : la colonne « Diffusion » est incomplète. Rechargez la page dans quelques instants.
            </p>
          )}

          <div aria-hidden className={`hidden lg:grid ${ROW_GRID} px-6 py-2.5 text-xs font-semibold`}
            style={{ ...muted, background: 'color-mix(in srgb, var(--color-text) 2.5%, transparent)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
            <span>Offre</span><span>Candidatures</span><span>Pipeline</span><span>Diffusion</span><span className="text-right">Actions</span>
          </div>

          {shown.length === 0 ? (
            <div className="py-14 px-6 text-center flex flex-col items-center gap-3 border-t border-(--color-border) lg:border-t-0">
              <p className="text-sm" style={muted}>
                {rows.length > 0 ? 'Aucune offre ne correspond à ces filtres.'
                  : recruiterFiltered ? 'Aucune offre affectée à ces recruteurs.' : 'Aucune offre. Créez votre première offre pour commencer.'}
              </p>
              {filtering && (
                <button type="button" onClick={() => update(EMPTY_JOB_FILTERS)}
                  className="h-9 px-3.5 rounded-[10px] text-[13px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={fieldStyle}>
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          ) : (
            <div className="border-t border-(--color-border) lg:border-t-0">
              {shown.slice(0, visible).map((row, i) => {
                const focused = focusJobId === row.job.$id
                return (
                  <JobRow key={row.job.$id} row={row} apps={appsByJob[row.job.$id] ?? []} stages={sortedStages} canPublish={socialEnabled} recruiters={recruiters}
                    first={i === 0} focused={focused} focusRef={focused ? focusRef : undefined} onOpenApplications={() => setOpenJobId(row.job.$id)}
                    previewed={previewRow?.job.$id === row.job.$id} onPreview={() => setPreviewJobId(row.job.$id)} />
                )
              })}
            </div>
          )}

          {shown.length > 0 && (
            <div className="px-4 sm:px-6 py-4 flex flex-col-reverse sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <p className="text-[13px] text-center sm:text-left" style={muted}>
                {displayed} {plural(displayed, 'offre affichée', 'offres affichées')} sur {shown.length}
              </p>
              {displayed < shown.length && (
                <button type="button" onClick={() => setVisible(v => v + PAGE_SIZE)}
                  className="h-11 sm:h-9 px-3.5 rounded-xl sm:rounded-[10px] text-sm sm:text-[13px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)"
                  style={fieldStyle}>
                  Afficher {Math.min(PAGE_SIZE, shown.length - displayed)} {shown.length - displayed > 1 ? 'offres' : 'offre'} de plus
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {previewRow && (
        <aside aria-label="Aperçu de l’offre" className="hidden min-[1800px]:block sticky top-[84px]">
          <JobPreviewPanel row={previewRow} apps={appsByJob[previewRow.job.$id] ?? []} stages={sortedStages} recruiters={recruiters}
            onOpenApplications={() => setOpenJobId(previewRow.job.$id)} />
        </aside>
      )}

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
    </div>
  )
}
