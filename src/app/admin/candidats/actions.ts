'use server'

import { requireAdmin } from '@/lib/appwrite/auth'
import { adminJobExists, createAdminJob } from '@/lib/admin-job'
import { isDocumentId } from '@/lib/ao/access'
import type { PublicationDraft, SourcingResult } from '@/lib/ao/dashboard-types'
import {
  addAoOfferCommentOf, aoAccessFor, deleteAoOfferCommentOf, deleteAoOfferOf, listAoOfferCommentsOf, previewAoPublicationOf,
  publishAoOfferOf, retryAoEmailOf, setAoOfferStatusOf, syncAoNow,
} from '@/lib/ao/offer-actions'
import { getAoOfferSourcing, listAoOfferDetails, saveAoOfferSourcing } from '@/lib/ao/repo'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { candidateNames, matchCandidatesForOffer } from '@/lib/sourcing-core'
import { bestMatches } from '@/lib/sourcing-rules'
import { getJobMatches, runPoolMatching } from '@/lib/matching-core'

// Actions de /admin/candidats : chacune vérifie l'admin elle-même (une Server Action est un point d'entrée public),
// puis agit sur les seules boîtes de la plateforme (ADR 0005, cœur partagé : src/lib/ao/offer-actions.ts).

const PATH = '/admin/candidats'
// Les offres publiées depuis cette page sont rattachées à l'admin, comme l'import manuel d'appels d'offres.
const ADMIN_TENANT_ID = 'admin'

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function syncAoInboxNow() {
  await requireAdmin()
  return syncAoNow(PLATFORM_TENANT_ID, 'admin')
}

export async function retryAoEmail(id: string) {
  await requireAdmin()
  return retryAoEmailOf(PLATFORM_TENANT_ID, id, { holder: 'admin', path: PATH, reset: true })
}

/** Version anonymisée proposée à l'admin avant publication. */
export async function previewAoPublication(id: string) {
  await requireAdmin()
  return previewAoPublicationOf(PLATFORM_TENANT_ID, id)
}

export async function publishAoOffer(id: string, input: PublicationDraft) {
  await requireAdmin()
  return publishAoOfferOf(
    PLATFORM_TENANT_ID,
    id,
    input,
    { create: async (job, jobId) => { await createAdminJob(job, ADMIN_TENANT_ID, jobId) }, exists: adminJobExists },
    [PATH, '/admin/jobs'],
  )
}

export async function setAoOfferStatus(id: string, status: 'to_review' | 'ignored') {
  await requireAdmin()
  return setAoOfferStatusOf(PLATFORM_TENANT_ID, id, status, PATH)
}

/**
 * Sourcing d'une offre AO, toujours enregistré pour ne pas refaire d'appel d'IA à chaque ouverture :
 * - offre publiée : matching calculé à la publication (tryAutoSourceCandidates → runPoolMatching), lu avec
 *   getJobMatches (base candidats, vivier, candidatures) ;
 * - offre non publiée : dernier calcul à la demande, enregistré dans ao_offer_details (identifiants, scores, raisons).
 * `recompute` : recalcule d'abord (un appel d'IA, environ une minute). Seuls les 5 meilleurs notés 65 ou plus sont
 * renvoyés (même règle que l'e-mail automatique de la publication). Offres de la plateforme seulement ; les recruteurs
 * n'ont pas ce bouton (décision du 2026-10-25).
 */
export async function aoOfferSourcing(id: string, recompute = false): Promise<SourcingResult> {
  await requireAdmin()
  if (!isDocumentId(id)) return { error: 'Offre introuvable : rechargez la page.' }
  try {
    const offer = await aoAccessFor(PLATFORM_TENANT_ID).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }

    if (offer.jobId) {
      if (recompute) {
        const run = await runPoolMatching(offer.jobId)
        if (run.error) return { error: run.error }
      }
      const { matches, poolComputedAt } = await getJobMatches(offer.jobId)
      const kept = bestMatches(matches).map(m => ({ id: `${m.source}:${m.id}`, name: m.name, score: m.score, reason: m.reason, origin: m.source }))
      return { candidates: kept, computedAt: poolComputedAt }
    }

    let record = recompute ? null : await getAoOfferSourcing(offer.$id)
    if (!record && !recompute) return { computedAt: null }
    if (!record) {
      const technologies = (await listAoOfferDetails([offer.$id])).get(offer.$id)?.technologies ?? []
      const result = await matchCandidatesForOffer({
        title: offer.title,
        skills: offer.skills,
        description: offer.description,
        details: [
          technologies.length ? `Technologies : ${technologies.join(', ')}` : '',
          offer.experience ? `Expérience requise : ${offer.experience}` : '',
          offer.location ? `Lieu : ${offer.location}` : '',
        ].filter(Boolean),
      })
      if (result.error) return { error: result.error, scanned: result.scanned }
      record = {
        at: new Date().toISOString(),
        scanned: result.scanned,
        candidates: bestMatches(result.matches).map(m => ({ candidateId: m.candidateId, score: m.score, reason: m.reason })),
      }
      await saveAoOfferSourcing(offer.$id, record)
    }
    const names = await candidateNames(record.candidates.map(c => c.candidateId))
    const kept = record.candidates
      .filter(c => names.has(c.candidateId))
      .map(c => ({ id: `pool:${c.candidateId}`, name: names.get(c.candidateId) ?? '', score: c.score, reason: c.reason, origin: 'pool' as const }))
    return { candidates: kept, computedAt: record.at, scanned: record.scanned }
  } catch (err) {
    return { error: `Sourcing impossible : ${errorOf(err)}` }
  }
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
