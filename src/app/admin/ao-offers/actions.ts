'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/appwrite/auth'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { adminJobExists, createAdminJob } from '@/lib/admin-job'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, toPublicOffer } from '@/lib/ao/anonymize'
import { parseSender } from '@/lib/ao/origin'
import { getAoSource } from '@/lib/ao/sources'
import { PLATFORM_TENANT_ID } from '@/lib/ao/tenancy'
import { descriptionForPublication } from '@/lib/description-sections'
import { cityKey, titleKey } from '@/lib/ao/fingerprint'
import { manualRetryPatch } from '@/lib/ao/attempts'
import { getAoEmail, getAoOffer, getAoOfferSourcing, listAoEmailsByIds, listAoOfferDetails, saveAoOfferSourcing, updateAoEmail, updateAoOffer } from '@/lib/ao/repo'
import { candidateNames, matchCandidatesForOffer } from '@/lib/sourcing-core'
import { bestMatches } from '@/lib/sourcing-rules'
import { getJobMatches, runPoolMatching, type JobMatchResult } from '@/lib/matching-core'
import type { AoEmail, AoOffer } from '@/lib/ao/types'
import { syncAoEmail, syncAoInbox, type AoSyncReport } from '@/lib/ao/sync'
import type { AoContract, AoRemote } from '@/lib/ao/types'

// Les offres publiées depuis AO Offers sont rattachées à l'admin, comme l'import manuel d'appels d'offres.
const ADMIN_TENANT_ID = 'admin'

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

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
 * E-mail d'une boîte de la plateforme ; null sinon. L'admin voit les offres des organisations mais n'agit que sur
 * celles de la plateforme (ADR 0005) : vérifié avant toute écriture.
 */
async function platformEmail(emailId: string): Promise<AoEmail | null> {
  const email = await getAoEmail(emailId)
  const source = email?.sourceId ? await getAoSource(email.sourceId) : null
  return email && source?.tenantId === PLATFORM_TENANT_ID ? email : null
}

/** Offre AO de la plateforme (voir platformEmail) ; null si elle n'existe pas ou appartient à une organisation. */
async function platformOffer(id: string): Promise<AoOffer | null> {
  const offer = await getAoOffer(id)
  return offer && (await platformEmail(offer.emailId)) ? offer : null
}

export async function syncAoInboxNow(): Promise<{ report?: AoSyncReport; error?: string }> {
  await requireAdmin()
  try {
    // Plus court que le passage planifié : l'admin attend la réponse.
    // Boîtes de la plateforme seulement : celles des organisations sont lues par leurs passages planifiés.
    const report = await syncAoInbox({ maxEmails: 5, budgetMs: 150_000, holder: 'admin', tenantId: PLATFORM_TENANT_ID })
    revalidatePath('/admin/ao-offers')
    return { report }
  } catch (err) {
    return { error: `Synchronisation impossible : ${errorOf(err)}` }
  }
}

/** Identifiant de document Appwrite (36 caractères au plus, lettres, chiffres, « . », « _ », « - »). */
const DocumentId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/)

/**
 * Bouton « Réessayer » d'un e-mail non traité : il est remis en file, quels que soient ses essais déjà comptés,
 * puis traité tout de suite (même traitement et même verrou qu'une synchronisation). Si ce traitement immédiat
 * échoue ou qu'une synchronisation est en cours, il reste en file pour la suivante.
 */
export async function retryAoEmail(id: string): Promise<{ report?: AoSyncReport; error?: string }> {
  await requireAdmin()
  const parsed = DocumentId.safeParse(id)
  if (!parsed.success) return { error: 'Identifiant d\'e-mail invalide.' }
  let email
  try {
    email = await platformEmail(parsed.data)
    if (!email) return { error: 'E-mail introuvable : rechargez la page.' }
    const patch = manualRetryPatch(email)
    if (!patch) return { error: 'Cet e-mail n\'est plus en erreur : rechargez la page.' }
    await updateAoEmail(email.$id, patch)
  } catch (err) {
    return { error: `Relance impossible : ${errorOf(err)}` }
  }
  try {
    // Plus court que le passage planifié : l'admin attend la réponse.
    return { report: await syncAoEmail(email, { budgetMs: 150_000, holder: 'admin', tenantId: PLATFORM_TENANT_ID }) }
  } catch (err) {
    return { error: `Traitement immédiat impossible (${errorOf(err)}) : l'e-mail est remis en file pour la prochaine synchronisation.` }
  } finally {
    revalidatePath('/admin/ao-offers')
  }
}

export interface PublicationDraft {
  title: string
  companyName: string
  description: string
  location: string
  contractType: AoContract
  remote: AoRemote
  salary: number | null
  skills: string[]
}

export interface PublicationPreview {
  draft: PublicationDraft
  /** Offres déjà en ligne au même intitulé et dans la même ville (risque de doublon). */
  similarJobs: { id: string; title: string; location: string }[]
}

