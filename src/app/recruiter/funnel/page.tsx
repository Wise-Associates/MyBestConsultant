import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { loadFunnelData } from './data'
import { FunnelClient, type FunnelTab } from './funnel-client'

export const metadata = { title: 'Processus de recrutement — MyBestConsultant' }

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ tab?: string; pipeline?: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const [data, sp] = await Promise.all([loadFunnelData(user.tenantId), searchParams])
  const tab: FunnelTab = sp.tab === 'phases' || sp.tab === 'statuts' ? sp.tab : 'pipelines'
  const pipeline = sp.pipeline && data.pipelines.some(p => p.id === sp.pipeline) ? sp.pipeline : 'default'

  return <FunnelClient initial={data} initialTab={tab} initialPipeline={pipeline} />
}
