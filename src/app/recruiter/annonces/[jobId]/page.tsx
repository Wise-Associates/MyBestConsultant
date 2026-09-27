import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobById } from '@/lib/appwrite/jobs'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { ArrowLeft, FileText, MapPin, Clock } from 'lucide-react'
import { loadTenantOverview } from '../data'
import { PrintButton } from './print-button'
import { withOrphanStages, resolveStatus } from '@/lib/funnel-stage-utils'

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Sur site', hybrid: 'Hybride', remote: 'Télétravail' }
const INTERVIEW_RECO: Record<string, { label: string; color: string }> = {
  hire: { label: 'Recommandé', color: '#10b981' },
  consider: { label: 'À considérer', color: '#f59e0b' },
  reject: { label: 'Non recommandé', color: '#ef4444' },
}
const DONE = new Set(['completed', 'analysed'])

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const scoreColor = (s: number) => (s >= 75 ? '#10b981' : s >= 55 ? '#f59e0b' : '#ef4444')
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

// Rapport d'une annonce : indicateurs, entonnoir par étape et tableau nominatif des candidats
// (étape, score IA, entretien IA, résumé). Pensé pour être exporté en PDF et transmis tel quel
// à la hiérarchie ou au client.
export default async function JobReportPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const job = await getJobById(jobId)
  if (!job || job.tenantId !== user.tenantId) notFound()

  const { apps: allApps, stages: rawStages, names, matches, viviers } = await loadTenantOverview(user.tenantId)
  const stageLites = rawStages.map(s => ({ slug: s.slug, label: s.label, color: s.color, order: s.order, autoAction: s.autoAction ?? null }))
  const apps = allApps.filter(a => a.jobId === jobId).map(a => ({ ...a, status: resolveStatus(stageLites, a.status) })).sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1) || b.createdAt.localeCompare(a.createdAt))

  const stages = withOrphanStages(stageLites, apps.map(a => a.status))
  const stageBySlug = new Map(stages.map(s => [s.slug, s]))

  // Dernier entretien IA de chaque candidature de cette annonce (+ verdict de l'analyse).
  const ivByApp = new Map<string, { status: string; overall: number | null; reco: string | null }>()
  const ivStatuses: string[] = [] // toutes les sessions (une candidature peut en avoir plusieurs)
  if (apps.length > 0) {
    try {
      const { databases } = createAdminClient()
      const ids = apps.map(a => a.$id)
      for (let i = 0; i < ids.length; i += 100) {
        const res = await databases.listDocuments(DB_ID, COLLECTIONS.INTERVIEWS, [
          Query.equal('applicationId', ids.slice(i, i + 100)), Query.orderAsc('$createdAt'), Query.limit(500),
        ])
        for (const d of res.documents) {
          let overall: number | null = null
          let reco: string | null = null
          try { if (d.analysis) { const a = JSON.parse(d.analysis as string); overall = a.overallScore ?? null; reco = a.recommendation ?? null } } catch { /* analyse illisible */ }
          ivByApp.set(d.applicationId as string, { status: d.status as string, overall, reco })
          ivStatuses.push(d.status as string)
        }
      }
    } catch { /* la colonne Entretien restera vide */ }
  }

  const matchCount = matches.filter(m => m.jobId === jobId).length + viviers.filter(v => v.jobId === jobId && v.matchScore != null).length
  const scored = apps.filter(a => a.aiScore != null)
  const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + (a.aiScore ?? 0), 0) / scored.length) : null
  const accepted = apps.filter(a => a.status === 'accepted').length
  const ivDone = ivStatuses.filter(s => DONE.has(s)).length
  const maxStage = Math.max(1, ...stages.map(s => apps.filter(a => a.status === s.slug).length))
  const generated = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
  const state = !job.isActive ? 'Archivée' : job.expiresAt && new Date(job.expiresAt).getTime() < Date.now() ? 'Expirée' : 'Active'

  const kpis = [
    { l: 'Candidatures', v: String(apps.length), c: '#0ea5e9' },
    { l: 'Matching IA', v: String(matchCount), c: '#7c3aed' },
    { l: 'Entretiens IA', v: `${ivDone}/${ivStatuses.length}`, c: '#3b82f6' },
    { l: 'Score IA moyen', v: avgScore !== null ? `${avgScore}/100` : '—', c: avgScore !== null ? scoreColor(avgScore) : '#6b7280' },
    { l: 'Acceptés', v: String(accepted), c: '#10b981' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="no-print" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-4xl mx-auto px-6 py-7">
          <Link href="/recruiter/annonces" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour au suivi des annonces
          </Link>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
                <FileText className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Rapport d&apos;annonce</p>
                <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.6rem' }}>{job.title}</h1>
              </div>
            </div>
            <PrintButton />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Titre du document (visible aussi à l'impression) */}
        <div>
          <p className="hidden print-only text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Rapport d&apos;annonce</p>
          <h2 className="hidden print-only font-bold" style={{ color: 'var(--color-text)', fontSize: '1.5rem' }}>{job.title}</h2>
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.location}</span>
            {job.contractType && <span>{CONTRACT[job.contractType] ?? job.contractType}</span>}
            {job.remote && <span>{REMOTE[job.remote] ?? job.remote}</span>}
            <span>{state}</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Publiée le {fmtDate(job.createdAt)}</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Rapport généré le {generated}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {kpis.map(k => (
            <div key={k.l} className="rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{k.l}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: k.c }}>{k.v}</p>
            </div>
          ))}
        </div>

        {/* Entonnoir */}
        <section className="rounded-3xl p-5 sm:p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', breakInside: 'avoid' }}>
          <h3 className="font-bold mb-4" style={{ color: 'var(--color-text)', fontSize: '0.95rem' }}>Répartition par étape du funnel</h3>
          {apps.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune candidature pour cette annonce.</p>
          ) : (
            <div className="space-y-2.5">
              {stages.map(s => {
                const n = apps.filter(a => a.status === s.slug).length
                return (
                  <div key={s.slug} className="flex items-center gap-3">
                    <span className="w-36 sm:w-44 shrink-0 text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{s.label}</span>
                    <div className="flex-1 h-6 rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.05)' }}>
                      {n > 0 && <div className="h-full rounded-lg flex items-center justify-end pr-2 text-[11px] font-bold text-white" style={{ width: `${Math.max((n / maxStage) * 100, 8)}%`, background: s.color }}>{n}</div>}
                    </div>
                    <span className="w-10 text-right text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>{pct(n, apps.length)}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Candidats */}
        {apps.length > 0 && (
          <section className="rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="font-bold px-5 sm:px-6 pt-5 pb-3" style={{ color: 'var(--color-text)', fontSize: '0.95rem' }}>Candidats ({apps.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: 640 }}>
                <thead>
                  <tr style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                    <th className="text-left font-semibold px-5 sm:px-6 py-2.5">Candidat</th>
                    <th className="text-left font-semibold px-3 py-2.5">Étape</th>
                    <th className="text-left font-semibold px-3 py-2.5">Score CV</th>
                    <th className="text-left font-semibold px-3 py-2.5">Entretien IA</th>
                    <th className="text-left font-semibold px-3 py-2.5 pr-5 sm:pr-6">Candidature</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map(a => {
                    const st = stageBySlug.get(a.status)
                    const color = st?.color ?? '#6b7280'
                    const iv = ivByApp.get(a.$id)
                    const reco = iv?.reco ? INTERVIEW_RECO[iv.reco] : null
                    return (
                      <tr key={a.$id} style={{ borderTop: '1px solid var(--color-border)', breakInside: 'avoid' }}>
                        <td className="px-5 sm:px-6 py-3 align-top">
                          <Link href={`/recruiter/candidates/${a.$id}`} className="font-semibold no-underline hover:underline" style={{ color: 'var(--color-text)' }}>{names.get(a.candidateId) ?? 'Candidat'}</Link>
                          {a.aiSummary && <p className="mt-1 leading-relaxed" style={{ color: 'var(--color-text-muted)', maxWidth: 360 }}>{a.aiSummary.length > 180 ? `${a.aiSummary.slice(0, 180)}…` : a.aiSummary}</p>}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span className="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${color}16`, color }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{st?.label ?? a.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top font-bold" style={{ color: a.aiScore != null ? scoreColor(a.aiScore) : 'var(--color-text-muted)' }}>{a.aiScore != null ? a.aiScore : '—'}</td>
                        <td className="px-3 py-3 align-top">
                          {!iv ? <span style={{ color: 'var(--color-text-muted)' }}>—</span> : (
                            <div>
                              <span style={{ color: 'var(--color-text)' }}>{DONE.has(iv.status) ? (iv.overall !== null ? `${iv.overall}/100` : 'Terminé') : iv.status === 'in_progress' ? 'En cours' : 'Envoyé'}</span>
                              {reco && <span className="block font-semibold" style={{ color: reco.color }}>{reco.label}</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 pr-5 sm:pr-6 align-top whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{fmtDate(a.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <style>{`
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .print-only { display: block !important; }
        }
      `}</style>
    </div>
  )
}
