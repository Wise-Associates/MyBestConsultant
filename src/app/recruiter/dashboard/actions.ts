'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createJob, updateJobStatus, deleteJob, updateApplicationStatus, oneMonthFromNow, getJobsByTenant } from '@/lib/appwrite/jobs'
import type { ApplicationStatus } from '@/types'
import type { Job } from '@/types'

export async function createJobAction(formData: FormData): Promise<{ error?: string }> {
  // Début de la requête : la publication sur les réseaux, en arrière-plan, doit finir avant maxDuration (page.tsx).
  const requestStart = Date.now()
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé' }

  const title = formData.get('title') as string
  const description = formData.get('description') as string
  const location = formData.get('location') as string
  const skillsRaw = formData.get('skills') as string
  const contractType = (formData.get('contractType') as Job['contractType']) || undefined
  const remote = (formData.get('remote') as Job['remote']) || undefined
  const salaryRaw = formData.get('salary') as string
  const salary = salaryRaw ? parseInt(salaryRaw, 10) : undefined

  if (!title || !description || !location) return { error: 'Titre, description et localisation sont requis.' }

  const skills = skillsRaw
    ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : []

  // Durée fixée à 1 mois — réglable uniquement par l'admin pour le moment
  const expiresAt = oneMonthFromNow()

  // Toute la suite était sans filet : la moindre erreur (ex. un salaire non numérique envoyé
  // à Appwrite) remontait telle quelle et affichait l'écran d'erreur générique de Next.js au lieu
  // du message propre du formulaire, alors que l'offre pouvait déjà être créée.
  try {
    const job = await createJob({
      tenantId: user.tenantId,
      title,
      description,
      skills,
      location,
      contractType,
      remote,
      salary: salaryRaw && Number.isFinite(salary) ? salary : undefined,
      companyName: formData.get('companyName') as string || undefined,
      expiresAt,
      // L'offre arrive dans « Mon espace » de celui qui la crée (réaffectable depuis la vue de l'équipe).
      recruiterId: user.userId,
    })

    // Publication sur les réseaux de MyBestConsultant (Make → Buffer) en arrière-plan ; à défaut, ancien auto-post LinkedIn.
    // Puis Sourcing IA automatique (silent failure).
    const { tryAutoPublishJob, deliveryDeadline } = await import('@/lib/social')
    after(() => tryAutoPublishJob(job, deliveryDeadline(requestStart)))
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
    await tryAutoSourceCandidates(job)

    revalidatePath('/recruiter/dashboard')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la création de l’offre.' }
  }
}

// Bibliothèque des anciennes offres — sert de base pour "Créer une offre" (import puis
// modification manuelle ou amélioration par l'IA), plutôt que de repartir de zéro.
export async function listMyJobsForLibrary(): Promise<Job[]> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return []
  return getJobsByTenant(user.tenantId)
}

export async function toggleJobStatusAction(jobId: string, isActive: boolean): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return
  await updateJobStatus(jobId, isActive)
  revalidatePath('/recruiter/dashboard')
}

export async function deleteJobAction(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return
  await deleteJob(jobId)
  revalidatePath('/recruiter/dashboard')
}

// Décision du recruteur sur une candidature — reflétée immédiatement sur le
// tableau de bord du candidat (retenu / refusé / vivier).
export async function setApplicationStatusAction(applicationId: string, status: ApplicationStatus): Promise<void> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter') return
  await updateApplicationStatus(applicationId, status)
  revalidatePath('/recruiter/dashboard')
  revalidatePath('/candidate/dashboard')
}

// Diffusion d'une offre sur les réseaux de la plateforme — relance manuelle, réservée aux
// offres du recruteur. « Republier » n'est permis que si la précédente diffusion est terminée
// (jamais pendant qu'elle est encore en cours, pour ne rien publier en double).
export async function publishJobToSocialAction(jobId: string, again = false): Promise<{ ok: boolean; message: string }> {
  const requestStart = Date.now()
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { ok: false, message: 'Non autorisé.' }
  try {
    const { getJobById } = await import('@/lib/appwrite/jobs')
    const job = await getJobById(jobId)
    if (!job || job.tenantId !== user.tenantId) return { ok: false, message: 'Offre introuvable.' }
    const { latestPostsByJob, prepareSocialPost, deliverSocialPost, deliveryDeadline } = await import('@/lib/social')
    const last = (await latestPostsByJob(user.tenantId))[jobId]
    const finished = !last || last.stale || ['published', 'partial', 'failed'].includes(last.status)
    if (!finished) return { ok: false, message: 'La diffusion est déjà en cours.' }
    const r = await prepareSocialPost(jobId, { trigger: 'manual', requestedBy: `${user.firstName} ${user.lastName}`.trim() || user.email, force: again })
    revalidatePath('/recruiter/dashboard')
    if (r.error) return { ok: false, message: r.error }
    if (r.skipped || !r.id) return { ok: true, message: 'Cette offre est déjà diffusée.' }
    // Photo de l'affiche (jusqu'à 2 min) puis envoi à Make, après la réponse : la pastille suit l'avancement.
    const id = r.id
    after(() => deliverSocialPost(id, deliveryDeadline(requestStart)))
    return { ok: true, message: 'Diffusion lancée : le visuel est en cours de création.' }
  } catch (e) {
    console.error('[social] diffusion non préparée', jobId, e instanceof Error ? e.message : e)
    return { ok: false, message: 'La diffusion n’a pas pu être préparée. Réessayez dans quelques minutes.' }
  }
}
