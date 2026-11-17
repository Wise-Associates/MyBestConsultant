'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ensureColumns, getStagesForJob, logFunnelEvent } from '@/lib/appwrite/funnel'
import { applicationOfOrganisation } from '@/lib/screening-core'
import { funnelForCandidate, serializeFunnel } from '@/lib/candidate-funnel'
import { resolveStatus } from '@/lib/funnel-stage-utils'
import { getJobById } from '@/lib/appwrite/jobs'
import { viewerCanOpenJob, type OfferViewer } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { isJobClientsConfigured, saveJobClient } from '@/lib/appwrite/job-clients'
import {
  CLIENT_LIMITS, jobClientSchema, newSubmission, parseClientSubmission, retainedFunnel, serializeClientSubmission, withResponse,
  type ClientSubmission, type JobClient,
} from '@/lib/client-response'
import { requireRecruiter } from '../actions'

// Onglet « Réponse client » d'une offre (lib/client-response.ts) : noter l'envoi d'une sélection au client, puis sa
// réponse. Chaque action vérifie le recruteur et que la candidature est de son organisation et de cette offre.

const id = z.string().regex(/^[\w-]{1,36}$/)
const UNAVAILABLE = 'La réponse client n’est pas encore activée : la base doit être mise à jour (champ clientJson). Contactez le support.'

/** Appwrite refuse l'attribut : la structure (appwrite.config.json) n'a pas été poussée sur ce projet. */
function isMissingAttribute(err: unknown): boolean {
  const type = (err as { type?: unknown }).type
  return type === 'document_invalid_structure' && err instanceof Error && err.message.includes('Unknown attribute')
}

/**
 * Candidature de l'offre `jobId` que le recruteur voit (viewerCanSeeApplication : un membre, sur ses offres seulement) ; null sinon. Une candidature directe
 * à une offre partagée (tenantId '' des deux côtés) est vue de toutes les organisations : son unique `clientJson` serait
 * commun, elle est donc écartée.
 */
async function applicationOfJob(applicationId: string, jobId: string, viewer: OfferViewer) {
  const owned = await applicationOfOrganisation(applicationId, viewer)
  if (!owned || owned.application.jobId !== jobId) return null
  const { tenantId } = viewer
  return owned.application.tenantId === tenantId || owned.job.tenantId === tenantId ? owned.application : null
}

const SendInput = z.object({ jobId: id, applicationIds: z.array(id).min(1).max(CLIENT_LIMITS.batch) })

/** « Envoyer une sélection au client » : note l'envoi de chaque candidature (sauf refusée), avec les étapes de sa fiche. */
export async function sendToClientAction(input: unknown): Promise<{ sent: string[]; refused: string[] } | { error: string }> {
  const parsed = SendInput.safeParse(input)
  if (!parsed.success) return { error: 'Sélection invalide.' }
  const { jobId, applicationIds } = parsed.data
  try {
    const user = await requireRecruiter()
    const tenantId = user.tenantId!
    const who = `${user.firstName} ${user.lastName}`.trim()
    const [{ stages }, viewer] = await Promise.all([getStagesForJob(tenantId, jobId), loadOfferViewer(user)])
    const { databases } = createAdminClient()
    const sent: string[] = []
    const refused: string[] = []
    // Une candidature après l'autre : un échec n'annule pas les envois déjà notés, il est rapporté avec eux.
    for (const applicationId of [...new Set(applicationIds)]) {
      try {
        const application = await applicationOfJob(applicationId, jobId, viewer)
        if (!application) { refused.push('candidature introuvable'); continue }
        const status = resolveStatus(stages, application.status as string)
        const steps = funnelForCandidate(application.funnelJson, status).steps
        const next = newSubmission(steps, status, parseClientSubmission(application.clientJson), who, new Date())
        if ('error' in next) { refused.push(next.error); continue }
        await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, { clientJson: serializeClientSubmission(next.submission) })
        sent.push(applicationId)
        await logFunnelEvent(applicationId, status, 'stage_change', 'Envoyé au client', who) // ne lève jamais (funnel.ts)
      } catch (err) {
        if (isMissingAttribute(err)) throw err
        console.error('[réponse client] envoi non enregistré', applicationId, err instanceof Error ? err.message : err)
        refused.push('enregistrement impossible, réessayez')
      }
    }
    revalidatePath(`/recruiter/pipeline/${jobId}/client`)
    return { sent, refused }
  } catch (err) {
    if (isMissingAttribute(err)) {
      console.error('[réponse client] attribut clientJson absent', err instanceof Error ? err.message : err)
      return { error: UNAVAILABLE }
    }
    console.error('[réponse client] envoi non enregistré', jobId, err instanceof Error ? err.message : err)
    return { error: 'L’envoi n’a pas pu être enregistré. Réessayez.' }
  }
}

