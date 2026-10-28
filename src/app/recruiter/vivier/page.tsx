import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getJobsByTenant, getOpenJobsOfTenant } from '@/lib/appwrite/jobs'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { ArrowLeft, FolderOpen, MapPin, Users } from 'lucide-react'
import { getGeneralVivier } from './actions'
import { VivierClient } from './vivier-client'
import { VivierTabs } from './vivier-tabs'

// Import d'un CV dans le vivier général (Server Action de cette page) : profil créé par l'IA, puis comparaison aux
// offres ouvertes par lots en parallèle, avec repli sur un autre modèle en cas d'échec ; « Synchroniser » de même.
export const maxDuration = 300

// « Mon vivier », en deux onglets : la liste des offres (par défaut), chacune avec son propre vivier (CV importés pour
// cette offre précise), et le vivier général (CV importés sans choisir d'offre, comparés automatiquement aux offres ouvertes).
export default async function VivierIndexPage({ searchParams }: { searchParams: Promise<{ vue?: string | string[] }> }) {
  const { vue } = await searchParams
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin') || !user.tenantId) redirect('/login')

  const [jobs, openJobs, general] = await Promise.all([getJobsByTenant(user.tenantId), getOpenJobsOfTenant(user.tenantId), getGeneralVivier()])

  // Nombre de profils du vivier par offre (les siens ; tous pour un administrateur).
  const counts = new Map<string, number>()
  try {
    const { databases } = createAdminClient()
    // Viviers d'offres seulement, offre de chaque CV seule : le vivier général et les profils remplissaient la limite.
    const q = [Query.equal('tenantId', user.tenantId), Query.isNotNull('jobId'), Query.select(['jobId']), Query.limit(1000)]
    if (user.role !== 'admin') q.push(Query.equal('recruiterId', user.$id))
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.VIVIER_CVS, q)
    for (const d of res.documents) counts.set(d.jobId as string, (counts.get(d.jobId as string) ?? 0) + 1)
  } catch { /* les compteurs sont un plus : la liste s'affiche sans */ }

  const generalView = (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {openJobs.length > 0
          ? `Chaque CV est comparé par l’IA à vos ${openJobs.length} offre${openJobs.length > 1 ? 's' : ''} ouverte${openJobs.length > 1 ? 's' : ''} ; visible uniquement par vous.`
          : 'Aucune offre ouverte pour l’instant : les CV seront comparés à vos offres depuis « Sans offre correspondante » une fois publiées.'}
      </p>
      <VivierClient jobId={null} bucketId={BUCKETS.VIVIER_CVS} initialCvs={general.cvs} loadError={general.error}
        isAdmin={user.role === 'admin'} currentUserId={user.$id} openOffers={openJobs.map(j => ({ $id: j.$id, title: j.title }))} />
      {general.total > general.cvs.length && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Les {general.cvs.length} CV les plus récents sont affichés, sur {general.total}.</p>
      )}
    </div>
  )

  const offersView = (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Choisissez une offre pour importer des CV dans son propre vivier.</p>
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
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
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
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Importez vos CV sans choisir d&apos;offre, ou dans le vivier d&apos;une offre : chaque CV devient automatiquement un profil</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-4">
        <VivierTabs initialView={vue === 'general' ? 'general' : 'offres'} counts={{ general: general.total, offres: jobs.length }}
          general={generalView} offers={offersView} />
      </div>
    </div>
  )
}
