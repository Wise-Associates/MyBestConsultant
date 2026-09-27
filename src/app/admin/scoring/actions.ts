'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import type { ScoringWeightsConfig } from './types'
import { DEFAULT_SCORING_WEIGHTS } from './types'

// Same JSON-envelope trick as /admin/llm-config: stored inside TEMPLATES_CONFIG's
// customColors under __scoringWeights (that collection is at its 16-attribute limit).

async function getOrCreateTemplatesDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, ID.unique(), {
    activeTemplate: 'modern_blue',
  })
}

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

export async function saveScoringWeights(cfg: ScoringWeightsConfig): Promise<{ error?: string }> {
  try {
    const clamped = { recommendationWeight: Math.min(1, Math.max(0, cfg.recommendationWeight)) }
    const { databases } = createAdminClient()
    const tmplDoc = await getOrCreateTemplatesDoc()
    const existing = tmplDoc.customColors ? JSON.parse(tmplDoc.customColors as string) : {}
    existing.__scoringWeights = JSON.stringify(clamped)
    await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, tmplDoc.$id, {
      customColors: JSON.stringify(existing),
    })
    revalidatePath('/admin/scoring')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
