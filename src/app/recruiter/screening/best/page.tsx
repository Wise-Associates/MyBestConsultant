import { displayEmail } from '@/lib/candidate-identity'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant, getApplicationsByTenant } from '@/lib/appwrite/jobs'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { ArrowLeft, Trophy, FileText, Video, Mail, Users } from 'lucide-react'

const RECO: Record<string, { label: string; color: string; darkBg: string }> = {
  top:     { label: 'Top profil',    color: '#10b981', darkBg: '#065f46' },
  good:    { label: 'Bon profil',    color: '#3b82f6', darkBg: '#1e3a8a' },
  average: { label: 'Profil moyen',  color: '#f59e0b', darkBg: '#78350f' },
  weak:    { label: 'Profil faible', color: '#e8a33d', darkBg: '#7c2d12' },
  reject:  { label: 'À rejeter',     color: '#ef4444', darkBg: '#7f1d1d' },
}

const MIN_OPTIONS = [
  { key: 'all', label: 'Tous les scorés', min: 0 },
  { key: '70', label: 'Score ≥ 70', min: 70 },
  { key: '85', label: 'Score ≥ 85', min: 85 },
]

export default async function BestCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; min?: string }>
}) {
  const { job: jobFilter, min: minFilter } = await searchParams
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  if (!user.tenantId) redirect('/recruiter/dashboard')

  const [jobs, applications] = await Promise.all([
    getJobsByTenant(user.tenantId),
    getApplicationsByTenant(user.tenantId),
  ])

  const jobTitleMap = new Map(jobs.map(j => [j.$id, j.title]))

  const minOption = MIN_OPTIONS.find(o => o.key === minFilter) ?? MIN_OPTIONS[0]
  let scored = applications.filter(a => a.aiScore !== undefined && a.aiScore >= minOption.min)
  if (jobFilter) scored = scored.filter(a => a.jobId === jobFilter)
  scored.sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0))

  const candidateIds = [...new Set(scored.map(a => a.candidateId))]
  const candidateMap = new Map<string, { name: string; email: string }>()
  if (candidateIds.length > 0) {
    try {
      const { databases } = createAdminClient()
      const result = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
        Query.equal('$id', candidateIds.slice(0, 100)),
        Query.limit(100),
      ])
      for (const doc of result.documents) {
        candidateMap.set(doc.$id, {
          name: `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim(),
          email: displayEmail(doc),
        })
      }
    } catch { /* silently skip */ }
  }

  const qs = (overrides: { job?: string; min?: string }) => {
    const params = new URLSearchParams()
    const j = overrides.job !== undefined ? overrides.job : jobFilter
    const m = overrides.min !== undefined ? overrides.min : minFilter
    if (j) params.set('job', j)
    if (m && m !== 'all') params.set('min', m)
    const s = params.toString()
    return s ? `?${s}` : ''
  }

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Link href="/recruiter/screening"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour au screening
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(184,134,11,0.2)' }}>
              <Trophy className="h-6 w-6" style={{ color: '#f0c95a' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Meilleurs candidats</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Classement toutes offres confondues, par score de screening IA</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            {MIN_OPTIONS.map(o => (
              <Link key={o.key} href={qs({ min: o.key })}
                className="px-4 py-2 rounded-full text-sm font-semibold no-underline transition-all"
                style={minOption.key === o.key
                  ? { background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 20px -6px rgba(37,99,235,0.5)' }
                  : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                {o.label}
              </Link>
            ))}
          </div>
          {jobs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={qs({ job: '' })}
                className="px-4 py-2 rounded-full text-sm font-semibold no-underline transition-all"
                style={!jobFilter
                  ? { background: 'rgba(124,58,237,0.15)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }
                  : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                Toutes les offres
              </Link>
              {jobs.map(j => (
                <Link key={j.$id} href={qs({ job: j.$id })}
                  className="px-4 py-2 rounded-full text-sm font-semibold no-underline transition-all truncate max-w-[220px]"
                  style={jobFilter === j.$id
                    ? { background: 'rgba(124,58,237,0.15)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.3)' }
                    : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}>
                  {j.title}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Ranking */}
        {scored.length === 0 ? (
          <div className="rounded-3xl py-16 text-center px-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Users className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--color-text-muted)', opacity: 0.3 }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun candidat scoré pour ces filtres.</p>
          </div>
        ) : (
          <div className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.14)' }}>
            {scored.map((app, i) => {
              const cand = candidateMap.get(app.candidateId)
              const reco = RECO[app.aiRecommendation ?? 'average'] ?? RECO.average
              const rank = i + 1
              return (
                <div key={app.$id} className="flex items-center gap-4 px-5 py-4"
                  style={{ borderBottom: i < scored.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0"
                    style={{
                      background: rank <= 3 ? 'rgba(184,134,11,0.15)' : 'rgba(11,29,81,0.06)',
                      color: rank <= 3 ? '#B8860B' : 'var(--color-text-muted)',
                    }}>
                    #{rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/recruiter/candidates/${app.$id}`}
                        className="text-sm font-semibold truncate no-underline hover:underline" style={{ color: 'var(--color-text)' }}>
                        {cand?.name || app.candidateId}
                      </Link>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: reco.darkBg }}>
                        {reco.label}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {jobTitleMap.get(app.jobId) ?? 'Offre supprimée'} · {cand?.email}
                    </p>
                    {app.aiSummary && (
                      <p className="text-xs mt-1.5 line-clamp-2" style={{ color: 'var(--color-text)', opacity: 0.75 }}>{app.aiSummary}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className="text-lg font-bold" style={{ color: reco.color }}>{app.aiScore}<span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>/100</span></span>
                    <div className="flex items-center gap-1.5">
                      {app.cvFileId && (
                        <a href={`/api/cv/${app.cvFileId}`} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-lg transition-opacity hover:opacity-70" title="Voir le CV"
                          style={{ background: 'rgba(11,29,81,0.07)', color: 'var(--color-primary)' }}>
                          <FileText className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {cand?.email && (
                        <a href={`mailto:${cand.email}`}
                          className="p-1.5 rounded-lg transition-opacity hover:opacity-70" title="Contacter"
                          style={{ background: 'rgba(59,130,246,0.08)', color: '#3b82f6' }}>
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <Link href={`/recruiter/interviews/new?appId=${app.$id}&jobId=${app.jobId}`}
                        className="p-1.5 rounded-lg transition-opacity hover:opacity-70" title="Entretien IA"
                        style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981' }}>
                        <Video className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes mbc-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.08); } }
        @keyframes mbc-float-slow { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-24px, 24px) scale(1.05); } }
        .mbc-orb { animation: mbc-float 14s ease-in-out infinite; }
        .mbc-orb-slow { animation: mbc-float-slow 18s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
