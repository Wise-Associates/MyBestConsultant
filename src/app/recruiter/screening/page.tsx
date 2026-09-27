import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant, getApplicationsByTenant } from '@/lib/appwrite/jobs'
import Link from 'next/link'
import { Brain, ChevronRight, Users, ArrowLeft, Trophy } from 'lucide-react'

export default async function ScreeningIndexPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  if (!user.tenantId) redirect('/recruiter/dashboard')

  const [jobs, applications] = await Promise.all([
    getJobsByTenant(user.tenantId),
    getApplicationsByTenant(user.tenantId),
  ])
  const activeJobs = jobs.filter(j => j.isActive)
  const appCountByJob = new Map<string, number>()
  for (const app of applications) {
    appCountByJob.set(app.jobId, (appCountByJob.get(app.jobId) ?? 0) + 1)
  }

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: '#c4b5fd' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(124,58,237,0.18)' }}>
              <Brain className="h-6 w-6" style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Screening IA des CV</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Score 0–100 · Classement automatique · Export CSV</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link href="/recruiter/screening/best"
          className="flex items-center gap-4 p-5 rounded-3xl mb-6 no-underline transition-all duration-300 hover:-translate-y-1"
          style={{ background: 'linear-gradient(135deg, rgba(184,134,11,0.15), rgba(184,134,11,0.05))', border: '1px solid rgba(184,134,11,0.3)', boxShadow: '0 10px 30px -10px rgba(184,134,11,0.2)' }}>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(184,134,11,0.18)' }}>
            <Trophy className="h-5 w-5" style={{ color: '#B8860B' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>Meilleurs candidats</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Classement toutes offres confondues</p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
        </Link>
        <div className="space-y-3">
          {activeJobs.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
              <p>Aucune offre active. Publiez une offre d&apos;emploi pour commencer le screening.</p>
            </div>
          ) : (
            activeJobs.map(job => (
              <Link key={job.$id} href={`/recruiter/screening/${job.$id}`}
                className="flex items-center gap-4 p-5 rounded-3xl no-underline transition-all duration-300 hover:-translate-y-1"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold" style={{ color: 'var(--color-text)' }}>{job.title}</h2>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{job.location} · {job.contractType?.toUpperCase()}</p>
                </div>
                <div className="flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                  <Users className="h-4 w-4" />
                  <span className="text-sm">{appCountByJob.get(job.$id) ?? 0}</span>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
              </Link>
            ))
          )}
        </div>
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
