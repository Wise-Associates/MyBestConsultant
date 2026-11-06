import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOpenJobsOfTenant } from '@/lib/appwrite/jobs'
import { countDailySlots } from '@/lib/ao/state'
import { isApolloConfigured } from '@/lib/mbc-search/apollo'
import { MBC_REVEAL_DAILY_LIMITS } from '@/lib/mbc-search/access'
import { isMbcHistoryConfigured, listMbcSearches } from '@/lib/mbc-search/history-store'
import { isMbcSavedStoreConfigured, listSavedPeople } from '@/lib/mbc-search/saved-store'
import { MbcSearchClient } from './mbc-search-client'

export const metadata = { title: 'MBC Search' }

export default async function MbcSearchPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  const tenantId = user.tenantId ?? ''

  // Jauge des profils complets du jour, offres pour « Associer à une offre », historique des recherches et personnes
  // enregistrées : facultatifs, la recherche marche sans.
  const [used, jobs, history, savedPeople] = await Promise.all([
    tenantId ? countDailySlots('mbcRevealOrg', tenantId, new Date()).catch(err => {
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
      configured={isApolloConfigured()}
      revealUsage={used === null ? null : { used, limit: MBC_REVEAL_DAILY_LIMITS.perOrganisation }}
      jobs={jobs?.map(j => ({ id: j.$id, title: j.title || 'Offre sans intitulé' })) ?? null}
      history={history}
      savedPeople={savedPeople}
    />
  )
}
