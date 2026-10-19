import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { ScoringWeightsConfig } from '@/app/admin/scoring/types'
import { DEFAULT_SCORING_WEIGHTS } from '@/app/admin/scoring/types'

// Read by recruiter screening (no admin session) — the admin screen goes through the
// protected getScoringWeights action in /admin/scoring.
export async function getScoringWeights(): Promise<ScoringWeightsConfig> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return DEFAULT_SCORING_WEIGHTS
    const doc = result.documents[0]
    if (!doc.customColors) return DEFAULT_SCORING_WEIGHTS
    const parsed = JSON.parse(doc.customColors as string)
    if (!parsed.__scoringWeights) return DEFAULT_SCORING_WEIGHTS
    return { ...DEFAULT_SCORING_WEIGHTS, ...JSON.parse(parsed.__scoringWeights) }
  } catch {
    return DEFAULT_SCORING_WEIGHTS
  }
}
