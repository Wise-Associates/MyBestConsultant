'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import type { CvProfile, CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'
import { cvExportErrorName, isCvExportStorageConfigured, loadCvExportVersions, type CvExportVersions } from '@/lib/cv-export/store'
import { getEsnTemplateInfo } from '@/lib/cv-export/templates'
import { CANDIDATE_ID } from '@/lib/cv-export/stored'
import { templateUploadDenial } from '@/lib/cv-export/access'
import { organisationName, takeTemplateSlot } from '@/lib/cv-export/recruiter'
import { readTemplateUpload, removeTemplate, saveUploadedTemplate } from '@/lib/cv-export/template-upload'

async function requireRecruiter() {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin')) throw new Error('Non autorisé')
  return user
}

/** Versions « Format ESN » enregistrées par l'organisation du recruteur pour un candidat (organisation de la session). */
export async function getRecruiterCvExportVersions(candidateId: string): Promise<CvExportVersions> {
  const storage = isCvExportStorageConfigured()
  const user = await getCurrentUser()
  // Message rendu plutôt que levé : une erreur levée par une action serveur est masquée en production.
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { versions: [], storage, error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  if (!CANDIDATE_ID.test(candidateId)) return { versions: [], storage, error: 'Candidat introuvable.' }
  let templateUploadedAt = ''
  try {
    templateUploadedAt = (await getEsnTemplateInfo(user.tenantId))?.uploadedAt ?? ''
  } catch (err) {
    // Sans la date du modèle, une version antérieure à son remplacement n'est simplement pas signalée.
    console.error('[cv-export] date du modèle illisible', user.tenantId, cvExportErrorName(err))
  }
  return loadCvExportVersions(user.tenantId, candidateId, templateUploadedAt)
}

const RECRUITER_SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'

/** Recruteur rattaché à une organisation (celle de la session : jamais lue dans le formulaire) ; null sinon. */
async function recruiterOfSession() {
  const user = await getCurrentUser()
  return user && user.role === 'recruiter' && user.tenantId ? { user, tenantId: user.tenantId } : null
}

/** Pages du bouton « Modèle CV » et de « Format ESN » : la CV Thèque et le vivier (index et viviers des offres). */
function revalidateTemplatePages() {
  revalidatePath('/recruiter/cvtheque')
  revalidatePath('/recruiter/vivier', 'layout')
}

/**
 * Dépose le modèle Word de l'organisation (.docx seul, cartographié par l'IA : ADR 0014), à la place du précédent. Tout
 * recruteur de l'organisation (décision du 2026-10-24), à l'adresse e-mail vérifiée, dans les quotas du jour (ADR 0010).
 */
export async function saveRecruiterCvTemplate(formData: FormData): Promise<{ error?: string }> {
  const current = await recruiterOfSession()
  if (!current) return { error: RECRUITER_SESSION_EXPIRED }
  const denied = templateUploadDenial({ emailVerified: current.user.emailVerification })
  if (denied) return { error: denied }
  const files = readTemplateUpload(formData)
  if ('error' in files) return files
  const now = new Date()
  let refused: string | null
  let esn: string
  try {
    // Nom lu avant de prendre la place du quota : une lecture qui échoue ne la consomme pas.
    esn = await organisationName(current.tenantId)
    refused = await takeTemplateSlot('upload', current.tenantId, now)
  } catch (err) {
    console.error('[cv-export] quota de dépôt de modèle ou organisation illisible', current.tenantId, cvExportErrorName(err))
    return { error: 'Dépôt impossible pour le moment : réessayez dans quelques instants.' }
  }
  if (refused) return { error: refused }
  const res = await saveUploadedTemplate({ tenantId: current.tenantId, esn, files, uploadedBy: current.user.userId, now })
  if (!res.error) revalidateTemplatePages()
  return res
}

/** Retire le modèle de l'organisation : « Format ESN » disparaît de sa CV Thèque ; les versions enregistrées restent. */
export async function deleteRecruiterCvTemplate(): Promise<{ error?: string }> {
  const current = await recruiterOfSession()
  if (!current) return { error: RECRUITER_SESSION_EXPIRED }
  const res = await removeTemplate(current.tenantId)
  if (!res.error) revalidateTemplatePages()
  return res
}

// Fetched on demand when a candidate's profile modal opens, rather than joined into the
// bulk candidate list above — avoids one extra query per row for a section most rows
// won't even have data for yet.
export async function getCandidateRecommendationsAction(candidateId: string) {
  await requireRecruiter()
  const { getSubmittedRecommendations } = await import('@/lib/appwrite/recommendations')
  return getSubmittedRecommendations(candidateId)
}

export interface CvThequeCandidate {
  $id: string
  name: string
  email: string
  phone: string
  whatsapp: string
  city: string
  mobilityRadiusKm: number | null
  skills: string[]
  experienceSummary: string
  experiences: CvExperience[]
  education: CvEducation[]
  languages: CvLanguage[]
  yearsOfExperience: number | null
  cvFileId: string | null
  photoUrl: string
  openToWork: boolean
  desiredSector: string[]
  desiredRoles: string[]
  createdAt: string
}

export async function getRecruiterCvthequeCandidates(): Promise<{ candidates: CvThequeCandidate[]; error?: string }> {
  try {
    await requireRecruiter()
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('role', 'candidate'),
      Query.limit(500),
    ])

    const candidates: CvThequeCandidate[] = res.documents
      .filter(d => d.cvFileId) // recruiters only see candidates with a usable CV on file
      .map(d => {
        const profile: Partial<CvProfile> = d.cvProfileJson ? JSON.parse(d.cvProfileJson as string) : {}
        return {
          $id: d.$id,
          name: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
          email: (d.email as string) ?? '',
          phone: (d.phone as string) ?? '',
          whatsapp: (d.whatsapp as string) ?? '',
          city: (d.city as string) ?? '',
          mobilityRadiusKm: (d.mobilityRadiusKm as number) ?? null,
          skills: profile.skills ?? [],
          experienceSummary: profile.experienceSummary ?? '',
          experiences: profile.experiences ?? [],
          education: profile.education ?? [],
          languages: profile.languages ?? [],
          yearsOfExperience: profile.yearsOfExperience ?? null,
          cvFileId: (d.cvFileId as string) ?? null,
          photoUrl: (d.photoUrl as string) ?? '',
          openToWork: (d.openToWork as boolean) ?? true,
          desiredSector: d.desiredSector ? (d.desiredSector as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
          desiredRoles: d.desiredRoles ? (d.desiredRoles as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
          createdAt: d.$createdAt as string,
        }
      })

    return { candidates }
  } catch (e) {
    return { candidates: [], error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

// Envoie un message pro directement depuis la fiche CVthèque — remplace le mailto: qui
// ouvrait le client mail local du recruteur, sans trace ni template de marque.
export async function sendCvthequeCandidateMessage(params: {
  candidateEmail: string
  subject: string
  message: string
}): Promise<{ ok?: boolean; error?: string }> {
  await requireRecruiter()

  try {
    const { users, messaging } = createAdminClient()
    const found = await users.list([Query.equal('email', [params.candidateEmail])])
    const candidateAuthId = found.users[0]?.$id
    if (!candidateAuthId) return { error: 'Aucun compte candidat associé à cet email' }

    const bodyHtml = params.message
      .split('\n')
      .map(line => `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#45454A;">${line || '&nbsp;'}</p>`)
      .join('')

    const { wrapEmailHtml } = await import('@/lib/email-template')
    await messaging.createEmail(
      ID.unique(),
      params.subject,
      wrapEmailHtml(params.subject, bodyHtml),
      [], [candidateAuthId], [], [], [], [], false, true,
    )
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'envoi' }
  }
}
