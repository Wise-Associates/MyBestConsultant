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

// Config IA gardée 60 s pour les appels répétés de l'entretien vocal (transcription et voix de chaque réponse, ADR 0052),
// qui relisaient la base à chaque fois. Une config par défaut (lecture en échec ou config absente) n'est pas gardée.
// Effacée à l'enregistrement de Config IA (saveLLMConfig, src/app/admin/llm-config/actions.ts).
const RECENT_CONFIG_MS = 60_000
let recent: { at: number; config: ProviderConfig } | null = null

export async function getRecentLLMConfig(): Promise<ProviderConfig> {
  if (recent && Date.now() - recent.at < RECENT_CONFIG_MS) return recent.config
  const config = await getLLMConfig()
  recent = config === DEFAULT_CONFIG ? null : { at: Date.now(), config }
  return config
}

export function forgetRecentLLMConfig(): void {
  recent = null
}

