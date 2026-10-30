import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppwriteException, Query } from 'node-appwrite'
import { ChevronRight, Route } from 'lucide-react'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { isJourneyStoreConfigured, journeyStoreProblem, listTenantJourneys, type StoredJourney } from '@/lib/appwrite/consultant-journeys'
import { JOURNEY_STAGES, isJourneyComplete, stageDef, stageIndex } from '@/lib/consultant-journey'

// Liste des parcours consultant de l'organisation (ADR 0021). Un parcours se démarre depuis la fiche d'un candidat.

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }

async function namesById(collection: string, ids: string[], label: (doc: Record<string, unknown>) => string) {
  const names = new Map<string, string>()
  const { databases } = createAdminClient()
  for (let i = 0; i < ids.length; i += 100) {
    const res = await databases.listDocuments(DB_ID, collection, [Query.equal('$id', ids.slice(i, i + 100)), Query.limit(100)])
    for (const doc of res.documents) names.set(doc.$id, label(doc as Record<string, unknown>))
  }
  return names
}

export default async function ConsultantJourneysPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const configured = isJourneyStoreConfigured()
  let journeys: StoredJourney[] = []
  let loadError: string | null = null
  let candidates = new Map<string, string>()
  let jobs = new Map<string, string>()
  if (configured) {
    try {
      journeys = await listTenantJourneys(user.tenantId)
      ;[candidates, jobs] = await Promise.all([
        namesById(COLLECTIONS.USERS, [...new Set(journeys.map(j => j.candidateId))],
          d => `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() || 'Candidat'),
        namesById(COLLECTIONS.JOBS, [...new Set(journeys.map(j => j.jobId))], d => (d.title as string) || 'Offre'),
      ])
    } catch (err) {
      console.error('Parcours consultant : lecture de la liste impossible', err instanceof Error ? err.message : err)
      // Type de l'erreur Appwrite affiché (jamais son message) : il suffit souvent à trouver la cause.
      const type = err instanceof AppwriteException && err.type ? ` (${err.type})` : ''
      loadError = journeyStoreProblem(err) ?? `Les parcours n’ont pas pu être chargés${type}. Rechargez la page dans un instant.`
    }
  }
  const total = JOURNEY_STAGES.length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(249,115,22,0.15)' }}>
              <Route className="h-6 w-6" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
            </div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Parcours consultant</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                De l’appel d’offres à la facture : où en est chaque consultant que vous placez
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {!configured ? (
          <p role="status" className="rounded-2xl p-5 text-sm" style={{ ...card, color: 'var(--color-text-muted)' }}>
            Le suivi des parcours n’est pas encore activé sur cet environnement (collection « consultant_journeys » à créer).
          </p>
        ) : loadError ? (
          <p role="alert" className="rounded-2xl p-5 text-sm" style={{ ...card, color: '#b91c1c' }}>
            {loadError}
          </p>
        ) : journeys.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={card}>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Aucun parcours pour l’instant</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Ouvrez la fiche d’un candidat depuis le pipeline d’une offre, puis « Parcours consultant ».
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl overflow-hidden divide-y" style={{ ...card, borderColor: 'var(--color-border)' }}>
            {journeys.map(j => {
              const stage = j.journey ? stageDef(j.journey.stage) : null
              const done = j.journey ? isJourneyComplete(j.journey) : false
              const position = j.journey ? stageIndex(j.journey.stage) + 1 : 0
              const state = !j.journey ? 'Illisible' : j.journey.status === 'abandoned' ? 'Abandonné' : done ? 'Terminé' : stage?.label
              return (
                <li key={j.applicationId}>
                  <Link href={`/recruiter/parcours/${j.applicationId}`}
                    className="flex items-center justify-between gap-3 px-5 py-4 no-underline transition-colors hover:bg-[rgba(11,29,81,0.025)]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{candidates.get(j.candidateId) ?? 'Candidat'}</p>
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{jobs.get(j.jobId) ?? 'Offre supprimée'}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{state}</p>
                        {j.journey && <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Étape {position}/{total}</p>}
                      </div>
                      <ChevronRight className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
