import 'server-only'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import type { AdminJobInput } from '@/lib/admin-job'
import { descriptionForPublication } from '@/lib/description-sections'
import type { UserProfile } from '@/types'
import { aoAccess, isDocumentId } from './access'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, toPublicOffer } from './anonymize'
import { manualRetryPatch } from './attempts'
import { canDeleteComment, parseCommentBody } from './comment-input'
import { createAoComment, deleteAoComment, deleteAoCommentsOfOffer, getAoComment, listAoComments, type AoComment } from './comments'
import { getJobMatches, runPoolMatching } from '@/lib/matching-core'
import { candidateNames, matchCandidatesForOffer } from '@/lib/sourcing-core'
import { bestMatches } from '@/lib/sourcing-rules'
import type { AoCommentView, AoDashboardActions, AoSyncPassResult, PublicationDraft, PublicationPreview, SourcingResult } from './dashboard-types'
import { cityKey, titleKey } from './fingerprint'
import { parseSender } from './origin'
import { loadAoView } from './platform-view'
import {
  deleteAoOfferAndDetails, getAoEmail, getAoOffer, getAoOfferSourcing, listAoEmailsByIds, listAoOfferDetails, saveAoOfferSourcing,
  updateAoEmail, updateAoOffer,
} from './repo'
import { getAoSource } from './sources'
import { syncAoEmail, syncAoInbox } from './sync'
import type { AoOffer } from './types'

// Cœur des actions du tableau AO, partagé par /admin/candidats (boîtes de la plateforme) et
// /recruiter/parametres/boites-ao (boîtes de l'organisation du recruteur). Les actions serveur de chaque page
// vérifient d'abord l'appelant (rôle, session) et passent SON organisation ; chaque fonction ici ne touche qu'aux
// e-mails et offres des boîtes de cette organisation (access.ts) et répond « introuvable » pour les autres.

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const aoAccessFor = (tenantId: string) => aoAccess({ getEmail: getAoEmail, getSource: getAoSource, getOffer: getAoOffer }, tenantId)

/** Statut d'abonnement d'une organisation (null : aucun), pour les droits qui en dépendent (tenancy.ts, sourcing-access.ts). */
export async function tenantSubscriptionStatus(tenantId: string): Promise<string | null> {
  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  return typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null
}

/**
 * Noms à masquer : client de l'offre et clients cités par l'appel d'offres (avec leurs sigles), nom et domaine de
 * l'expéditeur de l'e-mail et de celui du message d'origine (sauf ceux de l'organisation qui lit la boîte).
 */
async function hiddenNamesFor(offer: AoOffer): Promise<string[][]> {
  const email = (await listAoEmailsByIds([offer.emailId])).get(offer.emailId)
  const source = email?.sourceId ? await getAoSource(email.sourceId) : null
  return namesToHide(
    [offer.companyName, ...(email?.citedClients ?? [])],
    [{ name: email?.fromName, address: email?.fromAddress }, parseSender(email?.origin ?? '') ?? {}],
    source?.ownDomains ?? [],
  )
}

/**
 * Un petit passage du bouton « Synchroniser maintenant » : AoSyncProvider les enchaîne jusqu'à ce que les boîtes soient
 * lues (sync-loop.ts). Peu d'e-mails par passage : les offres apparaissent au fil de l'eau. Boîtes de l'organisation
 * seulement (verrou par organisation : un passage planifié en cours fait répondre `skipped`).
 */
export async function syncAoNow(tenantId: string, holder: string): Promise<AoSyncPassResult> {
  try {
    const report = await syncAoInbox({ maxEmails: 2, budgetMs: 120_000, holder, tenantId })
    // Données à jour renvoyées avec le compte rendu : la page les affiche tout de suite. Un rafraîchissement de la page
    // (revalidatePath, router.refresh) serait abandonné par Next.js au profit du passage suivant, lancé aussitôt.
    const { rows, recentEmails } = await loadAoView(tenantId)
    return { report, rows, recentEmails }
  } catch (err) {
    return { error: `Synchronisation impossible : ${errorOf(err)}` }
  }
}

