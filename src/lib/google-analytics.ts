import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'

// GA4 credentials live in their own ANALYTICS_CONFIG collection — not TEMPLATES_CONFIG,
// which is already near MariaDB's ~65KB row-size ceiling (utf8mb4 reserves 4 bytes per
// declared character), and a service account key alone (~2500 chars) wouldn't fit.

export interface AnalyticsConfig {
  propertyId: string
  serviceAccountJson: string
}

export async function getAnalyticsConfig(): Promise<AnalyticsConfig> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.ANALYTICS_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return { propertyId: '', serviceAccountJson: '' }
    const doc = result.documents[0]
    return {
      propertyId: (doc.propertyId as string) || '',
      serviceAccountJson: (doc.serviceAccountJson as string) || '',
    }
  } catch {
    return { propertyId: '', serviceAccountJson: '' }
  }
}

function buildClient(serviceAccountJson: string): BetaAnalyticsDataClient {
  const creds = JSON.parse(serviceAccountJson)
  return new BetaAnalyticsDataClient({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    projectId: creds.project_id,
  })
}

export interface RealtimeData {
  activeUsers: number
  byPage: { page: string; users: number }[]
  byCountry: { country: string; users: number }[]
}

export interface OverviewStats {
  activeUsers: number
  sessions: number
  pageViews: number
  avgSessionDurationSec: number
  bounceRate: number
}

export interface DashboardData {
  realtime: RealtimeData
  today: OverviewStats
  last7Days: OverviewStats
  topPages: { page: string; views: number }[]
  trafficSources: { source: string; sessions: number }[]
  devices: { device: string; users: number }[]
  dailyTrend: { date: string; users: number; sessions: number }[]
}

function num(v: string | null | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function fetchDashboardData(): Promise<{ error: string } | { data: DashboardData }> {
  const cfg = await getAnalyticsConfig()
  if (!cfg.propertyId || !cfg.serviceAccountJson) {
    return { error: 'not_configured' }
  }

  try {
    const client = buildClient(cfg.serviceAccountJson)
    const property = `properties/${cfg.propertyId}`

    const [
      realtimeUsers,
      realtimeByPage,
      realtimeByCountry,
      todayReport,
      last7Report,
      topPagesReport,
      trafficSourcesReport,
      devicesReport,
      dailyTrendReport,
    ] = await Promise.all([
      client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] }),
      client.runRealtimeReport({
        property,
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 8,
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      client.runRealtimeReport({
        property,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 6,
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: 'today', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' },
          { name: 'averageSessionDuration' }, { name: 'bounceRate' },
        ],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' },
          { name: 'averageSessionDuration' }, { name: 'bounceRate' },
        ],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        limit: 8,
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        limit: 6,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      client.runReport({
        property,
        dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
    ])

    const toOverview = (r: typeof todayReport[0]): OverviewStats => {
      const row = r.rows?.[0]
      return {
        activeUsers: num(row?.metricValues?.[0]?.value),
        sessions: num(row?.metricValues?.[1]?.value),
        pageViews: num(row?.metricValues?.[2]?.value),
        avgSessionDurationSec: num(row?.metricValues?.[3]?.value),
        bounceRate: num(row?.metricValues?.[4]?.value),
      }
    }

    const data: DashboardData = {
      realtime: {
        activeUsers: num(realtimeUsers[0].rows?.[0]?.metricValues?.[0]?.value),
        byPage: (realtimeByPage[0].rows ?? []).map(r => ({
          page: r.dimensionValues?.[0]?.value || '(inconnue)',
          users: num(r.metricValues?.[0]?.value),
        })),
        byCountry: (realtimeByCountry[0].rows ?? []).map(r => ({
          country: r.dimensionValues?.[0]?.value || '(inconnu)',
          users: num(r.metricValues?.[0]?.value),
        })),
      },
      today: toOverview(todayReport[0]),
      last7Days: toOverview(last7Report[0]),
      topPages: (topPagesReport[0].rows ?? []).map(r => ({
        page: r.dimensionValues?.[0]?.value || '/',
        views: num(r.metricValues?.[0]?.value),
      })),
      trafficSources: (trafficSourcesReport[0].rows ?? []).map(r => ({
        source: r.dimensionValues?.[0]?.value || 'Autre',
        sessions: num(r.metricValues?.[0]?.value),
      })),
      devices: (devicesReport[0].rows ?? []).map(r => ({
        device: r.dimensionValues?.[0]?.value || 'Autre',
        users: num(r.metricValues?.[0]?.value),
      })),
      dailyTrend: (dailyTrendReport[0].rows ?? []).map(r => ({
        date: r.dimensionValues?.[0]?.value || '',
        users: num(r.metricValues?.[0]?.value),
        sessions: num(r.metricValues?.[1]?.value),
      })),
    }

    return { data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur de connexion à Google Analytics' }
  }
}

export async function fetchRealtimeData(): Promise<{ error: string } | { data: RealtimeData }> {
  const cfg = await getAnalyticsConfig()
  if (!cfg.propertyId || !cfg.serviceAccountJson) return { error: 'not_configured' }

  try {
    const client = buildClient(cfg.serviceAccountJson)
    const property = `properties/${cfg.propertyId}`

    const [realtimeUsers, realtimeByPage, realtimeByCountry] = await Promise.all([
      client.runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] }),
      client.runRealtimeReport({
        property,
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 8,
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
      client.runRealtimeReport({
        property,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 6,
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      }),
    ])

    return {
      data: {
        activeUsers: num(realtimeUsers[0].rows?.[0]?.metricValues?.[0]?.value),
        byPage: (realtimeByPage[0].rows ?? []).map(r => ({
          page: r.dimensionValues?.[0]?.value || '(inconnue)',
          users: num(r.metricValues?.[0]?.value),
        })),
        byCountry: (realtimeByCountry[0].rows ?? []).map(r => ({
          country: r.dimensionValues?.[0]?.value || '(inconnu)',
          users: num(r.metricValues?.[0]?.value),
        })),
      },
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur de connexion à Google Analytics' }
  }
}

export async function testAnalyticsConnection(propertyId: string, serviceAccountJson: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = buildClient(serviceAccountJson)
    await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: 'today', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Connexion impossible' }
  }
}
