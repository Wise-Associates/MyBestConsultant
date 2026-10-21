import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { Building2, Users, Briefcase, Calendar, ExternalLink } from 'lucide-react'
import { CreateTenantDialog } from './create-tenant-dialog'

export default async function AdminTenantsPage() {
  const { databases } = createAdminClient()

  const [tenantsRes, usersRes, jobsRes] = await Promise.all([
    databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.orderDesc('$createdAt'), Query.limit(100)]),
    databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.limit(200)]),
    databases.listDocuments(DB_ID, COLLECTIONS.JOBS, [Query.limit(200)]),
  ])

  const tenants = tenantsRes.documents
  const users = usersRes.documents
  const jobs = jobsRes.documents

  const jobsByTenant = new Map<string, number>()
  for (const j of jobs) jobsByTenant.set(j.tenantId as string, (jobsByTenant.get(j.tenantId as string) ?? 0) + 1)

  const recruitersByTenant = new Map<string, number>()
  for (const u of users) {
    if (u.role === 'recruiter' && u.tenantId)
      recruitersByTenant.set(u.tenantId as string, (recruitersByTenant.get(u.tenantId as string) ?? 0) + 1)
  }

  const STATS = [
    { label: 'Entreprises',    value: tenants.length,                              icon: Building2, accent: '#3b82f6' },
    { label: 'Recruteurs',     value: users.filter(u => u.role === 'recruiter').length, icon: Users,     accent: '#8b5cf6' },
    { label: 'Offres actives', value: jobs.filter(j => j.isActive).length,         icon: Briefcase,  accent: '#10b981' },
  ]

  return (
    <div className="min-h-full p-8 space-y-8" style={{ color: 'rgba(255,255,255,0.87)' }}>

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>GESTION</p>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Entreprises</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {tenants.length} espace{tenants.length > 1 ? 's' : ''} client enregistré{tenants.length > 1 ? 's' : ''}
          </p>
        </div>
        <CreateTenantDialog />
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
          <h2 className="font-semibold text-sm text-white">Tous les espaces clients</h2>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{tenants.length} résultats</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Entreprise', 'Slug', 'Recruteurs', 'Offres', 'Créé le', ''].map((h, i) => (
                <th key={i} className={`text-left px-6 py-3 text-xs font-medium ${i >= 4 ? (i === 4 ? 'hidden lg:table-cell' : '') : i >= 1 ? 'hidden md:table-cell' : ''}`}
                  style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-20" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  <Building2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p>Aucune entreprise enregistrée</p>
                </td>
              </tr>
            ) : tenants.map(t => (
              <tr key={t.$id} className="group transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={undefined}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                      style={{ background: 'rgba(11,29,81,0.6)', color: '#DAA520', border: '1px solid rgba(184,134,11,0.3)' }}>
                      {(t.name as string).charAt(0).toUpperCase()}
                    </div>
                    <p className="font-medium text-white">{t.name as string}</p>
                  </div>
                </td>
                <td className="px-4 py-4 hidden md:table-cell">
                  <code className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                    {t.slug as string}
                  </code>
                </td>
                <td className="px-4 py-4 text-center hidden md:table-cell">
                  <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Users className="h-3.5 w-3.5" />
                    {recruitersByTenant.get(t.$id) ?? 0}
                  </span>
                </td>
                <td className="px-4 py-4 text-center hidden md:table-cell">
                  <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Briefcase className="h-3.5 w-3.5" />
                    {jobsByTenant.get(t.$id) ?? 0}
                  </span>
                </td>
                <td className="px-4 py-4 hidden lg:table-cell">
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(t.$createdAt as string).toLocaleDateString('fr-FR')}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <a href={`/${t.slug as string}`} target="_blank" rel="noopener noreferrer"
                    className="p-2 rounded-lg transition-all inline-flex"
                    style={{ color: 'rgba(255,255,255,0.3)' }}>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
