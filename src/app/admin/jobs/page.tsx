import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { Briefcase, ToggleLeft, TrendingUp } from 'lucide-react'
import { ImportJobs } from './import-jobs'
import { JobsList } from './jobs-list'

export default async function AdminJobsPage() {
  const { databases } = createAdminClient()

  const result = await databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [
    Query.orderDesc('$createdAt'),
    Query.limit(100),
  ])

  const jobs = result.documents
  const active = jobs.filter(j => j.isActive).length

  const STATS = [
    { label: 'Total offres',  value: jobs.length, icon: Briefcase,   accent: '#60a5fa' },
    { label: 'Actives',       value: active,       icon: TrendingUp,  accent: '#34d399' },
    { label: 'Inactives',     value: jobs.length - active, icon: ToggleLeft, accent: '#94a3b8' },
  ]

  return (
    <div className="min-h-full p-8 space-y-8" style={{ color: 'rgba(255,255,255,0.87)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>RECRUTEMENT</p>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Offres d&apos;emploi</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {jobs.length} offre{jobs.length > 1 ? 's' : ''} publiée{jobs.length > 1 ? 's' : ''}
          </p>
        </div>
        <ImportJobs tenantId="admin" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {STATS.map(s => (
          <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `${s.accent}18` }}>
              <s.icon className="h-5 w-5" style={{ color: s.accent }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-semibold text-sm text-white">Toutes les offres</h2>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{jobs.length} résultats — cliquez sur une ligne pour modifier</span>
        </div>
        <JobsList initialJobs={jobs.map(j => ({
          $id: j.$id as string,
          title: j.title as string,
          companyName: j.companyName as string | undefined,
          location: j.location as string,
          contractType: j.contractType as 'cdi' | 'cdd' | 'freelance' | 'mission' | undefined,
          remote: j.remote as 'onsite' | 'hybrid' | 'remote' | undefined,
          salary: j.salary as number | undefined,
          skills: (j.skills as string[]) ?? [],
          description: j.description as string,
          isActive: j.isActive as boolean,
          createdAt: j.$createdAt as string,
          expiresAt: j.expiresAt as string | undefined,
        }))} />
      </div>
    </div>
  )
}
