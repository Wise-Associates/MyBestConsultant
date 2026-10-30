import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { isApolloConfigured } from '@/lib/mbc-search/apollo'
import { MbcSearchClient } from './mbc-search-client'

export const metadata = { title: 'MBC Search' }

export default async function MbcSearchPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') redirect('/login')
  return <MbcSearchClient configured={isApolloConfigured()} />
}