/**
 * Bouton « Réessayer » d'un e-mail non traité : remis en file quels que soient ses essais déjà comptés
 * (manualRetryPatch), autant de fois qu'on le relance, puis traité tout de suite (même traitement et même verrou
 * qu'une synchronisation). `beforeRetry` (recruteur : quota du jour) : appelé une fois l'e-mail vérifié, avant la
 * remise à zéro ; son message refuse la relance. Si ce traitement immédiat échoue ou qu'une synchronisation est en
 * cours, l'e-mail reste en file pour la suivante.
 */
export async function retryAoEmailOf(
  tenantId: string,
  id: string,
  { holder, path, beforeRetry }: { holder: string; path: string; beforeRetry?: () => Promise<string | null> },
): ReturnType<AoDashboardActions['retryEmail']> {
  let email
  try {
    email = (await aoAccessFor(tenantId).email(id))?.email
    if (!email) return { error: 'E-mail introuvable : rechargez la page.' }
    if (email.status !== 'failed') return { error: 'Cet e-mail n\'est plus en erreur : rechargez la page.' }
    const refused = await beforeRetry?.()
    if (refused) return { error: refused }
    const patch = manualRetryPatch(email)
    if (patch) await updateAoEmail(email.$id, patch)
  } catch (err) {
    return { error: `Relance impossible : ${errorOf(err)}` }
  }
  try {
    // Plus court que le passage planifié : l'utilisateur attend la réponse.
    return { report: await syncAoEmail(email, { budgetMs: 150_000, holder, tenantId }) }
  } catch (err) {
    return { error: `Traitement immédiat impossible (${errorOf(err)}) : l'e-mail est remis en file pour la prochaine synchronisation.` }
  } finally {
    revalidatePath(path)
  }
}

/** Version anonymisée proposée avant publication. */
export async function previewAoPublicationOf(tenantId: string, id: string): ReturnType<AoDashboardActions['previewPublication']> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    const pub = toPublicOffer(offer, await hiddenNamesFor(offer))
    const key = `${titleKey(offer.title)}|${cityKey(offer.location)}`
    const similarJobs = (await getActiveJobs())
      .filter(job => `${titleKey(job.title)}|${cityKey(job.location)}` === key)
      .slice(0, 5)
      .map(job => ({ id: job.$id, title: job.title, location: job.location }))
    const preview: PublicationPreview = {
      draft: {
        ...pub,
        // Mise en forme (sections, puces) après l'anonymisation, qui retire les lignes de contact d'après
        // leur début de ligne. Ce texte est relu avant publication : il est publié tel quel, sur le site et les réseaux.
        description: descriptionForPublication(pub.description),
        contractType: offer.contractType, remote: offer.remote, salary: offer.salary,
      },
      similarJobs,
    }
    return { preview }
  } catch (err) {
    return { error: errorOf(err) }
  }
}

const PublishSchema = z.object({
  title: z.string().trim().min(2).max(200),
  companyName: z.string().trim().min(2).max(200),
  description: z.string().trim().min(20).max(20_000),
  location: z.string().trim().max(200),
  contractType: z.enum(['cdi', 'cdd', 'freelance', 'mission']),
  remote: z.enum(['onsite', 'hybrid', 'remote']),
  salary: z.number().int().positive().max(999_999).nullable(),
  skills: z.array(z.string().trim().min(1).max(60)).max(10),
})

/** Création de l'offre publique : par l'admin (offre de la plateforme) ou par un recruteur (offre de son organisation). */
export interface AoJobPublisher {
  /** Crée l'offre d'identifiant `jobId` ; une seconde création du même identifiant doit échouer (409). */
  create(job: AdminJobInput, jobId: string): Promise<void>
  exists(jobId: string): Promise<boolean>
}

