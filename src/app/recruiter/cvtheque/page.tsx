import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { recruiterCvExportAccess } from '@/lib/cv-export/recruiter'
import { getOwnSavedSearch, isSavedSearchesConfigured, markSavedSearchOpened } from '@/lib/saved-searches-store'
import type { SavedSearch } from '@/lib/saved-searches'
import { getRecruiterCvthequeCandidates } from './actions'
import { CvthequeClient } from './cvtheque-client'

// Dépôt du modèle CV (Server Action de cette page) : cartographie par l'IA, deux réponses de 120 s au plus (ADR 0014).
export const maxDuration = 300

export default async function RecruiterCvthequePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'recruiter' && user.role !== 'admin') redirect('/login')

  // Recherche enregistrée ouverte depuis « Alertes » (?recherche=<id>, ADR 0045) : seulement celle du recruteur.
  const sp = await searchParams
  const searchId = typeof sp.recherche === 'string' ? sp.recherche : ''
  const savedSearches = user.role === 'recruiter' && isSavedSearchesConfigured()
  let openSearch: SavedSearch | null = null
  if (savedSearches && searchId) {
    try {
      openSearch = await getOwnSavedSearch(user.$id, searchId)
    } catch (err) {
      console.error('[recherches] recherche enregistrée illisible', err instanceof Error ? err.message : err)
    }
    if (openSearch) {
      const id = openSearch.id
      // Les correspondances arrivées ensuite seront « nouvelles » sur la page des alertes.
      after(() => markSavedSearchOpened(id, new Date()).catch(err => console.error('[recherches] ouverture non notée', err instanceof Error ? err.message : err)))
    }
  }

  const [{ candidates, error }, cvExport] = await Promise.all([getRecruiterCvthequeCandidates(), recruiterCvExportAccess(user)])

  return (
    <CvthequeClient initialCandidates={candidates} loadError={error} cvExport={cvExport.access} cvExportError={cvExport.error}
      savedSearches={savedSearches} openSearch={openSearch} />
  )
}
