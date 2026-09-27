import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listTeam } from '@/lib/team'
import { getTeamActivity } from './data'
import { TeamClient } from './team-client'

export default async function TeamPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const [members, activity] = await Promise.all([listTeam(user.tenantId), getTeamActivity(user.tenantId)])
  const me = members.find(m => m.userId === user.userId)

  return <TeamClient members={members} activity={activity} currentUserId={user.userId} isOwner={!!me?.isOwner} now={new Date().toISOString()} />
}
