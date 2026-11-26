import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { isAssistantStorageConfigured, purgeExpiredAssistantTurns, purgeOldAssistantQuotaSlots } from '@/lib/assistant/host'
import { isLlmUsageConfigured, purgeExpiredLlmUsage } from '@/lib/ai/usage-store'

// Purges quotidiennes. Conversations avec l'assistant IA : ASSISTANT_RETENTION_DAYS (ADR 0007), et places de quota de plus
// de 7 jours. Journal de consommation de l'IA : LLM_USAGE_RETENTION_DAYS (ADR 0064), même sans nouvel appel d'IA (la
// purge au fil des écritures ne suffit pas toujours). Appelée chaque jour (deploy/crontab, Vercel Cron) ; un passage
// interrompu reprend au suivant. Chaque purge est faite même si l'autre échoue.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const result: Record<string, number | boolean> = {}
  let failed = false

  if (!isAssistantStorageConfigured()) {
    // Normal tant que l'assistant n'a jamais été installé ; sinon, conversations conservées au-delà de la durée prévue.
    console.warn('[assistant] purge ignorée : APPWRITE_COLLECTION_ASSISTANT_TURNS non définie')
    result.purged = 0
    result.configured = false
  } else {
    try {
      result.purged = await purgeExpiredAssistantTurns(now)
      result.quotaSlots = await purgeOldAssistantQuotaSlots(now, Date.now() + 40_000)
    } catch (err) {
      failed = true
      console.error('[assistant] purge en échec', err instanceof Error ? err.message : String(err))
    }
  }

  if (await isLlmUsageConfigured()) {
    try {
      result.llmUsage = await purgeExpiredLlmUsage(now, Date.now() + 120_000)
    } catch (err) {
      failed = true
      console.error('[llm-usage] purge quotidienne en échec', err instanceof Error ? err.message : String(err))
    }
  }

  return failed ? NextResponse.json({ ...result, error: 'Purge en échec' }, { status: 500 }) : NextResponse.json(result)
}
