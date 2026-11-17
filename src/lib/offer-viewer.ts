import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { canManageTeam, roleOf } from '@/lib/team-roles'
import { viewerCanOpenJob, type OfferViewer } from '@/lib/job-ownership'
import { aoAccessFor } from '@/lib/ao/platform-view'
import { getJobById } from '@/lib/appwrite/jobs'
import type { UserProfile } from '@/types'

// Recruteur qui consulte les offres (ADR 0043) : le propriétaire et les administrateurs de l'organisation voient toutes
// ses offres, un membre seulement celles qui lui sont affectées (viewerCanOpenJob, job-ownership.ts). Rôle relu dans
// l'organisation (tenants.recruiterId, tenants.adminUserIds), jamais dans le navigateur ; une lecture par requête.

const readRole = cache(async (tenantId: string, userId: string): Promise<boolean> => {
  try {
    // Document entier, comme les autres lectures de l'organisation : un select nommant `adminUserIds` échouerait sur une
    // base où l'attribut n'est pas encore poussé (ADR 0033), et le propriétaire perdrait ses offres.
    const tenant = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    return canManageTeam(roleOf(userId, tenant as unknown as { recruiterId?: unknown; adminUserIds?: unknown }))
  } catch (err) {
    // Fermé par défaut : sans rôle lisible, la vue d'un membre (ses offres seulement).
    console.error('[offres] rôle dans l’organisation illisible : vue d’un membre', tenantId, err instanceof Error ? err.message : err)
    return false
  }
})

/** Vue des offres du recruteur connecté. Sans organisation, il n'ouvre rien (tenantId vide, refusé par recruiterCanOpenJob). */
export async function loadOfferViewer(user: Pick<UserProfile, '$id' | 'userId' | 'tenantId'>): Promise<OfferViewer> {
  const tenantId = user.tenantId ?? ''
  return { tenantId, profileId: user.$id, userId: user.userId, seesAllOffers: tenantId ? await readRole(tenantId, user.userId) : false }
}

/**
 * Offre AO `aoId` de l'organisation du recruteur qu'il peut affecter, dont il lit les candidats ou arrête les tâches :
 * pas encore publiée (à toute l'organisation), ou publiée et son offre ouverte par lui (viewerCanOpenJob : un membre, les
 * siennes seulement). Revue de sécurité du 2026-11-17 : un membre s'affectait ainsi l'offre publiée d'un collègue.
 */
export async function viewerCanUseAoOffer(user: Pick<UserProfile, '$id' | 'userId' | 'tenantId'>, aoId: string): Promise<boolean> {
  if (!user.tenantId) return false
  const offer = await aoAccessFor(user.tenantId).offer(aoId)
  if (!offer?.jobId) return true
  const job = await getJobById(offer.jobId)
  return !!job && viewerCanOpenJob(job, await loadOfferViewer(user))
}
