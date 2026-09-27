import { getGroupQueue } from './actions'
import { GroupsQueueClient } from './groups-queue-client'

export default async function LinkedInGroupsPage() {
  const items = await getGroupQueue()
  return <GroupsQueueClient initialItems={items} />
}
