import Link from 'next/link'
import type { Metadata } from 'next'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { MapPin, Briefcase, Clock, Wifi, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Job } from '@/types'
import { JobSearchForm } from './job-search-form'
import { parseKeywordRowsFromParams } from '@/lib/keyword-match'
import { SENIORITY_MAX } from '@/lib/job-seniority'

export const metadata: Metadata = {
  title: 'Offres IT & Consulting | MyBestConsultant',
  description: 'Toutes nos offres en CDI, CDD, freelance et mission dans l\'IT et le conseil. Postulez en quelques clics.',
}

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission',
}
const CONTRACT_COLORS: Record<string, string> = {
  cdi: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cdd: 'bg-blue-50 text-blue-700 border-blue-200',
  freelance: 'bg-purple-50 text-purple-700 border-purple-200',
  mission: 'bg-amber-50 text-amber-700 border-amber-200',
}
const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote',
}
const PAGE_SIZE = 50

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kw?: string | string[]; kwOp?: string | string[]
    exclude?: string | string[]; excludeOp?: string | string[]
    location?: string; contract?: string; remote?: string; page?: string
    senMin?: string; senMax?: string
  }>
}) {
  const sp = await searchParams
  const toArray = (v?: string | string[]) => v === undefined ? undefined : Array.isArray(v) ? v : [v]
  const keywords = parseKeywordRowsFromParams(toArray(sp.kw), toArray(sp.kwOp))
  const excludeKeywords = parseKeywordRowsFromParams(toArray(sp.exclude), toArray(sp.excludeOp))
  const seniorityMin = sp.senMin !== undefined ? Math.max(0, parseInt(sp.senMin, 10) || 0) : 0
  const seniorityMax = sp.senMax !== undefined ? Math.min(SENIORITY_MAX, parseInt(sp.senMax, 10) || SENIORITY_MAX) : SENIORITY_MAX

  const allJobs = await getActiveJobs({
    keywords,
    excludeKeywords,
    location: sp.location,
    contractType: sp.contract,
    remote: sp.remote,
    seniorityRange: [seniorityMin, seniorityMax],
  })

  const total = allJobs.length
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(totalPages, Math.max(1, parseInt(sp.page ?? '1', 10) || 1))
  const jobs = allJobs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasActiveFilters = keywords.some(r => r.term.trim()) || excludeKeywords.some(r => r.term.trim())
    || sp.location || sp.contract || sp.remote || seniorityMin > 0 || seniorityMax < SENIORITY_MAX

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      {/* ── Header ── */}
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: '2rem', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
            Offres IT & Consulting
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
            {total > 0 ? `${total} offre${total > 1 ? 's' : ''} active${total > 1 ? 's' : ''}` : 'Aucune offre pour le moment'}
          </p>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col lg:flex-row gap-8 items-start">
        {/* Search / filters card */}
        <aside className="mbc-sticky-aside w-full lg:w-96 shrink-0 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto space-y-3">
          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
            Mes critères de recherche
          </h2>
          <JobSearchForm
            initialKeywords={keywords}
            initialExclude={excludeKeywords}
            initialLocation={sp.location ?? ''}
            initialContract={sp.contract ?? ''}
            initialRemote={sp.remote ?? ''}
            initialSeniority={[seniorityMin, seniorityMax]}
          />
          {hasActiveFilters && (
            <Link href="/jobs" className="block text-center text-xs font-medium no-underline"
              style={{ color: 'var(--color-text-muted)' }}>
              Effacer tous les filtres
            </Link>
          )}
        </aside>

        {/* Jobs list */}
        <main className="flex-1 min-w-0">
          {jobs.length === 0 ? (
            <div className="text-center py-20">
              <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem' }}>
                Aucune offre ne correspond à vos critères.
              </p>
              <Link href="/jobs" className="inline-block mt-4 text-sm font-medium"
                style={{ color: 'var(--color-primary)' }}>
                Voir toutes les offres
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {jobs.map(job => <JobCard key={job.$id} job={job} />)}
              </div>
              <Pagination sp={sp} page={page} totalPages={totalPages} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

// ── Job card ─────────────────────────────────────────────────────

function JobCard({ job }: { job: Job }) {
  const daysSince = Math.floor(
    (Date.now() - new Date(job.createdAt).getTime()) / 86_400_000
  )
  const postedLabel = daysSince === 0 ? "Aujourd'hui" : daysSince === 1 ? 'Hier' : `Il y a ${daysSince} j`

  return (
    <Link href={`/jobs/${job.$id}`} className="block group">
      <div className="p-5 rounded-3xl transition-all duration-300 ease-out group-hover:-translate-y-1"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)',
        }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {job.contractType && (
                <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${CONTRACT_COLORS[job.contractType] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                  {CONTRACT_LABELS[job.contractType]}
                </span>
              )}
              {job.remote && (
                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  <Wifi className="h-3 w-3" />{REMOTE_LABELS[job.remote]}
                </span>
              )}
            </div>
            <h2 className="font-bold text-base group-hover:underline"
              style={{ color: 'var(--color-text)', textUnderlineOffset: '3px' }}>
              {job.title}
            </h2>
            {job.companyName && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {job.companyName}
              </p>
            )}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                <MapPin className="h-3.5 w-3.5" />{job.location}
              </span>
              {job.salary && (
                <span className="flex items-center gap-1 text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
                  <Briefcase className="h-3.5 w-3.5" />
                  {job.salary.toLocaleString('fr-FR')} {job.contractType === 'cdi' || job.contractType === 'cdd' ? '€/an' : '€/j'}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock className="h-3 w-3" />{postedLabel}
            </span>
          </div>
        </div>

        {job.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {job.skills.slice(0, 6).map(s => (
              <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                {s}
              </span>
            ))}
            {job.skills.length > 6 && (
              <span className="px-2 py-0.5 rounded text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                +{job.skills.length - 6}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

// ── Pagination ────────────────────────────────────────────────────

type JobsSearchParams = Record<string, string | string[] | undefined>

function pageUrl(sp: JobsSearchParams, page: number): string {
  const params = new URLSearchParams()
  for (const k of ['kw', 'kwOp', 'exclude', 'excludeOp', 'location', 'contract', 'remote', 'senMin', 'senMax']) {
    const v = sp[k]
    if (Array.isArray(v)) v.forEach(x => x && params.append(k, x))
    else if (v) params.set(k, v)
  }
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return `/jobs${qs ? '?' + qs : ''}`
}

function Pagination({ sp, page, totalPages }: { sp: JobsSearchParams; page: number; totalPages: number }) {
  if (totalPages <= 1) return null

  // Compact page-number window around the current page, with first/last always shown.
  const nums = new Set<number>([1, totalPages, page, page - 1, page + 1])
  const pages = [...nums].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b)

  const items: (number | 'ellipsis')[] = []
  let prev = 0
  for (const n of pages) {
    if (prev && n - prev > 1) items.push('ellipsis')
    items.push(n)
    prev = n
  }

  const pill = "min-w-[38px] h-[38px] px-2 flex items-center justify-center rounded-xl text-sm font-semibold transition-all"

  return (
    <nav className="flex items-center justify-center gap-1.5 mt-10 mb-4 flex-wrap">
      <Link href={pageUrl(sp, Math.max(1, page - 1))}
        aria-disabled={page === 1}
        className={pill + ' no-underline'}
        style={page === 1
          ? { color: 'var(--color-text-muted)', opacity: 0.35, pointerEvents: 'none' }
          : { color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 12px rgba(11,29,81,0.08)' }}>
        <ChevronLeft className="h-4 w-4" />
      </Link>

      {items.map((it, i) => it === 'ellipsis'
        ? <span key={`e${i}`} className="px-1.5 text-sm" style={{ color: 'var(--color-text-muted)' }}>…</span>
        : (
          <Link key={it} href={pageUrl(sp, it)} className={pill + ' no-underline'}
            style={it === page
              ? { background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 20px rgba(11,29,81,0.3)' }
              : { color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 12px rgba(11,29,81,0.08)' }}>
            {it}
          </Link>
        ))}

      <Link href={pageUrl(sp, Math.min(totalPages, page + 1))}
        aria-disabled={page === totalPages}
        className={pill + ' no-underline'}
        style={page === totalPages
          ? { color: 'var(--color-text-muted)', opacity: 0.35, pointerEvents: 'none' }
          : { color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 12px rgba(11,29,81,0.08)' }}>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </nav>
  )
}

