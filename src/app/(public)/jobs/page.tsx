import Link from 'next/link'
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { listCard, listCardStyle, muted } from '@/components/shared/list-styles'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { JOBS_PAGE_SIZE, jobFacets } from '@/lib/job-listing'
import { SENIORITY_MAX } from '@/lib/job-seniority'
import { parseKeywordRowsFromParams } from '@/lib/keyword-match'
import { JobRow, JobTableHeader } from './job-row'
import { FiltersColumn } from './filters-column'
import { JobSearchForm } from './job-search-form'
import { TopSkills, TopSkillsSkeleton } from './top-skills'

export const metadata: Metadata = {
  title: 'Offres IT & Consulting | MyBestConsultant',
  description: 'Toutes nos offres en CDI, CDD, freelance et mission dans l\'IT et le conseil. Postulez en quelques clics.',
}

// Liste publique des offres (refonte du 2026-11-13 d'après la maquette, avec la charte du tableau de bord recruteur :
// bandeau clair, rail de filtres, liste « Mes offres », list-styles.ts) : critères à gauche, offres en tableau à droite,
// compétences les plus demandées de toutes les offres chargées à part (Suspense, forme grise en attendant).

type JobsSearchParams = {
  kw?: string | string[]; kwOp?: string | string[]
  exclude?: string | string[]; excludeOp?: string | string[]
  location?: string; contract?: string; remote?: string; page?: string
  senMin?: string; senMax?: string
}

const FILTER_KEYS = ['kw', 'kwOp', 'exclude', 'excludeOp', 'location', 'contract', 'remote', 'senMin', 'senMax'] as const

