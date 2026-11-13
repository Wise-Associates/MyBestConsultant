'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import type { PublicationDraft, PublicationMode } from '@/lib/ao/dashboard-types'
import {
  addAoOfferCommentOf, aoOfferSourcingOf, assignAoOfferOf, deleteAoOfferCommentOf, deleteAoOfferOf, deleteAoOffersOf, listAoOfferCommentsOf, previewAoPublicationOf,
  publishAoOfferOf, retryAoEmailOf, setAoOfferStatusOf, stopAoPublicationTasksOf,
} from '@/lib/ao/offer-actions'
import { AO_RETRY_DAILY_LIMITS, RETRY_QUOTA_MESSAGE } from '@/lib/ao/attempts'
import { AO_PUBLICATION_AI_DAILY_LIMITS, PUBLICATION_AI_QUOTA_MESSAGE } from '@/lib/ao/publication-copy'
import { AO_SOURCING_DAILY_LIMITS, SOURCING_QUOTA_MESSAGE, sourcingDenial } from '@/lib/ao/sourcing-access'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { aoRefusal } from '@/lib/ao/tenancy'
import { featureDenial } from '@/lib/plans'
import { activeJobsLimitDenial, loadTenantAccess, type TenantAccess } from '@/lib/tenant-access'
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

/**
 * L'IA qui lit les e-mails est à nos frais : seules les organisations abonnées dont la formule comprend le suivi des
 * appels d'offres font lire leurs boîtes (tenancy.ts). Message du refus ; null si le suivi est ouvert.
 */
function aoDenial(tenantId: string, access: TenantAccess): string | null {
  const refusal = aoRefusal(tenantId, access.subscriptionStatus, access.entitlements)
  if (refusal === 'inactive') return NOT_ENTITLED
  return refusal === 'not_included' ? featureDenial(access.entitlements, 'aoSourcing') : null
}

/**
 * Avant chaque recherche de candidats par l'IA : formule qui comprend le suivi des appels d'offres, abonnement actif,
 * adresse vérifiée, puis une place sur les quotas du jour (celui de la formule de l'organisation, puis celui de
 * toutes). Une recherche qui échoue compte quand même (l'IA a pu être facturée), comme les messages de l'assistant.
 */
async function sourcingSlot(user: UserProfile, tenantId: string): Promise<string | null> {
  const access = await loadTenantAccess(tenantId)
  const denial = featureDenial(access.entitlements, 'aoSourcing')
    ?? sourcingDenial({ tenantId, subscriptionStatus: access.subscriptionStatus, emailVerified: user.emailVerification })
  if (denial) return denial
  const now = new Date()
  const limit = access.entitlements.dailyQuotas.aoSourcing
  const own = await takeDailySlotId('aoSourcingOrg', tenantId, now, limit)
  if (!own) return SOURCING_QUOTA_MESSAGE.organisation(limit)
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
  return aoOfferSourcingOf(me.tenantId, id, { recompute, beforeAi: () => sourcingSlot(me.user, me.tenantId), vivierOwner: me.user.$id })
}

/**
 * Avant chaque « Réessayer » (qui remet les essais de l'e-mail à zéro et peut refaire appeler l'IA) : adresse vérifiée,
 * puis une place sur les quotas du jour (organisation, puis toutes). Une relance dont le traitement échoue compte quand
 * même (l'IA a pu être facturée).
 */
async function retrySlot(user: UserProfile, tenantId: string, limit: number): Promise<string | null> {
  if (!user.emailVerification) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour relancer un e-mail.'
  const now = new Date()
  const own = await takeDailySlotId('aoRetryOrg', tenantId, now, limit)
  if (!own) return RETRY_QUOTA_MESSAGE.organisation(limit)
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
  const access = await loadTenantAccess(me.tenantId)
  const denial = aoDenial(me.tenantId, access)
  if (denial) return { error: denial }
  const limit = access.entitlements.dailyQuotas.aoRetry
  return retryAoEmailOf(me.tenantId, id, { holder: 'recruiter', path: PATH, beforeRetry: () => retrySlot(me.user, me.tenantId, limit) })
}

