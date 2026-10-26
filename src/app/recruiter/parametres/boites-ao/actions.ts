'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import type { PublicationDraft } from '@/lib/ao/dashboard-types'
import {
  addAoOfferCommentOf, aoOfferSourcingOf, deleteAoOfferCommentOf, deleteAoOfferOf, listAoOfferCommentsOf, previewAoPublicationOf,
  publishAoOfferOf, retryAoEmailOf, setAoOfferStatusOf, tenantSubscriptionStatus,
} from '@/lib/ao/offer-actions'
import { AO_RETRY_DAILY_LIMITS, RETRY_QUOTA_MESSAGE } from '@/lib/ao/attempts'
import { AO_PUBLICATION_AI_DAILY_LIMITS, PUBLICATION_AI_QUOTA_MESSAGE } from '@/lib/ao/publication-copy'
import { AO_SOURCING_DAILY_LIMITS, SOURCING_QUOTA_MESSAGE, sourcingDenial } from '@/lib/ao/sourcing-access'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { canUseAoSourcing } from '@/lib/ao/tenancy'
import type { UserProfile } from '@/types'

// Actions du tableau des appels d'offres d'une organisation (/recruiter/parametres/boites-ao). Chacune vérifie
// elle-même le recruteur (une Server Action est un point d'entrée public) et agit sur l'organisation de SA session,
// jamais sur un identifiant reçu du navigateur. Tous les recruteurs de l'organisation voient, commentent, publient,
// suppriment ses offres AO et y cherchent des candidats (ADR 0005 ; recherche par l'IA dans un quota quotidien).
// « Synchroniser maintenant » passe par la route /api/recruiter/ao/sync (AoSyncProvider), pas par une action.

const PATH = '/recruiter/parametres/boites-ao'
const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'
const NOT_ENTITLED = 'Abonnement inactif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation.'

async function recruiter(): Promise<{ user: UserProfile; tenantId: string } | null> {
  const user = await getCurrentUser()
  return user && user.role === 'recruiter' && user.tenantId ? { user, tenantId: user.tenantId } : null
}

/** L'IA qui lit les e-mails est à nos frais : seules les organisations abonnées font lire leurs boîtes (tenancy.ts). */
async function entitled(tenantId: string): Promise<boolean> {
  return canUseAoSourcing(tenantId, await tenantSubscriptionStatus(tenantId))
}

/**
 * Avant chaque recherche de candidats par l'IA : abonnement actif, adresse vérifiée, puis une place sur les quotas du
 * jour (organisation, puis toutes). Une recherche qui échoue compte quand même (l'IA a pu être facturée), comme les
 * messages de l'assistant.
 */
async function sourcingSlot(user: UserProfile, tenantId: string): Promise<string | null> {
  const denial = sourcingDenial({ tenantId, subscriptionStatus: await tenantSubscriptionStatus(tenantId), emailVerified: user.emailVerification })
  if (denial) return denial
  const now = new Date()
  const own = await takeDailySlotId('aoSourcingOrg', tenantId, now, AO_SOURCING_DAILY_LIMITS.perOrganisation)
  if (!own) return SOURCING_QUOTA_MESSAGE.organisation
  if (!(await takeDailySlotId('aoSourcingAll', 'platform', now, AO_SOURCING_DAILY_LIMITS.allOrganisations))) {
    console.warn('AO: plafond quotidien des recherches de candidats atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return SOURCING_QUOTA_MESSAGE.platform
  }
  return null
}

/** « Trouver des candidats » / « Recalculer » (recompute) et lecture du dernier résultat, qui ne coûte rien. */
export async function recruiterAoOfferSourcing(id: string, recompute = false) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return aoOfferSourcingOf(me.tenantId, id, { recompute, beforeAi: () => sourcingSlot(me.user, me.tenantId) })
}

/**
 * Avant chaque « Réessayer » (qui remet les essais de l'e-mail à zéro et peut refaire appeler l'IA) : adresse vérifiée,
 * puis une place sur les quotas du jour (organisation, puis toutes). Une relance dont le traitement échoue compte quand
 * même (l'IA a pu être facturée).
 */
async function retrySlot(user: UserProfile, tenantId: string): Promise<string | null> {
  if (!user.emailVerification) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour relancer un e-mail.'
  const now = new Date()
  const own = await takeDailySlotId('aoRetryOrg', tenantId, now, AO_RETRY_DAILY_LIMITS.perOrganisation)
  if (!own) return RETRY_QUOTA_MESSAGE.organisation
  if (!(await takeDailySlotId('aoRetryAll', 'platform', now, AO_RETRY_DAILY_LIMITS.allOrganisations))) {
    console.warn('AO: plafond quotidien des relances d\'e-mails atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return RETRY_QUOTA_MESSAGE.platform
  }
  return null
}

export async function retryRecruiterAoEmail(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!(await entitled(me.tenantId))) return { error: NOT_ENTITLED }
  return retryAoEmailOf(me.tenantId, id, { holder: 'recruiter', path: PATH, beforeRetry: () => retrySlot(me.user, me.tenantId) })
}

/**
 * Avant chaque rédaction par l'IA de la version publiée : abonnement actif, adresse vérifiée, puis une place sur les
 * quotas du jour (organisation, puis toutes). Un refus n'empêche pas de publier : la version des règles automatiques
 * est proposée à la place, avec ce message.
 */
async function rewriteSlot(user: UserProfile, tenantId: string): Promise<string | null> {
  if (!(await entitled(tenantId))) return 'rédaction par l\'IA réservée aux organisations dont l\'abonnement est actif'
  if (!user.emailVerification) return 'vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour faire rédiger cette version par l\'IA'
  const now = new Date()
  const own = await takeDailySlotId('aoRewriteOrg', tenantId, now, AO_PUBLICATION_AI_DAILY_LIMITS.perOrganisation)
  if (!own) return PUBLICATION_AI_QUOTA_MESSAGE.organisation
  if (!(await takeDailySlotId('aoRewriteAll', 'platform', now, AO_PUBLICATION_AI_DAILY_LIMITS.allOrganisations))) {
    console.warn('AO: plafond quotidien des rédactions de publications par l\'IA atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return PUBLICATION_AI_QUOTA_MESSAGE.platform
  }
  return null
}

export async function previewRecruiterAoPublication(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return previewAoPublicationOf(me.tenantId, id, { beforeAi: () => rewriteSlot(me.user, me.tenantId) })
}

/** Offre publique de l'organisation, diffusée et sourcée comme une offre créée par ses recruteurs (publishAoOfferOf). */
export async function publishRecruiterAoOffer(id: string, input: PublicationDraft) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return publishAoOfferOf(me.tenantId, id, input, me.tenantId, [PATH, '/recruiter/annonces', '/recruiter/dashboard'])
}

export async function setRecruiterAoOfferStatus(id: string, status: 'to_review' | 'ignored') {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return setAoOfferStatusOf(me.tenantId, id, status, PATH)
}

export async function listRecruiterAoOfferComments(offerId: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return listAoOfferCommentsOf(me.tenantId, me.user.userId, offerId)
}

export async function addRecruiterAoOfferComment(offerId: string, body: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return addAoOfferCommentOf(me.tenantId, me.user, offerId, body)
}

export async function deleteRecruiterAoOfferComment(commentId: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return deleteAoOfferCommentOf(me.tenantId, me.user.userId, commentId)
}

export async function deleteRecruiterAoOffer(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return deleteAoOfferOf(me.tenantId, id)
}
