import 'server-only'
import type { Models } from 'node-appwrite'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { TRANSCRIPTION_DAILY_LIMITS, roomAccepts, roomCallCap, roomTranscriptionCap } from '@/lib/interview-room'
import { INTERVIEW_AI_DAILY_LIMITS } from '@/lib/interview-rules'
import { loadTenantAccess } from '@/lib/tenant-access'

// Contrôles de la salle d'entretien du candidat (règles : interview-room.ts). Hors du fichier « use server ».

/** Session d'entretien du lien si elle accepte l'action (`live` : pendant l'entretien ; `after` : aussi peu après) ; null sinon. */
export async function roomSession(sessionId: unknown, use: 'live' | 'after'): Promise<Models.Document | null> {
  if (typeof sessionId !== 'string' || !/^[\w-]{1,36}$/.test(sessionId)) return null
  try {
    const session = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    return roomAccepts({ status: session.status, completedAt: session.completedAt }, use, new Date()) ? session : null
  } catch (err) {
    if ((err as { code?: number } | null)?.code === 404) return null
    throw err
  }
}

/**
 * Une place sur le plafond du jour de la session (roomCallCap) ; pour un appel à l'IA, aussi sur le quota du jour de
 * l'organisation de l'entretien et sur celui de toutes (les mêmes que les entretiens côté recruteur). false si refusé :
 * l'entretien continue, sans relance ni réponse de l'IA.
 */
export async function takeRoomSlot(session: Models.Document, ai: boolean, now = new Date()): Promise<boolean> {
  if (!(await takeDailySlotId('interviewRoom', session.$id, now, roomCallCap(session.questions)))) return false
  if (!ai) return true
  const tenantId = typeof session.tenantId === 'string' ? session.tenantId : ''
  let own: string | null = null
  if (tenantId) {
    const limit = (await loadTenantAccess(tenantId)).entitlements.dailyQuotas.interviewAi
    own = await takeDailySlotId('interviewAiOrg', tenantId, now, limit)
    if (!own) return false
  }
  if (!(await takeDailySlotId('interviewAiAll', 'platform', now, INTERVIEW_AI_DAILY_LIMITS.allOrganisations))) {
    console.warn('[entretiens] plafond quotidien des appels à l\'IA atteint pour toutes les organisations')
    if (own) await releaseDailySlot(own)
    return false
  }
  return true
}

/**
 * Une transcription d'une réponse orale de l'entretien vocal (/v2, ADR 0035) : une place sur le plafond du jour de la
 * session propre aux transcriptions (roomTranscriptionCap), puis sur des quotas propres aux transcriptions, par
 * organisation et pour toutes (TRANSCRIPTION_DAILY_LIMITS) — pas sur le quota d'IA des recruteurs, qu'un candidat ne doit
 * pas pouvoir épuiser. Refusée si la formule de l'organisation ne comprend pas les entretiens IA.
 */
export async function takeTranscriptionSlot(session: Models.Document, now = new Date()): Promise<boolean> {
  if (!(await takeDailySlotId('interviewRoomStt', session.$id, now, roomTranscriptionCap(session.questions)))) return false
  const tenantId = typeof session.tenantId === 'string' ? session.tenantId : ''
  let own: string | null = null
  if (tenantId) {
    if (!(await loadTenantAccess(tenantId)).entitlements.features.aiInterviews) return false
    own = await takeDailySlotId('interviewSttOrg', tenantId, now, TRANSCRIPTION_DAILY_LIMITS.organisation)
    if (!own) return false
  }
  if (!(await takeDailySlotId('interviewSttAll', 'platform', now, TRANSCRIPTION_DAILY_LIMITS.allOrganisations))) {
    console.warn('[entretiens] plafond quotidien des transcriptions atteint pour toutes les organisations')
    if (own) await releaseDailySlot(own)
    return false
  }
  return true
}
