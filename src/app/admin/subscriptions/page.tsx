import { getSubscribers } from './actions'
import { SubscriptionsDashboard } from './subscriptions-dashboard'

export default async function SubscriptionsPage() {
  const { subscribers, error } = await getSubscribers()
  return <SubscriptionsDashboard initialSubscribers={subscribers} loadError={error} />
}
