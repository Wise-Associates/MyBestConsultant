import { getAnalyticsConfig, fetchDashboardData } from './actions'
import { AnalyticsDashboard } from './analytics-dashboard'

export default async function AnalyticsPage() {
  const cfg = await getAnalyticsConfig()
  const isConfigured = !!(cfg.propertyId && cfg.serviceAccountJson)
  const initialResult = isConfigured ? await fetchDashboardData() : null

  return (
    <AnalyticsDashboard
      isConfigured={isConfigured}
      initialPropertyId={cfg.propertyId}
      initialResult={initialResult}
    />
  )
}
