'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import type { ScoringWeightsConfig } from './types'
import { getScoringWeights as readScoringWeights } from '@/lib/scoring-weights'
import { requireAdmin } from '@/lib/appwrite/auth'

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
  await requireAdmin()
  return readScoringWeights()
}

export async function saveScoringWeights(cfg: ScoringWeightsConfig): Promise<{ error?: string }> {
  await requireAdmin()
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
