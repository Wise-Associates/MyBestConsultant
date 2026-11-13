import { getSubscribers } from './actions'
import { SubscriptionsDashboard } from './subscriptions-dashboard'

export default async function SubscriptionsPage() {
  const { subscribers, offersEnabled, error } = await getSubscribers()
  return <SubscriptionsDashboard initialSubscribers={subscribers} offersEnabled={offersEnabled} loadError={error} />
}
