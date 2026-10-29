'use server'

import { requireAdmin } from '@/lib/appwrite/auth'
import type { PublicationDraft, SourcingResult } from '@/lib/ao/dashboard-types'
import {
  addAoOfferCommentOf, aoOfferSourcingOf, deleteAoOfferCommentOf, deleteAoOfferOf, listAoOfferCommentsOf, previewAoPublicationOf,
  publishAoOfferOf, retryAoEmailOf, setAoOfferStatusOf, stopAoPublicationTasksOf,
} from '@/lib/ao/offer-actions'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'

// Actions de /admin/candidats : chacune vérifie l'admin elle-même (une Server Action est un point d'entrée public),
// puis agit sur les seules boîtes de la plateforme (ADR 0005, cœur partagé : src/lib/ao/offer-actions.ts).
// « Synchroniser maintenant » passe par la route /api/admin/candidats/sync (AoSyncProvider), pas par une action.

const PATH = '/admin/candidats'
// Les offres publiées depuis cette page sont rattachées à l'admin, comme l'import manuel d'appels d'offres.
const ADMIN_TENANT_ID = 'admin'

export async function retryAoEmail(id: string) {
  await requireAdmin()
  return retryAoEmailOf(PLATFORM_TENANT_ID, id, { holder: 'admin', path: PATH })
}

/** Version anonymisée proposée à l'admin avant publication. */
export async function previewAoPublication(id: string) {
  await requireAdmin()
  return previewAoPublicationOf(PLATFORM_TENANT_ID, id)
}

export async function publishAoOffer(id: string, input: PublicationDraft) {
  await requireAdmin()
  return publishAoOfferOf(PLATFORM_TENANT_ID, id, input, ADMIN_TENANT_ID, [PATH, '/admin/jobs'])
}

export async function setAoOfferStatus(id: string, status: 'to_review' | 'ignored') {
  await requireAdmin()
  return setAoOfferStatusOf(PLATFORM_TENANT_ID, id, status, PATH)
}

/** « Tout arrêter » du panneau d'une offre publiée de la plateforme. */
export async function stopAoPublicationTasks(id: string) {
  const user = await requireAdmin()
  return stopAoPublicationTasksOf(PLATFORM_TENANT_ID, id, user.userId, PATH)
}

/** Sourcing d'une offre de la plateforme : l'admin n'a pas de quota (aoOfferSourcingOf). */
export async function aoOfferSourcing(id: string, recompute = false): Promise<SourcingResult> {
  await requireAdmin()
  return aoOfferSourcingOf(PLATFORM_TENANT_ID, id, { recompute })
}

export async function listAoOfferComments(offerId: string) {
  const user = await requireAdmin()
  return listAoOfferCommentsOf(PLATFORM_TENANT_ID, user.userId, offerId)
}

export async function addAoOfferComment(offerId: string, body: string) {
  const user = await requireAdmin()
  return addAoOfferCommentOf(PLATFORM_TENANT_ID, user, offerId, body)
}

export async function deleteAoOfferComment(commentId: string) {
  const user = await requireAdmin()
  return deleteAoOfferCommentOf(PLATFORM_TENANT_ID, user.userId, commentId)
}

export async function deleteAoOffer(id: string) {
  await requireAdmin()
  return deleteAoOfferOf(PLATFORM_TENANT_ID, id)
}