/** Version anonymisée proposée à l'admin avant publication. */
export async function previewAoPublication(id: string): Promise<{ preview?: PublicationPreview; error?: string }> {
  await requireAdmin()
  try {
    const offer = await platformOffer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    const pub = toPublicOffer(offer, await hiddenNamesFor(offer))
    const key = `${titleKey(offer.title)}|${cityKey(offer.location)}`
    const similarJobs = (await getActiveJobs())
      .filter(job => `${titleKey(job.title)}|${cityKey(job.location)}` === key)
      .slice(0, 5)
      .map(job => ({ id: job.$id, title: job.title, location: job.location }))
    return {
      preview: {
        draft: {
          ...pub,
          // Mise en forme (sections, puces) après l'anonymisation, qui retire les lignes de contact d'après
          // leur début de ligne. L'admin relit ce texte : il est publié tel quel, sur le site et sur LinkedIn.
          description: descriptionForPublication(pub.description),
          contractType: offer.contractType, remote: offer.remote, salary: offer.salary,
        },
        similarJobs,
      },
    }
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

export async function publishAoOffer(id: string, input: PublicationDraft): Promise<{ jobId?: string; error?: string }> {
  await requireAdmin()
  const parsed = PublishSchema.safeParse(input)
  if (!parsed.success) return { error: 'Champs invalides : vérifiez le titre, la description (20 caractères minimum) et le montant.' }
  try {
    const offer = await platformOffer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published' || offer.jobId) return { error: 'Cette offre est déjà publiée.' }

    const names = await hiddenNamesFor(offer)
    // Le client reste masqué sur le site, même si l'admin a saisi son nom (ou celui de l'expéditeur) comme libellé.
    const label = revealsName(parsed.data.companyName, names) ? DEFAULT_CLIENT_LABEL : parsed.data.companyName
    // Filet de sécurité : tout le texte édité repasse par l'anonymisation avant d'être publié.
    const pub = toPublicOffer({ ...offer, ...parsed.data, duration: '', startDate: '', experience: '' }, names, label)

    // Identifiant fixe : une double publication (deux onglets, nouvel essai après une erreur) échoue en 409
    // au lieu de créer une seconde offre, un second post LinkedIn et un second sourcing.
    const jobId = `ao${offer.$id}`
    await updateAoOffer(id, { status: 'published', jobId })
    try {
      await createAdminJob({ ...parsed.data, ...pub }, ADMIN_TENANT_ID, jobId)
    } catch (err) {
      if (!(await adminJobExists(jobId))) {
        await updateAoOffer(id, { status: 'to_review', jobId: null }).catch(() => undefined)
        throw err
      }
      // L'offre existe déjà (publication simultanée, ou erreur pendant la diffusion) : elle reste publiée.
    }
    revalidatePath('/admin/ao-offers')
    revalidatePath('/admin/jobs')
    return { jobId }
  } catch (err) {
    return { error: `Publication impossible : ${errorOf(err)}` }
  }
}

export async function setAoOfferStatus(id: string, status: 'to_review' | 'ignored'): Promise<{ error?: string }> {
  await requireAdmin()
  if (status !== 'to_review' && status !== 'ignored') return { error: 'Statut invalide.' }
  try {
    const offer = await platformOffer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published') return { error: 'Une offre publiée se gère depuis « Offres ».' }
    await updateAoOffer(id, { status })
    revalidatePath('/admin/ao-offers')
    return {}
  } catch (err) {
    return { error: errorOf(err) }
  }
}

/** Candidat retenu pour une offre AO (les 5 meilleurs notés 65 ou plus, sourcing-rules.ts). */
export interface SourcedCandidate {
  id: string
  name: string
  score: number | null
  reason: string
  /** pool : base candidats ; vivier : CV ajouté à l'offre publiée ; application : candidature reçue. */
  origin: JobMatchResult['source']
}

export interface SourcingResult {
  candidates?: SourcedCandidate[]
  /** Date du calcul (null : jamais calculé pour cette offre). */
  computedAt?: string | null
  /** CV analysés (offre non publiée). */
  scanned?: number
  error?: string
}

/**
 * Sourcing d'une offre AO, toujours enregistré pour ne pas refaire d'appel d'IA à chaque ouverture :
 * - offre publiée : matching calculé à la publication (tryAutoSourceCandidates → runPoolMatching), lu avec
 *   getJobMatches (base candidats, vivier, candidatures) ;
 * - offre non publiée : dernier calcul à la demande, enregistré dans ao_offer_details (identifiants, scores, raisons).
 * `recompute` : recalcule d'abord (un appel d'IA, environ une minute). Seuls les 5 meilleurs notés 65 ou plus sont
 * renvoyés (même règle que l'e-mail automatique de la publication). Offres de la plateforme seulement.
 */
export async function aoOfferSourcing(id: string, recompute = false): Promise<SourcingResult> {
  await requireAdmin()
  const parsed = DocumentId.safeParse(id)
  if (!parsed.success) return { error: 'Offre introuvable : rechargez la page.' }
  try {
    const offer = await platformOffer(parsed.data)
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
