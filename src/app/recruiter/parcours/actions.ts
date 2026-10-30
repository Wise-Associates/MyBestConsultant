'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { JourneyConflictError, createJourney, getJourney, updateJourney } from '@/lib/appwrite/consultant-journeys'
import { applyJourneyAction, newJourney, type JourneyAction } from '@/lib/consultant-journey'

// Actions du parcours consultant (ADR 0021). Une Server Action est un point d'entrée POST public : chaque action
// vérifie elle-même le recruteur et que la candidature est de son organisation.

export type JourneyActionResult = { ok: true } | { ok: false; error: string }

const appIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/)

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('advance') }),
  z.object({ type: z.literal('back') }),
  z.object({
    type: z.literal('piece'),
    piece: z.enum(['cv_format', 'envoi_client', 'contrat', 'timesheet', 'facture']),
    status: z.string().min(1).max(20),
  }),
  z.object({ type: z.literal('abandon'), note: z.string().max(500).optional() }),
  z.object({ type: z.literal('resume') }),
])

/** Recruteur connecté et candidature de son organisation ; null sinon (même réponse qu'une candidature absente). */
async function authorize(applicationId: string) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return null
  const { databases } = createAdminClient()
  const application = await databases.getDocument(DB_ID, COLLECTIONS.APPLICATIONS, applicationId).catch(err => {
    if ((err as { code?: number }).code === 404) return null
    throw err
  })
  if (!application || application.tenantId !== user.tenantId) return null
  const actor = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
  return { user, application, actor }
}

function failure(err: unknown, what: string): JourneyActionResult {
  if (err instanceof JourneyConflictError) return { ok: false, error: err.message }
  console.error(`Parcours consultant : ${what} impossible`, err instanceof Error ? err.message : err)
  return { ok: false, error: 'Enregistrement impossible pour le moment. Réessayez dans un instant.' }
}

export async function startConsultantJourneyAction(applicationId: unknown): Promise<JourneyActionResult> {
  const id = appIdSchema.safeParse(applicationId)
  if (!id.success) return { ok: false, error: 'Candidature introuvable.' }
  try {
    const auth = await authorize(id.data)
    if (!auth) return { ok: false, error: 'Candidature introuvable.' }
    await createJourney({
      applicationId: id.data,
      tenantId: auth.user.tenantId as string,
      jobId: auth.application.jobId as string,
      candidateId: auth.application.candidateId as string,
      journey: newJourney(auth.actor, new Date()),
    })
  } catch (err) {
    return failure(err, 'démarrage')
  } finally {
    revalidatePath('/recruiter/parcours')
  }
  revalidatePath(`/recruiter/parcours/${id.data}`)
  return { ok: true }
}

export async function consultantJourneyAction(
  applicationId: unknown, expectedVersion: unknown, action: unknown,
): Promise<JourneyActionResult> {
  const id = appIdSchema.safeParse(applicationId)
  const version = z.number().int().min(1).safeParse(expectedVersion)
  const parsed = actionSchema.safeParse(action)
  if (!id.success) return { ok: false, error: 'Candidature introuvable.' }
  if (!version.success || !parsed.success) return { ok: false, error: 'Action invalide.' }
  try {
    const auth = await authorize(id.data)
    if (!auth) return { ok: false, error: 'Candidature introuvable.' }
    const stored = await getJourney(id.data)
    if (!stored || stored.tenantId !== auth.user.tenantId) return { ok: false, error: 'Parcours introuvable.' }
    if (!stored.journey) return { ok: false, error: 'Ce parcours est illisible : il ne peut pas être modifié.' }
    const result = applyJourneyAction(stored.journey, parsed.data as JourneyAction, auth.actor, new Date())
    if (!result.ok) return result
    await updateJourney(id.data, version.data, result.journey)
  } catch (err) {
    return failure(err, 'action')
  } finally {
    // Aussi après un conflit : la page relue montre la version enregistrée par l'autre recruteur.
    revalidatePath(`/recruiter/parcours/${id.data}`)
  }
  revalidatePath('/recruiter/parcours')
  return { ok: true }
}
