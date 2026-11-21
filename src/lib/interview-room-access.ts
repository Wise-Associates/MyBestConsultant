import 'server-only'
import type { Models } from 'node-appwrite'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import type { DailyCounter } from '@/lib/ao/tenancy'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { takeAllSlots } from '@/lib/daily-slots'
import { SPEECH_DAILY_LIMITS, TRANSCRIPTION_DAILY_LIMITS, roomAccepts, roomCallCap, roomSpeechCap, roomTranscriptionCap } from '@/lib/interview-room'
import { INTERVIEW_AI_DAILY_LIMITS } from '@/lib/interview-rules'
import { loadTenantAccess, type TenantAccess } from '@/lib/tenant-access'
import { TtlCache } from '@/lib/ttl-cache'

// Contrôles de la salle d'entretien du candidat (règles : interview-room.ts). Hors du fichier « use server ».
// Pendant un entretien vocal, chaque relance, voix ou transcription relisait la session et la formule de l'organisation,
// puis prenait ses places de quota une à une : 7 à 9 allers-retours vers Appwrite avant le vrai travail (essai du
// 2026-11-20, ADR 0052). La session et la formule sont donc gardées en mémoire pour ces appels, et les places prises
// ensemble ; les plafonds ne changent pas.

const SESSION_CACHE_MS = 60_000
const ACCESS_CACHE_MS = 5 * 60_000
const sessions = new TtlCache<Models.Document>(SESSION_CACHE_MS)
const accesses = new TtlCache<Promise<TenantAccess>>(ACCESS_CACHE_MS)

const validId = (sessionId: unknown): sessionId is string => typeof sessionId === 'string' && /^[\w-]{1,36}$/.test(sessionId)

/** Session d'entretien du lien si elle accepte l'action (`live` : pendant l'entretien ; `after` : aussi peu après) ; null sinon. */
export async function roomSession(sessionId: unknown, use: 'live' | 'after'): Promise<Models.Document | null> {
  if (!validId(sessionId)) return null
  try {
    const session = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.INTERVIEWS, sessionId)
    sessions.set(sessionId, session, Date.now())
    return roomAccepts({ status: session.status, completedAt: session.completedAt }, use, new Date()) ? session : null
  } catch (err) {
    if ((err as { code?: number } | null)?.code === 404) return null
    throw err
  }
}

/**
 * roomSession pour les appels répétés d'un entretien en cours (relance, réponse de l'IA, voix, transcription) : la
 * session lue est gardée 60 s dans le processus. Son statut peut donc avoir jusqu'à 60 s de retard (un entretien terminé
 * depuis une autre instance reste accepté ce temps-là) : pour vérifier ou enregistrer la fin, roomSession.
 */
export async function liveRoomSession(sessionId: unknown, use: 'live' | 'after'): Promise<Models.Document | null> {
  if (!validId(sessionId)) return null
  const cached = sessions.get(sessionId, Date.now())
  if (!cached) return roomSession(sessionId, use)
  return roomAccepts({ status: cached.status, completedAt: cached.completedAt }, use, new Date()) ? cached : null
}

/** Session modifiée par cette instance (fin de l'entretien) : la prochaine lecture repart d'Appwrite. */
export function forgetRoomSession(sessionId: string): void {
  sessions.delete(sessionId)
}

/** Formule de l'organisation, gardée 5 min : un changement de formule s'applique aux entretiens en cours après ce délai. */
function accessOf(tenantId: string): Promise<TenantAccess> {
  const now = Date.now()
  const cached = accesses.get(tenantId, now)
  if (cached) return cached
  const loading = loadTenantAccess(tenantId)
  accesses.set(tenantId, loading, now)
  // Lecture en échec : pas gardée, la demande suivante relit.
  loading.catch(() => accesses.delete(tenantId))
  return loading
}

type SlotRequest = readonly [counter: DailyCounter, key: string, limit: number]

