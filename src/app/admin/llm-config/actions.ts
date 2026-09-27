'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import type { ProviderConfig } from './types'
import { DEFAULT_CONFIG } from './types'
import { BUILTIN_MODEL_IDS, sanitizeOpenSourceModels, sanitizeRouting } from '@/lib/ai/models'
import { invalidateLLMConfigCache } from '@/lib/ai/llm-router'

// LLM config is stored inside TEMPLATES_CONFIG's customColors JSON under __llm key
// (avoids needing new Appwrite attributes — collection is at its 16-attr limit)

async function getOrCreateTemplatesDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, ID.unique(), {
    activeTemplate: 'modern_blue',
  })
}

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

// Keep AI_CONFIG for activeProvider (legacy) but store full config in TEMPLATES_CONFIG
async function getOrCreateAIDoc() {
  const { databases } = createAdminClient()
  const result = await databases.listDocuments(DB_ID, COLLECTIONS.AI_CONFIG, [Query.limit(1)])
  if (result.documents.length > 0) return result.documents[0]
  return databases.createDocument(DB_ID, COLLECTIONS.AI_CONFIG, ID.unique(), {
    activeProvider: DEFAULT_CONFIG.activeProvider,
  })
}

export async function saveLLMConfig(input: ProviderConfig): Promise<{ error?: string }> {
  try {
    const { databases } = createAdminClient()

    // Seuls les champs du sélecteur de modèles sont normalisés ici ; les clés API et réglages
    // existants passent tels quels (la config complète vient de l'écran, qui l'a chargée intacte).
    const openSourceModels = sanitizeOpenSourceModels(input.openSourceModels)
    const validIds = new Set<string>([...BUILTIN_MODEL_IDS, ...openSourceModels.filter(m => m.enabled).map(m => m.id)])
    const cfg: ProviderConfig = {
      ...input,
      openSourceModels,
      moduleRouting: sanitizeRouting(input.moduleRouting, validIds),
      // Le modèle par défaut ne peut pas pointer vers un modèle supprimé/désactivé.
      activeProvider: validIds.has(input.activeProvider) ? input.activeProvider : DEFAULT_CONFIG.activeProvider,
    }

    // Store full config in TEMPLATES_CONFIG customColors.__llm (no new attribute needed)
    const tmplDoc = await getOrCreateTemplatesDoc()
    const existing = tmplDoc.customColors ? JSON.parse(tmplDoc.customColors as string) : {}
    existing.__llm = JSON.stringify(cfg)
    await databases.updateDocument(DB_ID, COLLECTIONS.TEMPLATES_CONFIG, tmplDoc.$id, {
      customColors: JSON.stringify(existing),
    })

    // Also update activeProvider in AI_CONFIG for backwards compat
    try {
      const aiDoc = await getOrCreateAIDoc()
      await databases.updateDocument(DB_ID, COLLECTIONS.AI_CONFIG, aiDoc.$id, {
        activeProvider: cfg.activeProvider,
      })
    } catch { /* AI_CONFIG update is best-effort */ }

    // Bascule immédiate : le routeur relit la config au prochain appel IA, sans redéploiement.
    invalidateLLMConfigCache()
    revalidatePath('/admin/llm-config')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function testProvider(
  provider: string,
  overrides?: { model?: string; apiUrl?: string; apiKey?: string },
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    if (overrides?.model && (overrides.apiUrl || overrides.apiKey)) {
      const apiKey = (overrides.apiKey || '').trim()
      const model = overrides.model.trim()

      // Claude uses Anthropic SDK — NOT OpenAI-compatible endpoint
      if (provider === 'claude') {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey })
        const response = await client.messages.create({
          model,
          max_tokens: 20,
          messages: [{ role: 'user', content: 'Say hello' }],
        })
        const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
        return { ok: text.length > 0, latencyMs: Date.now() - start }
      }

      // OpenAI-compatible (teckia / gpt4o)
      const apiUrl = (overrides.apiUrl || 'https://api.openai.com/v1').trim()
      const res = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 20,
          think: false,
          messages: [{ role: 'user', content: 'Say hello' }],
        }),
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.text()
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}: ${body}` }
      }
      const data = await res.json()
      const msg = data.choices?.[0]?.message
      const content: string = msg?.content || msg?.reasoning || ''
      return { ok: content.length > 0, latencyMs: Date.now() - start }
    }

    // No overrides — use saved DB config
    const { callLLM } = await import('@/lib/ai/llm-router')
    const { content } = await callLLM(
      [{ role: 'user', content: 'Reply with exactly: OK' }],
      'You are a test assistant.',
      // strict : sans repli, pour que le test reflète VRAIMENT ce modèle et pas un modèle de secours
      { provider, strict: true },
    )
    return { ok: content.includes('OK'), latencyMs: Date.now() - start }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : 'Erreur' }
  }
}
