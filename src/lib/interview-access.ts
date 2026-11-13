import 'server-only'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { INTERVIEW_AI_DAILY_LIMITS, INTERVIEW_AI_REFUSAL, INTERVIEW_INVITE_DAILY_LIMIT } from '@/lib/interview-rules'
import { featureDenial, type Entitlements } from '@/lib/plans'
import { loadTenantAccess } from '@/lib/tenant-access'
import type { UserProfile } from '@/types'

// Entretiens IA et screening des CV : fonction que la formule de l'organisation ouvre ou non (plans.ts, ADR 0034), et
// quota du jour de leurs appels à l'IA (interview-rules.ts). Hors des fichiers « use server » : tout export d'un tel
// fichier devient un point d'entrée public.

/** Refus pour une organisation dont la formule ne comprend pas les entretiens IA ni le screening ; null sinon. */
export async function aiInterviewDenial(tenantId: string): Promise<string | null> {
  return featureDenial((await loadTenantAccess(tenantId)).entitlements, 'aiInterviews')
}

export interface AiInterviewRecruiter { user: UserProfile; tenantId: string; entitlements: Entitlements }

/** Recruteur de la session dont la formule comprend les entretiens IA et le screening des CV ; sinon le message du refus. */
export async function aiInterviewRecruiter(): Promise<AiInterviewRecruiter | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }
  const { entitlements } = await loadTenantAccess(user.tenantId)
  const denial = featureDenial(entitlements, 'aiInterviews')
  return denial ? { error: denial } : { user, tenantId: user.tenantId, entitlements }
}

/**
 * Avant chaque appel à l'IA d'un entretien ou du screening manuel : adresse e-mail vérifiée, puis une place sur les
 * quotas du jour (celui de la formule de l'organisation, puis celui de toutes). Message du refus, ou null. Un appel qui
 * échoue ensuite compte quand même (l'IA a pu être facturée).
 */
export async function takeInterviewAiSlot(me: AiInterviewRecruiter, now = new Date()): Promise<string | null> {
  if (!me.user.emailVerification) return INTERVIEW_AI_REFUSAL.unverified
  const limit = me.entitlements.dailyQuotas.interviewAi
  const own = await takeDailySlotId('interviewAiOrg', me.tenantId, now, limit)
  if (!own) return INTERVIEW_AI_REFUSAL.organisation(limit)
  if (!(await takeDailySlotId('interviewAiAll', 'platform', now, INTERVIEW_AI_DAILY_LIMITS.allOrganisations))) {
    console.warn('[entretiens] plafond quotidien des appels à l\'IA atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return INTERVIEW_AI_REFUSAL.platform
  }
  return null
}

/**
 * Avant chaque invitation à un entretien (e-mail du domaine de la plateforme) : adresse e-mail du recruteur vérifiée et
 * une place sur le quota du jour de l'organisation. Message du refus, ou null.
 */
export async function takeInterviewInviteSlot(user: UserProfile, tenantId: string, now = new Date()): Promise<string | null> {
  if (!user.emailVerification) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour inviter un candidat.'
  return (await takeDailySlotId('interviewInviteOrg', tenantId, now, INTERVIEW_INVITE_DAILY_LIMIT))
    ? null
    : `Limite de ${INTERVIEW_INVITE_DAILY_LIMIT} invitations à un entretien par jour atteinte pour votre organisation : réessayez demain.`
}
