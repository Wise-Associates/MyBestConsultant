import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { listTeam } from '@/lib/team'
import { getTeamActivity } from './data'
import { TeamClient } from './team-client'

export default async function TeamPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const [members, activity] = await Promise.all([listTeam(user.tenantId), getTeamActivity(user.tenantId)])

  return <TeamClient members={members} activity={activity} currentUserId={user.userId} now={new Date().toISOString()} />
}
