'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createJob, updateJobStatus, updateJobFields, deleteJob, oneMonthFromNow, getJobsByTenant, getJobById } from '@/lib/appwrite/jobs'
import { checkAssignee, notifyAssigneeWarning, setAoAssignee, setJobRecruiter } from '@/lib/recruiter-assignment'
import { shouldNotifyAssignee } from '@/lib/assignment-email'
import { jobOwnership, viewerCanOpenJob } from '@/lib/job-ownership'
import { loadOfferViewer } from '@/lib/offer-viewer'
import { PAY_NEEDS_CONTRACT } from '@/lib/job-pay'
import { aoAccessFor } from '@/lib/ao/platform-view'
import { activeJobsLimitDenial } from '@/lib/tenant-access'
import { deleteJobClients } from '@/lib/appwrite/job-clients'
import { deleteWeightsOfJob } from '@/lib/scoring-weights-store'
import type { Job } from '@/types'

export async function createJobAction(formData: FormData): Promise<{ error?: string; jobId?: string }> {
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
  // Le contrat fixe l'unité du montant (TJM ou salaire annuel, job-pay.ts) : sans lui, elle serait devinée.
  if (salaryRaw && Number.isFinite(salary) && !contractType) return { error: PAY_NEEDS_CONTRACT }

  const skills = skillsRaw
    ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : []

  // Durée fixée à 1 mois — réglable uniquement par l'admin pour le moment
  const expiresAt = oneMonthFromNow()

  // Toute la suite était sans filet : la moindre erreur (ex. un salaire non numérique envoyé
  // à Appwrite) remontait telle quelle et affichait l'écran d'erreur générique de Next.js au lieu
  // du message propre du formulaire, alors que l'offre pouvait déjà être créée.
  try {
    // Limite d'offres actives de la formule de l'organisation (plans.ts) ; aucune pour les formules standard.
    const limited = await activeJobsLimitDenial(user.tenantId)
    if (limited) return { error: limited }
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
      // Affectée à celui qui la crée (réaffectable dans « Mes offres »).
      ...jobOwnership(user),
    })

    // Publication sur les réseaux de MyBestConsultant (Make → Buffer) en arrière-plan ; à défaut, ancien auto-post LinkedIn.
    // Puis Sourcing IA automatique (silent failure).
    const { tryAutoPublishJob, deliveryDeadline } = await import('@/lib/social')
    after(() => tryAutoPublishJob(job, deliveryDeadline(requestStart)))
    const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
    await tryAutoSourceCandidates(job)

    revalidatePath('/recruiter/dashboard')
    // Identifiant de l'offre créée : la page « Publier un job » ouvre son détail.
    return { jobId: job.$id }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de la création de l’offre.' }
  }
}

// Bibliothèque des anciennes offres — sert de base pour "Créer une offre" (import puis
// modification manuelle ou amélioration par l'IA), plutôt que de repartir de zéro.
export async function listMyJobsForLibrary(): Promise<Job[]> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return []
  // Un membre : ses offres seulement (ADR 0043).
  const viewer = await loadOfferViewer(user)
  return (await getJobsByTenant(user.tenantId)).filter(job => viewerCanOpenJob(job, viewer))
}

// Archiver, remettre en ligne ou supprimer : seulement une offre de l'organisation du recruteur (les offres partagées
// de la plateforme, tenantId '', sont gérées par l'admin), et pour un membre une offre qui lui est affectée (ADR 0043).
// Avant, toute offre était modifiable par son identifiant.
async function ownJobOrError(jobId: unknown): Promise<{ jobId: string; job: Job } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Non autorisé.' }
  if (typeof jobId !== 'string' || !jobId) return { error: 'Offre introuvable.' }
  const job = await getJobById(jobId)
  if (!job || job.tenantId !== user.tenantId || !viewerCanOpenJob(job, await loadOfferViewer(user))) return { error: 'Offre introuvable.' }
  return { jobId, job }
}

export async function toggleJobStatusAction(jobId: string, isActive: boolean): Promise<{ error?: string }> {
  const own = await ownJobOrError(jobId)
  if ('error' in own) return own
  if (typeof isActive !== 'boolean') return { error: 'Demande invalide.' }
  try {
    // Remettre en ligne une offre archivée compte dans la limite d'offres actives de la formule (plans.ts).
    if (isActive && !own.job.isActive) {
      const limited = await activeJobsLimitDenial(own.job.tenantId)
      if (limited) return { error: limited }
    }
    await updateJobStatus(own.jobId, isActive)
  } catch (e) {
    console.error('[dashboard] statut de l’offre non modifié', own.jobId, e instanceof Error ? e.message : e)
    return { error: 'L’offre n’a pas pu être modifiée. Réessayez.' }
  }
  revalidatePath('/recruiter/dashboard')
  return {}
}

// Champs d'une offre que le recruteur modifie (« Modifier » de « Mes offres » et du détail de l'offre). Ni le statut
// (archiver / remettre en ligne, avec la limite de la formule) ni l'expiration (admin seulement) : réglés ailleurs.
// Tailles : celles des attributs de `jobs` (appwrite.config.json).
const JobEdit = z.object({
  title: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(1000).optional(),
  location: z.string().trim().min(1).max(200),
  contractType: z.enum(['cdi', 'cdd', 'freelance', 'mission']).optional(),
  remote: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  salary: z.number().int().min(0).max(100_000_000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(100)).max(10),
  description: z.string().trim().min(1).max(65_535),
})

/**
 * Modification d'une offre de l'organisation par un recruteur. Avant le 2026-11-17, la fenêtre appelait l'action de
 * l'admin (`updateJob`, réservée aux admins) : l'enregistrement échouait toujours pour un recruteur.
 */