export async function publishAoOfferOf(
  tenantId: string,
  id: string,
  input: PublicationDraft,
  publisher: AoJobPublisher,
  paths: string[],
): ReturnType<AoDashboardActions['publish']> {
  const parsed = PublishSchema.safeParse(input)
  if (!parsed.success) return { error: 'Champs invalides : vérifiez le titre, la description (20 caractères minimum) et le montant.' }
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published' || offer.jobId) return { error: 'Cette offre est déjà publiée.' }

    const names = await hiddenNamesFor(offer)
    // Le client reste masqué sur le site, même si son nom (ou celui de l'expéditeur) a été saisi comme libellé.
    const label = revealsName(parsed.data.companyName, names) ? DEFAULT_CLIENT_LABEL : parsed.data.companyName
    // Filet de sécurité : tout le texte édité repasse par l'anonymisation avant d'être publié.
    const pub = toPublicOffer({ ...offer, ...parsed.data, duration: '', startDate: '', experience: '' }, names, label)

    // Identifiant fixe : une double publication (deux onglets, nouvel essai après une erreur) échoue en 409
    // au lieu de créer une seconde offre, une seconde diffusion et un second sourcing.
    const jobId = `ao${offer.$id}`
    await updateAoOffer(offer.$id, { status: 'published', jobId })
    try {
      await publisher.create({ ...parsed.data, ...pub }, jobId)
    } catch (err) {
      if (!(await publisher.exists(jobId))) {
        await updateAoOffer(offer.$id, { status: 'to_review', jobId: null }).catch(rollback => {
          console.error('AO: offre restée « publiée » sans offre publique', offer.$id, errorOf(rollback))
        })
        throw err
      }
      // L'offre existe déjà (publication simultanée, ou erreur pendant la diffusion) : elle reste publiée.
      console.error('AO: offre publique créée, suite de la publication en échec', jobId, errorOf(err))
    }
    for (const path of paths) revalidatePath(path)
    return { jobId }
  } catch (err) {
    return { error: `Publication impossible : ${errorOf(err)}` }
  }
}

export async function setAoOfferStatusOf(tenantId: string, id: string, status: 'to_review' | 'ignored', path: string): ReturnType<AoDashboardActions['setStatus']> {
  if (status !== 'to_review' && status !== 'ignored') return { error: 'Statut invalide.' }
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published') return { error: 'Une offre publiée se gère depuis la liste des offres publiées.' }
    await updateAoOffer(offer.$id, { status })
    revalidatePath(path)
    return {}
  } catch (err) {
    return { error: errorOf(err) }
  }
}

// ── Sourcing (meilleurs candidats pour une offre) ─────────────────

/**
 * Sourcing d'une offre AO, toujours enregistré pour ne pas refaire d'appel d'IA à chaque ouverture :
 * - offre publiée : matching calculé à la publication (tryAutoSourceCandidates → runPoolMatching), lu avec
 *   getJobMatches (base candidats, vivier, candidatures) ;
 * - offre non publiée : dernier calcul à la demande, enregistré dans ao_offer_details (identifiants, scores, raisons).
 * `recompute` : recalcule d'abord (un appel d'IA, environ une minute). `beforeAi` est appelé juste avant cet appel, une
 * fois l'offre vérifiée : un message de refus l'empêche (quota du jour des recruteurs) ; sans recalcul, aucun appel.
 * Seuls les 5 meilleurs notés 65 ou plus sont renvoyés (même règle que l'e-mail automatique de la publication).
 */