/** Une place par compteur, toutes ou aucune, prises en parallèle (un aller-retour au lieu d'un par compteur). */
async function takeSlots(requests: SlotRequest[], now: Date, what: string): Promise<boolean> {
  const { ok, refused } = await takeAllSlots(requests, ([counter, key, limit]) => takeDailySlotId(counter, key, now, limit), releaseDailySlot)
  if (refused.some(([, key]) => key === 'platform')) console.warn(`[entretiens] plafond quotidien ${what} atteint pour toutes les organisations`)
  return ok
}

const tenantOf = (session: Models.Document) => (typeof session.tenantId === 'string' ? session.tenantId : '')

/**
 * Une place sur le plafond du jour de la session (roomCallCap) ; pour un appel à l'IA, aussi sur le quota du jour de
 * l'organisation de l'entretien et sur celui de toutes (les mêmes que les entretiens côté recruteur). false si refusé :
 * l'entretien continue, sans relance ni réponse de l'IA.
 */
export async function takeRoomSlot(session: Models.Document, ai: boolean, now = new Date()): Promise<boolean> {
  const requests: SlotRequest[] = [['interviewRoom', session.$id, roomCallCap(session.questions)]]
  if (ai) {
    const tenantId = tenantOf(session)
    if (tenantId) requests.push(['interviewAiOrg', tenantId, (await accessOf(tenantId)).entitlements.dailyQuotas.interviewAi])
    requests.push(['interviewAiAll', 'platform', INTERVIEW_AI_DAILY_LIMITS.allOrganisations])
  }
  return takeSlots(requests, now, 'des appels à l\'IA')
}

/**
 * Une transcription d'une réponse orale de l'entretien vocal (/v2, ADR 0035) : une place sur le plafond du jour de la
 * session propre aux transcriptions (roomTranscriptionCap), et sur des quotas propres aux transcriptions, par
 * organisation et pour toutes (TRANSCRIPTION_DAILY_LIMITS) — pas sur le quota d'IA des recruteurs, qu'un candidat ne doit
 * pas pouvoir épuiser. Refusée si la formule de l'organisation ne comprend pas les entretiens IA.
 */
export async function takeTranscriptionSlot(session: Models.Document, now = new Date()): Promise<boolean> {
  const tenantId = tenantOf(session)
  if (tenantId && !(await accessOf(tenantId)).entitlements.features.aiInterviews) return false
  return takeSlots([
    ['interviewRoomStt', session.$id, roomTranscriptionCap(session.questions)],
    ...(tenantId ? [['interviewSttOrg', tenantId, TRANSCRIPTION_DAILY_LIMITS.organisation] as const] : []),
    ['interviewSttAll', 'platform', TRANSCRIPTION_DAILY_LIMITS.allOrganisations],
  ], now, 'des transcriptions')
}

/**
 * Une phrase lue à voix haute dans l'entretien vocal (/v2, ADR 0052) : une place sur le plafond du jour de la session
 * propre aux voix (roomSpeechCap), et sur les quotas des voix par organisation et pour toutes (SPEECH_DAILY_LIMITS).
 * Même construction que takeTranscriptionSlot : la voix est payante et la route qui la sert est publique. Refusée si la
 * formule de l'organisation ne comprend pas les entretiens IA.
 */
export async function takeSpeechSlot(session: Models.Document, now = new Date()): Promise<boolean> {
  const tenantId = tenantOf(session)
  if (tenantId && !(await accessOf(tenantId)).entitlements.features.aiInterviews) return false
  return takeSlots([
    ['interviewRoomTts', session.$id, roomSpeechCap(session.questions)],
    ...(tenantId ? [['interviewTtsOrg', tenantId, SPEECH_DAILY_LIMITS.organisation] as const] : []),
    ['interviewTtsAll', 'platform', SPEECH_DAILY_LIMITS.allOrganisations],
  ], now, 'des voix')
}