const ResponseInput = z.object({
  jobId: id,
  applicationId: id,
  response: z.enum(['interview', 'rejected', 'retained']),
  // Coupé à CLIENT_LIMITS.comment par withResponse ; borné ici pour ne pas traiter un texte démesuré.
  comment: z.string().max(CLIENT_LIMITS.comment * 4),
})

/**
 * Réponse du client (Entretien, Refusé, Retenu) et son commentaire. « Retenu » fait passer le candidat dans « Embauchés »
 * (choix du 2026-11-17 ; retainedFunnel), en une seule écriture avec la réponse.
 */
export async function recordClientResponseAction(input: unknown): Promise<{ submission: ClientSubmission; column?: string } | { error: string }> {
  const parsed = ResponseInput.safeParse(input)
  if (!parsed.success) return { error: 'Réponse invalide.' }
  const { jobId, applicationId, response, comment } = parsed.data
  try {
    const user = await requireRecruiter()
    const tenantId = user.tenantId!
    const who = `${user.firstName} ${user.lastName}`.trim()
    const application = await applicationOfJob(applicationId, jobId, await loadOfferViewer(user))
    if (!application) return { error: 'Candidature introuvable.' }
    const existing = parseClientSubmission(application.clientJson)
    if (!existing) return { error: 'Ce candidat n’a pas été envoyé au client.' }

    const now = new Date()
    const submission = withResponse(existing, response, comment, who, now)
    const patch: Record<string, unknown> = { clientJson: serializeClientSubmission(submission) }
    let column: string | undefined
    if (response === 'retained') {
      const { stages, pipeline } = await getStagesForJob(tenantId, jobId)
      const status = resolveStatus(stages, application.status as string)
      const hired = retainedFunnel(funnelForCandidate(application.funnelJson, status).steps, stages, comment, who, now)
      // Colonne « Embauchés » créée si le pipeline de l'offre ne l'a pas, comme pour une étape du funnel.
      await ensureColumns(tenantId, pipeline?.id ?? null, [hired.column])
      Object.assign(patch, { status: hired.column, stageStatus: null, funnelJson: serializeFunnel(hired.steps) })
      column = hired.column
    }
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId, patch)
    await logFunnelEvent(applicationId, column ?? (application.status as string), 'stage_change', `Réponse du client : ${response === 'interview' ? 'entretien demandé' : response === 'rejected' ? 'refusé' : 'retenu'}`, who)
    revalidatePath(`/recruiter/pipeline/${jobId}/client`)
    if (column) {
      revalidatePath(`/recruiter/pipeline/${jobId}`)
      revalidatePath('/recruiter/dashboard')
    }
    return { submission, column }
  } catch (err) {
    if (isMissingAttribute(err)) {
      console.error('[réponse client] attribut clientJson absent', err instanceof Error ? err.message : err)
      return { error: UNAVAILABLE }
    }
    console.error('[réponse client] réponse non enregistrée', applicationId, err instanceof Error ? err.message : err)
    return { error: 'La réponse n’a pas pu être enregistrée. Réessayez.' }
  }
}

const ClientInput = z.object({ jobId: id, client: jobClientSchema })

/** Client de l'offre (société, contact, e-mail) pour l'organisation du recruteur ; tout vide : le retire. */
export async function saveJobClientAction(input: unknown): Promise<{ client: JobClient } | { error: string }> {
  const parsed = ClientInput.safeParse(input)
  if (!parsed.success) {
    const emailInvalid = parsed.error.issues.some(i => i.path.includes('email'))
    return { error: emailInvalid ? 'Adresse e-mail du client invalide.' : 'Client invalide : société 200 caractères et contact 120 au plus.' }
  }
  const { jobId, client } = parsed.data
  try {
    const user = await requireRecruiter()
    const job = await getJobById(jobId)
    if (!job || !viewerCanOpenJob(job, await loadOfferViewer(user))) return { error: 'Offre introuvable.' }
    if (!isJobClientsConfigured()) return { error: 'Le client de l’offre n’est pas encore activé : la base doit être mise à jour (collection job_clients). Contactez le support.' }
    await saveJobClient(user.tenantId!, jobId, client)
    revalidatePath(`/recruiter/pipeline/${jobId}/client`)
    return { client }
  } catch (err) {
    console.error('[réponse client] client de l\'offre non enregistré', jobId, err instanceof Error ? err.message : err)
    return { error: 'Le client n’a pas pu être enregistré. Réessayez.' }
  }
}
