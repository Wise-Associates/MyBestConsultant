import { listAllUsers } from './actions'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { UsersDashboard } from './users-dashboard'

export default async function AdminUsersPage() {
  const [{ users, error }, currentUser] = await Promise.all([
    listAllUsers(),
    getCurrentUser(),
  ])

  return (
    <UsersDashboard
      initialUsers={users}
      loadError={error}
      currentUserId={currentUser?.userId ?? ''}
    />
  )
}