/**
 * Avant chaque rédaction par l'IA de la version publiée : abonnement actif, adresse vérifiée, puis une place sur les
 * quotas du jour (organisation, puis toutes). Un refus n'empêche pas de publier : la version des règles automatiques
 * est proposée à la place, avec ce message.
 */
async function rewriteSlot(user: UserProfile, tenantId: string): Promise<string | null> {
  const access = await loadTenantAccess(tenantId)
  const refusal = aoRefusal(tenantId, access.subscriptionStatus, access.entitlements)
  // Phrases insérées dans « L'IA n'a pas rédigé cette version (…) » du panneau.
  if (refusal === 'inactive') return 'rédaction par l\'IA réservée aux organisations dont l\'abonnement est actif'
  if (refusal === 'not_included') return 'suivi des appels d\'offres non compris dans la formule de votre organisation'
  if (!user.emailVerification) return 'vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour faire rédiger cette version par l\'IA'
  const now = new Date()
  const limit = access.entitlements.dailyQuotas.aoRewrite
  const own = await takeDailySlotId('aoRewriteOrg', tenantId, now, limit)
  if (!own) return PUBLICATION_AI_QUOTA_MESSAGE.organisation(limit)
  if (!(await takeDailySlotId('aoRewriteAll', 'platform', now, AO_PUBLICATION_AI_DAILY_LIMITS.allOrganisations))) {
    console.warn('AO: plafond quotidien des rédactions de publications par l\'IA atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
    await releaseDailySlot(own)
    return PUBLICATION_AI_QUOTA_MESSAGE.platform
  }
  return null
}

export async function previewRecruiterAoPublication(id: string, mode?: PublicationMode) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  // Valeur venue du navigateur : tout ce qui n'est pas « raw » donne la version anonymisée. La version non anonymisée
  // n'appelle pas l'IA : aucune place de quota prise.
  return previewAoPublicationOf(me.tenantId, id, {
    mode: mode === 'raw' ? 'raw' : 'anonymized',
    beforeAi: () => rewriteSlot(me.user, me.tenantId),
  })
}

/**
 * Offre publique de l'organisation, diffusée et sourcée comme une offre créée par ses recruteurs (publishAoOfferOf),
 * dans la limite d'offres actives de sa formule.
 */
export async function publishRecruiterAoOffer(id: string, input: PublicationDraft) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  const limited = await activeJobsLimitDenial(me.tenantId)
  if (limited) return { error: limited }
  return publishAoOfferOf(me.tenantId, id, input, me.tenantId, [PATH, '/recruiter/annonces', '/recruiter/dashboard'], me.user)
}

export async function setRecruiterAoOfferStatus(id: string, status: 'to_review' | 'ignored') {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return setAoOfferStatusOf(me.tenantId, id, status, PATH)
}

/** « Tout arrêter » du panneau d'une offre publiée de l'organisation (sans condition d'abonnement : arrêter ne coûte rien). */
export async function stopRecruiterAoPublicationTasks(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return stopAoPublicationTasksOf(me.tenantId, id, me.user.userId, PATH)
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

/** Offres sélectionnées dans le tableau, par lots (deleteAoOffersOf). */
export async function deleteRecruiterAoOffers(ids: string[]) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return deleteAoOffersOf(me.tenantId, ids)
}

/** Recruteur de l'organisation affecté à l'offre, repris par l'offre publiée (demande de Dav du 2026-10-31). */
export async function assignRecruiterAoOffer(id: string, recruiterId: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (typeof id !== 'string' || typeof recruiterId !== 'string' || recruiterId.length > 36) return { error: 'Affectation invalide.' }
  const name = `${me.user.firstName ?? ''} ${me.user.lastName ?? ''}`.trim() || me.user.email
  return assignAoOfferOf(me.tenantId, id, recruiterId, [PATH, `${PATH}/${id}`, '/recruiter/dashboard'],
    { id: me.user.$id, userId: me.user.userId, name, offerPath: `${PATH}/${encodeURIComponent(id)}` })
}
