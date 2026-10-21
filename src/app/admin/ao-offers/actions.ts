'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/appwrite/auth'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { adminJobExists, createAdminJob } from '@/lib/admin-job'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, toPublicOffer } from '@/lib/ao/anonymize'
import { parseSender } from '@/lib/ao/origin'
import { descriptionForPublication } from '@/lib/description-sections'
import { cityKey, titleKey } from '@/lib/ao/fingerprint'
import { manualRetryPatch } from '@/lib/ao/attempts'
import { getAoEmail, getAoOffer, listAoEmailsByIds, updateAoEmail, updateAoOffer } from '@/lib/ao/repo'
import type { AoOffer } from '@/lib/ao/types'
import { syncAoEmail, syncAoInbox, type AoSyncReport } from '@/lib/ao/sync'
import type { AoContract, AoRemote } from '@/lib/ao/types'

// Les offres publiées depuis AO Offers sont rattachées à l'admin, comme l'import manuel d'appels d'offres.
const ADMIN_TENANT_ID = 'admin'

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Noms à masquer : client de l'offre et clients cités par l'appel d'offres (avec leurs sigles), nom et domaine de
 * l'expéditeur de l'e-mail et de celui du message d'origine.
 */
async function hiddenNamesFor(offer: AoOffer): Promise<string[][]> {
  const email = (await listAoEmailsByIds([offer.emailId])).get(offer.emailId)
  return namesToHide(
    [offer.companyName, ...(email?.citedClients ?? [])],
    { name: email?.fromName, address: email?.fromAddress },
    parseSender(email?.origin ?? '') ?? {},
  )
}

export async function syncAoInboxNow(): Promise<{ report?: AoSyncReport; error?: string }> {
  await requireAdmin()
  try {
    // Plus court que le passage planifié : l'admin attend la réponse.
    const report = await syncAoInbox({ maxEmails: 5, budgetMs: 150_000, holder: 'admin' })
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
    email = await getAoEmail(parsed.data)
    if (!email) return { error: 'E-mail introuvable : rechargez la page.' }
    const patch = manualRetryPatch(email)
    if (!patch) return { error: 'Cet e-mail n\'est plus en erreur : rechargez la page.' }
    await updateAoEmail(email.$id, patch)
  } catch (err) {
    return { error: `Relance impossible : ${errorOf(err)}` }
  }
  try {
    // Plus court que le passage planifié : l'admin attend la réponse.
    return { report: await syncAoEmail(email, { budgetMs: 150_000, holder: 'admin' }) }
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
    const offer = await getAoOffer(id)
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
    const offer = await getAoOffer(id)
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
    const offer = await getAoOffer(id)
    if (!offer) return { error: 'Offre introuvable.' }
    if (offer.status === 'published') return { error: 'Une offre publiée se gère depuis « Offres ».' }
    await updateAoOffer(id, { status })
    revalidatePath('/admin/ao-offers')
    return {}
  } catch (err) {
    return { error: errorOf(err) }
  }
}