export async function aoOfferSourcingOf(
  tenantId: string,
  id: string,
  { recompute, beforeAi }: { recompute: boolean; beforeAi?: () => Promise<string | null> },
): Promise<SourcingResult> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }

    if (offer.jobId) {
      if (recompute) {
        const refused = await beforeAi?.()
        if (refused) return { error: refused }
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
      const refused = await beforeAi?.()
      if (refused) return { error: refused }
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

// ── Commentaires (notes internes de l'organisation) ───────────────

/** Message d'erreur d'une action sur les commentaires ; la collection manquante a déjà son message complet. */
function commentsError(err: unknown, action: string): string {
  const message = errorOf(err)
  return message.startsWith('Commentaires indisponibles') ? message : `${action} : ${message}`
}

const toCommentView = (c: AoComment, userId: string): AoCommentView => ({
  id: c.$id, authorName: c.authorName || 'Utilisateur', body: c.body, createdAt: c.createdAt, mine: canDeleteComment(c, userId),
})

/** Commentaires d'une offre de l'organisation, du plus ancien au plus récent. */
export async function listAoOfferCommentsOf(tenantId: string, userId: string, offerId: string): ReturnType<AoDashboardActions['listComments']> {
  try {
    if (!(await aoAccessFor(tenantId).offer(offerId))) return { error: 'Offre introuvable : rechargez la page.' }
    return { comments: (await listAoComments(offerId)).map(c => toCommentView(c, userId)) }
  } catch (err) {
    return { error: commentsError(err, 'Commentaires illisibles') }
  }
}

export async function addAoOfferCommentOf(tenantId: string, user: UserProfile, offerId: string, body: string): ReturnType<AoDashboardActions['addComment']> {
  const text = parseCommentBody(body)
  if (!text.ok) return { error: text.error }
  try {
    if (!(await aoAccessFor(tenantId).offer(offerId))) return { error: 'Offre introuvable : rechargez la page.' }
    const comment = await createAoComment({
      offerId,
      tenantId,
      authorId: user.userId,
      authorName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
      body: text.body,
    })
    return { comment: toCommentView(comment, user.userId) }
  } catch (err) {
    return { error: commentsError(err, 'Commentaire non enregistré') }
  }
}

/** Supprime un commentaire : son auteur seulement, sur une offre de l'organisation. */
export async function deleteAoOfferCommentOf(tenantId: string, userId: string, commentId: string): ReturnType<AoDashboardActions['deleteComment']> {
  if (!isDocumentId(commentId)) return { error: 'Commentaire introuvable : rechargez la page.' }
  try {
    const comment = await getAoComment(commentId)
    if (!comment || comment.tenantId !== tenantId || !(await aoAccessFor(tenantId).offer(comment.offerId))) return { error: 'Commentaire introuvable : rechargez la page.' }
    if (!canDeleteComment(comment, userId)) return { error: 'Seul l\'auteur d\'un commentaire peut le supprimer.' }
    await deleteAoComment(comment.$id)
    return {}
  } catch (err) {
    return { error: commentsError(err, 'Suppression impossible') }
  }
}

// ── Suppression d'une offre ──────────────────────────────────────

/**
 * Supprime définitivement une offre AO de l'organisation, avec ses commentaires et ses détails. Refusé pour une offre
 * publiée : son offre publique resterait en ligne sans son appel d'offres. L'e-mail reste enregistré, l'offre n'est
 * donc pas recréée par la synchronisation suivante (« Ignorer », lui, la garde en la masquant).
 */
export async function deleteAoOfferOf(tenantId: string, id: string): ReturnType<AoDashboardActions['deleteOffer']> {
  try {
    const offer = await aoAccessFor(tenantId).offer(id)
    if (!offer) return { error: 'Offre introuvable : rechargez la page.' }
    if (offer.status === 'published' || offer.jobId) {
      return { error: 'Offre publiée : retirez d\'abord l\'offre publique, sinon elle resterait en ligne sans son appel d\'offres.' }
    }
    await deleteAoCommentsOfOffer(offer.$id)
    await deleteAoOfferAndDetails(offer.$id)
    return {}
  } catch (err) {
    return { error: `Suppression impossible : ${errorOf(err)}` }
  }
}