/** Adresse de la liste avec les critères en cours ; `kw` remplace les mots-clés (clic sur une compétence). */
function listUrl(sp: JobsSearchParams, change: { page?: number; kw?: string }): string {
  const params = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    if (change.kw !== undefined && (k === 'kw' || k === 'kwOp')) continue
    const v = sp[k]
    if (Array.isArray(v)) v.forEach(x => x && params.append(k, x))
    else if (v) params.set(k, v)
  }
  if (change.kw !== undefined) params.set('kw', change.kw)
  if (change.page && change.page > 1) params.set('page', String(change.page))
  const qs = params.toString()
  return `/jobs${qs ? `?${qs}` : ''}`
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<JobsSearchParams> }) {
  const sp = await searchParams
  const toArray = (v?: string | string[]) => v === undefined ? undefined : Array.isArray(v) ? v : [v]
  const keywords = parseKeywordRowsFromParams(toArray(sp.kw), toArray(sp.kwOp))
  const excludeKeywords = parseKeywordRowsFromParams(toArray(sp.exclude), toArray(sp.excludeOp))
  const seniorityMin = sp.senMin !== undefined ? Math.max(0, parseInt(sp.senMin, 10) || 0) : 0
  const seniorityMax = sp.senMax !== undefined ? Math.min(SENIORITY_MAX, parseInt(sp.senMax, 10) || SENIORITY_MAX) : SENIORITY_MAX

  // Contrat et télétravail filtrés ici (jobFacets) : leurs nombres se comptent sur les offres des autres critères.
  const matching = await getActiveJobs({
    keywords,
    excludeKeywords,
    location: sp.location,
    seniorityRange: [seniorityMin, seniorityMax],
  })
  const { results, contractCounts, remoteCounts, contractTotal, remoteTotal } = jobFacets(matching, { contract: sp.contract, remote: sp.remote })

  const total = results.length
  const totalPages = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE))
  const page = Math.min(totalPages, Math.max(1, parseInt(sp.page ?? '1', 10) || 1))
  const jobs = results.slice((page - 1) * JOBS_PAGE_SIZE, page * JOBS_PAGE_SIZE)
  // Heure de la requête : « Nouveau » et « Publiée il y a… » (rendu serveur, page dynamique).
  const nowMs = new Date().getTime()

  const hasActiveFilters = keywords.some(r => r.term.trim()) || excludeKeywords.some(r => r.term.trim())
    || sp.location || sp.contract || sp.remote || seniorityMin > 0 || seniorityMax < SENIORITY_MAX
  const plural = total > 1 ? 's' : ''

  return (
    // Bandeau clair et fond de page de l'espace recruteur (.mbc-light-banners, globals.css).
    <div className="mbc-light-banners" style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid var(--hero-line)' }}>
        <div className="max-w-6xl min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
          <h1 style={{ color: 'var(--hero-fg)', fontWeight: 300, fontSize: '1.75rem', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            Offres IT &amp; Consulting
          </h1>
          <p className="text-sm" style={{ color: 'var(--hero-fg-muted)' }}>
            {total > 0 ? `${total} offre${plural} active${plural}` : 'Aucune offre pour ces critères'}
          </p>
        </div>
      </div>

      <div className="max-w-6xl min-[90rem]:max-w-[1920px] mx-auto px-4 sm:px-6 min-[90rem]:px-8 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 items-start">
        <FiltersColumn>
          <JobSearchForm
            initialKeywords={keywords}
            initialExclude={excludeKeywords}
            initialLocation={sp.location ?? ''}
            initialContract={sp.contract ?? ''}
            initialRemote={sp.remote ?? ''}
            initialSeniority={[seniorityMin, seniorityMax]}
            contractCounts={contractCounts}
            remoteCounts={remoteCounts}
            contractTotal={contractTotal}
            remoteTotal={remoteTotal}
            hasActiveFilters={!!hasActiveFilters}
          />
        </FiltersColumn>

        <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
          <section aria-labelledby="results-title" className={listCard} style={listCardStyle}>
            <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 flex flex-col gap-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 id="results-title" style={{ color: 'var(--color-text)', fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.3 }}>Offres</h2>
                <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 tabular-nums"
                  style={{ background: 'color-mix(in srgb, var(--color-text) 7%, transparent)', color: 'var(--color-text)' }}>
                  {total}
                </span>
                <span className="text-xs" style={muted}>les plus récentes d&apos;abord</span>
              </div>
              <Suspense fallback={<TopSkillsSkeleton />}>
                <TopSkills hrefFor={skill => listUrl(sp, { kw: skill })} />
              </Suspense>
            </div>

            {jobs.length === 0 ? (
              <div className="py-14 px-6 text-center flex flex-col items-center gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <p className="text-sm" style={muted}>Aucune offre ne correspond à vos critères.</p>
                {hasActiveFilters && (
                  <Link href="/jobs" className="text-[13px] font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>
                    Voir toutes les offres
                  </Link>
                )}
              </div>
            ) : (
              <>
                <JobTableHeader />
                <ul style={{ borderTop: '1px solid var(--color-border)' }} className="lg:border-t-0 overflow-hidden rounded-b-[20px]">
                  {jobs.map((job, i) => <JobRow key={job.$id} job={job} nowMs={nowMs} first={i === 0} />)}
                </ul>
              </>
            )}
          </section>

          {total > 0 && <Pagination sp={sp} page={page} totalPages={totalPages} total={total} />}
        </div>
      </div>
    </div>
  )
}

// ── Pagination (boutons du tableau de bord recruteur) ─────────────────────────────

const pageButton = 'h-11 sm:h-9 min-w-11 sm:min-w-9 px-3.5 rounded-[10px] inline-flex items-center justify-center text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-text)'
const idle = { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' } as const

function Pagination({ sp, page, totalPages, total }: { sp: JobsSearchParams; page: number; totalPages: number; total: number }) {
  const from = (page - 1) * JOBS_PAGE_SIZE + 1
  const to = Math.min(page * JOBS_PAGE_SIZE, total)

  // Numéros autour de la page en cours, première et dernière toujours montrées.
  const nums = [...new Set([1, totalPages, page, page - 1, page + 1])].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const items: (number | 'ellipsis')[] = []
  let prev = 0
  for (const n of nums) {
    if (prev && n - prev > 1) items.push('ellipsis')
    items.push(n)
    prev = n
  }

  const edge = (label: string, target: number, disabled: boolean) => disabled
    ? <span aria-disabled="true" className={pageButton} style={{ ...idle, color: 'var(--color-text-muted)', opacity: 0.6 }}>{label}</span>
    : <Link href={listUrl(sp, { page: target })} className={pageButton} style={idle}>{label}</Link>

  return (
    <nav aria-label="Pages des offres" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px]" style={muted}>Offres {from} à {to} sur {total}</p>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {edge('Précédente', page - 1, page === 1)}
          {items.map((it, i) => it === 'ellipsis'
            ? <span key={`e${i}`} className="px-1 text-[13px]" style={muted}>…</span>
            : (
              <Link key={it} href={listUrl(sp, { page: it })} aria-current={it === page ? 'page' : undefined} className={pageButton}
                style={it === page ? { background: 'var(--color-text)', color: 'var(--color-surface)', border: '1px solid var(--color-text)' } : idle}>
                {it}
              </Link>
            ))}
          {edge('Suivante', page + 1, page === totalPages)}
        </div>
      )}
    </nav>
  )
}
