import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { getOpenJobsOfTenant } from '@/lib/appwrite/jobs'
import { countDailySlots } from '@/lib/ao/state'
import { isApolloConfigured } from '@/lib/mbc-search/apollo'
import { MBC_REVEAL_DAILY_LIMITS } from '@/lib/mbc-search/access'
import { MbcSearchClient } from './mbc-search-client'

export const metadata = { title: 'MBC Search' }

export default async function MbcSearchPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  const tenantId = user.tenantId ?? ''

  // Jauge des profils complets du jour et offres pour « Associer à une offre » : facultatives, la recherche marche sans.
  const [used, jobs] = await Promise.all([
    tenantId ? countDailySlots('mbcRevealOrg', tenantId, new Date()).catch(err => {
      console.error('[mbc-search] jauge des profils complets illisible', err instanceof Error ? err.message : String(err))
      return null
    }) : null,
    tenantId ? getOpenJobsOfTenant(tenantId).catch(err => {
      console.error('[mbc-search] offres ouvertes illisibles', err instanceof Error ? err.message : String(err))
      return null
    }) : null,
  ])

  return (
    <MbcSearchClient
      configured={isApolloConfigured()}
      revealUsage={used === null ? null : { used, limit: MBC_REVEAL_DAILY_LIMITS.perOrganisation }}
      jobs={jobs?.map(j => ({ id: j.$id, title: j.title || 'Offre sans intitulé' })) ?? null}
    />
  )
}
