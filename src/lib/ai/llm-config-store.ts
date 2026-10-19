import 'server-only'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type { ProviderConfig } from '@/app/admin/llm-config/types'
import { DEFAULT_CONFIG } from '@/app/admin/llm-config/types'

// Full LLM config, API keys included — server-side use only, never return it from a public
// Server Action. The admin screen reads it through the protected getLLMConfig action.
export async function getLLMConfig(): Promise<ProviderConfig> {
  try {
    const { databases } = createAdminClient()
    const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
    if (result.documents.length === 0) return DEFAULT_CONFIG
    const doc = result.documents[0]
    if (!doc.customColors) return DEFAULT_CONFIG
    const parsed = JSON.parse(doc.customColors as string)
    if (!parsed.__llm) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(parsed.__llm) }
  } catch {
    return DEFAULT_CONFIG
  }
}