export async function updateOwnJobAction(jobId: unknown, input: unknown): Promise<{ error?: string }> {
  const own = await ownJobOrError(jobId)
  if ('error' in own) return own
  const parsed = JobEdit.safeParse(input)
  if (!parsed.success) return { error: 'Vérifiez le titre, la localisation et la description (obligatoires).' }
  const data = parsed.data
  if (data.salary && !data.contractType) return { error: PAY_NEEDS_CONTRACT }
  try {
    await updateJobFields(own.jobId, { ...data, companyName: data.companyName || null, salary: data.salary ?? null })
  } catch (e) {
    console.error('[dashboard] offre non modifiée', own.jobId, e instanceof Error ? e.message : e)
    return { error: 'L’offre n’a pas pu être modifiée. Réessayez.' }
  }
  revalidatePath('/recruiter/dashboard')
  revalidatePath(`/recruiter/offres/${own.jobId}`)
  revalidatePath('/jobs')
  return {}
}

export async function deleteJobAction(jobId: string): Promise<{ error?: string }> {
  const own = await ownJobOrError(jobId)
  if ('error' in own) return own
  try {
    await deleteJob(own.jobId)
    await deleteJobClients(own.jobId) // contact du client effacé avec l'offre (ne lève jamais)
    await deleteWeightsOfJob(own.jobId) // poids du matching réglés pour l'offre (ne lève jamais)
  } catch (e) {
    console.error('[dashboard] offre non supprimée', own.jobId, e instanceof Error ? e.message : e)
    return { error: 'L’offre n’a pas pu être supprimée. Réessayez.' }
  }
  revalidatePath('/recruiter/dashboard')
  return {}
}

const ASSIGN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/**
 * Affecte une offre de l'organisation à un de ses recruteurs (`recruiterId` = son profil, users.$id ; vide : personne).
 * Offre publiée depuis un appel
 * d'offres (identifiant « ao<offre> ») : l'AO d'origine reçoit le même recruteur. Une offre créée au tableau de bord n'a
 * pas d'AO : seule l'offre change. Le nouveau recruteur est prévenu par e-mail, celui qui affecte en copie.
 */
export async function assignJobAction(jobId: unknown, recruiterId: unknown): Promise<{ error?: string; warning?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : reconnectez-vous.' }
  if (typeof jobId !== 'string' || !ASSIGN_ID.test(jobId) || typeof recruiterId !== 'string' || (recruiterId && !ASSIGN_ID.test(recruiterId))) {
    return { error: 'Affectation invalide.' }
  }
  const warnings: string[] = []
  try {
    const refused = await checkAssignee(user.tenantId, recruiterId)
    if (refused) return { error: refused }
    // Lue avant : recruteur d'avant (pas d'e-mail s'il ne change pas), intitulé et ville pour l'e-mail.
    const job = await getJobById(jobId)
    if (!job || job.tenantId !== user.tenantId || !viewerCanOpenJob(job, await loadOfferViewer(user))) return { error: 'Offre introuvable.' }
    if (!(await setJobRecruiter(user.tenantId, jobId, recruiterId))) return { error: 'Offre introuvable.' }
    if (jobId.startsWith('ao')) {
      const offerId = jobId.slice(2)
      try {
        // Contrôle redoublé : l'AO doit venir d'une boîte de l'organisation (l'offre l'est déjà).
        if (await aoAccessFor(user.tenantId).offer(offerId)) {
          await setAoAssignee(offerId, recruiterId)
          revalidatePath(`/recruiter/parametres/boites-ao/${offerId}`)
        }
      } catch (err) {
        console.error('[dashboard] recruteur de l’AO d’origine non mis à jour', jobId, err instanceof Error ? err.message : err)
        warnings.push('Recruteur affecté à l’offre, mais pas à l’appel d’offres d’origine : réessayez dans un instant.')
      }
    }
    if (shouldNotifyAssignee(job.recruiterId ?? '', recruiterId, user.$id)) {
      const warning = await notifyAssigneeWarning({
        tenantId: user.tenantId, assigneeId: recruiterId, assignerUserId: user.userId,
        assignerName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
        kind: 'job', title: job.title, location: job.location, path: `/recruiter/pipeline/${encodeURIComponent(jobId)}/matching`,
      })
      if (warning) warnings.push(warning)
    }
  } catch (err) {
    console.error('[dashboard] affectation impossible', jobId, err instanceof Error ? err.message : err)
    return { error: 'Affectation impossible pour le moment. Réessayez dans un instant.' }
  }
  revalidatePath('/recruiter/dashboard')
  return warnings.length ? { warning: warnings.join(' ') } : {}
}

// Diffusion d'une offre sur les réseaux de la plateforme — relance manuelle, réservée aux
// offres du recruteur. « Republier » n'est permis que si la précédente diffusion est terminée
// (jamais pendant qu'elle est encore en cours, pour ne rien publier en double).
export async function publishJobToSocialAction(jobId: string, again = false): Promise<{ ok: boolean; message: string }> {
  const requestStart = Date.now()
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { ok: false, message: 'Non autorisé.' }
  try {
    const job = await getJobById(jobId)
    if (!job || job.tenantId !== user.tenantId || !viewerCanOpenJob(job, await loadOfferViewer(user))) return { ok: false, message: 'Offre introuvable.' }
    const { latestSocialStateByJob, prepareSocialPost, deliverSocialPost, deliveryDeadline } = await import('@/lib/social')
    const last = (await latestSocialStateByJob([jobId])).get(jobId)
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
