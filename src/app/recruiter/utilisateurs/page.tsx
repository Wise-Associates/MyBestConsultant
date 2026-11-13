import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { MAX_TEAM_SIZE, loadTeam } from '@/lib/team'
import { adminUserIdsOf, roleOf } from '@/lib/team-roles'
import { UsersClient } from './users-client'

export const metadata = { title: 'Utilisateurs' }

// Utilisateurs de l'organisation du recruteur (ADR 0033) : tout le monde voit la liste, le propriétaire et les
// administrateurs la gèrent (actions.ts revérifie chaque action).
export default async function UsersPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) redirect('/login')

  const { members, tenant } = await loadTeam(user.tenantId)
  return (
    <UsersClient members={members} currentUserId={user.userId} myRole={roleOf(user.userId, tenant)}
      rolesAvailable={adminUserIdsOf(tenant) !== null} maxTeamSize={MAX_TEAM_SIZE} now={new Date().toISOString()} />
  )
}
