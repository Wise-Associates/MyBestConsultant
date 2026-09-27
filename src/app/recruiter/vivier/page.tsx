import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant } from '@/lib/appwrite/jobs'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { ArrowLeft, FolderOpen, MapPin, Users } from 'lucide-react'

// "Mon vivier" is per-offre (CV importés pour une offre précise) — cette page liste les
// offres du recruteur pour choisir de quel vivier il s'agit, plutôt que de deviner.
export default async function VivierIndexPage() {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin') || !user.tenantId) redirect('/login')

  const jobs = await getJobsByTenant(user.tenantId)

  // Nombre de profils du vivier par offre (les siens ; tous pour un administrateur).
  const counts = new Map<string, number>()
  try {
    const { databases } = createAdminClient()
    const q = [Query.equal('tenantId', user.tenantId), Query.limit(1000)]
    if (user.role !== 'admin') q.push(Query.equal('recruiterId', user.$id))
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, q)
    for (const d of res.documents) counts.set(d.jobId as string, (counts.get(d.jobId as string) ?? 0) + 1)
  } catch { /* les compteurs sont un plus : la liste s'affiche sans */ }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}>
              <FolderOpen className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Mon vivier</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Choisissez une offre : chaque CV importé devient automatiquement un profil</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8">
        {jobs.length === 0 ? (
          <p className="text-sm text-center py-16" style={{ color: 'var(--color-text-muted)' }}>Aucune offre pour l&apos;instant.</p>
        ) : (
          <div className="rounded-2xl overflow-hidden divide-y" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderColor: 'var(--color-border)' }}>
            {jobs.map(job => (
              <Link key={job.$id} href={`/recruiter/vivier/${job.$id}`}
                className="flex items-center justify-between gap-3 px-5 py-4 no-underline transition-colors hover:bg-[rgba(11,29,81,0.025)]">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{job.title}</p>
                  <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    <MapPin className="h-3 w-3" /> {job.location}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 shrink-0 text-xs font-semibold" style={{ color: counts.get(job.$id) ? '#b8862f' : 'var(--color-text-muted)' }}>
                  <Users className="h-3.5 w-3.5" />{counts.get(job.$id) ?? 0} profil{(counts.get(job.$id) ?? 0) > 1 ? 's' : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
