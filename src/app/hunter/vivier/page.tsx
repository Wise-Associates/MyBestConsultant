import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listHunterProfiles } from '@/lib/hunter'
import { HunterShell } from '../hunter-shell'
import { VivierClient } from './vivier-client'

export default async function HunterVivierPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'hunter') redirect('/login')
  const profiles = await listHunterProfiles(user.userId)
  return (
    <HunterShell title="Mon vivier" subtitle="Tous les CV et profils dont vous disposez, prêts à être proposés">
      <VivierClient initial={profiles} />
    </HunterShell>
  )
}
