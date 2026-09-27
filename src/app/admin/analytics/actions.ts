'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import {
  getAnalyticsConfig as _getAnalyticsConfig,
  fetchDashboardData as _fetchDashboardData,
  fetchRealtimeData as _fetchRealtimeData,
  testAnalyticsConnection,
  type AnalyticsConfig, type DashboardData, type RealtimeData,
} from '@/lib/google-analytics'

export async function getAnalyticsConfig(): Promise<AnalyticsConfig> {
  return _getAnalyticsConfig()
}

export async function fetchDashboardData(): Promise<{ error: string } | { data: DashboardData }> {
  return _fetchDashboardData()
}

export async function fetchRealtimeData(): Promise<{ error: string } | { data: RealtimeData }> {
  return _fetchRealtimeData()
}

async function getOrCreateAnalyticsDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.ANALYTICS_CONFIG, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.ANALYTICS_CONFIG, ID.unique(), {
    propertyId: '', serviceAccountJson: '',
  })
}

export async function saveAnalyticsConfig(cfg: AnalyticsConfig): Promise<{ error?: string }> {
  try {
    // Validate the credentials actually work before saving — a bad JSON key
    // would otherwise silently break the dashboard.
    if (cfg.propertyId && cfg.serviceAccountJson) {
      const test = await testAnalyticsConnection(cfg.propertyId, cfg.serviceAccountJson)
      if (!test.ok) return { error: test.error || 'Connexion à Google Analytics impossible avec ces identifiants.' }
    }

    const { databases } = createAdminClient()
    const doc = await getOrCreateAnalyticsDoc()
    await databases.updateDocument(DB_ID, COLLECTIONS.ANALYTICS_CONFIG, doc.$id, {
      propertyId: cfg.propertyId,
      serviceAccountJson: cfg.serviceAccountJson,
    })

    revalidatePath('/admin/analytics')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}
