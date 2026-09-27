'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { ID, Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import type { CvProfile, CvExperience, CvEducation, CvLanguage } from '@/lib/cv-profile-extract'

async function requireRecruiter() {
  const user = await getCurrentUser()
  if (!user || (user.role !== 'recruiter' && user.role !== 'admin')) throw new Error('Non autorisé')
  return user
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
