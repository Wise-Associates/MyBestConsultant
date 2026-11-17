import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOpenJobsOfTenant } from '@/lib/appwrite/jobs'
import { countDailySlots } from '@/lib/ao/state'
import { isApolloConfigured } from '@/lib/mbc-search/apollo'
import { isMbcHistoryConfigured, listMbcSearches } from '@/lib/mbc-search/history-store'
import { isMbcSavedStoreConfigured, listSavedPeople } from '@/lib/mbc-search/saved-store'
import { loadTenantAccess } from '@/lib/tenant-access'
import { MbcSearchClient } from './mbc-search-client'

export const metadata = { title: 'MBC Search' }
// Actions de la page : une évaluation par l'IA peut durer deux minutes, plus la comparaison des intitulés (ADR 0038).
export const maxDuration = 300

export default async function MbcSearchPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  const tenantId = user.tenantId ?? ''

  // Jauge des profils complets du jour, offres pour « Associer à une offre », historique des recherches et personnes
  // enregistrées : facultatifs, la recherche marche sans.
  const [usage, jobs, history, savedPeople] = await Promise.all([
    // Limite du jour : celle de la formule de l'organisation (plans.ts), qui dit aussi si le téléphone est compris.
    tenantId ? Promise.all([countDailySlots('mbcRevealOrg', tenantId, new Date()), loadTenantAccess(tenantId)])
      .then(([used, access]) => ({
        revealUsage: { used, limit: access.entitlements.dailyQuotas.mbcReveal }, phoneIncluded: access.entitlements.features.mbcPhone,
      }))
      .catch(err => {
        console.error('[mbc-search] jauge des profils complets illisible', err instanceof Error ? err.message : String(err))
        return null
      }) : null,
    tenantId ? getOpenJobsOfTenant(tenantId).catch(err => {
      console.error('[mbc-search] offres ouvertes illisibles', err instanceof Error ? err.message : String(err))
      return null
    }) : null,
    isMbcHistoryConfigured() ? listMbcSearches(user.userId).catch(err => {
      console.error('[mbc-search] historique des recherches illisible', err instanceof Error ? err.message : String(err))
      return null
    }) : null,
    isMbcSavedStoreConfigured() ? listSavedPeople(user.userId).catch(err => {
      console.error('[mbc-search] personnes enregistrées illisibles', err instanceof Error ? err.message : String(err))
      return null
    }) : null,
  ])

  return (
    <MbcSearchClient
      firstName={user.firstName ?? ''}
      configured={isApolloConfigured()}
      revealUsage={usage?.revealUsage ?? null}
      // Illisible : bouton affiché, le serveur vérifie la formule à la demande.
      phoneIncluded={usage?.phoneIncluded ?? true}
      jobs={jobs?.map(j => ({ id: j.$id, title: j.title || 'Offre sans intitulé' })) ?? null}
      history={history}
      savedPeople={savedPeople}
    />
  )
}
