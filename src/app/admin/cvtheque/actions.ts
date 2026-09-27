'use server'

import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { revalidatePath } from 'next/cache'
import type { CvProfile } from '@/lib/cv-profile-extract'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

export interface CvThequeCandidate {
  $id: string
  name: string
  email: string
  phone: string
  city: string
  mobilityRadiusKm: number | null
  skills: string[]
  experienceSummary: string
  cvFileId: string | null
  scannedAt: string | null
  photoUrl: string
  openToWork: boolean
  desiredSector: string[]
  desiredRoles: string[]
}

export async function getCvthequeCandidates(): Promise<{ candidates: CvThequeCandidate[]; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()
    const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
      Query.equal('role', 'candidate'),
      Query.limit(500),
    ])

    const candidates: CvThequeCandidate[] = res.documents.map(d => {
      const profile: Partial<CvProfile> = d.cvProfileJson ? JSON.parse(d.cvProfileJson as string) : {}
      return {
        $id: d.$id,
        name: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
        email: (d.email as string) ?? '',
        phone: (d.phone as string) ?? '',
        city: (d.city as string) ?? '',
        mobilityRadiusKm: (d.mobilityRadiusKm as number) ?? null,
        skills: profile.skills ?? [],
        experienceSummary: profile.experienceSummary ?? '',
        cvFileId: (d.cvFileId as string) ?? null,
        scannedAt: profile.extractedAt ?? null,
        photoUrl: (d.photoUrl as string) ?? '',
        openToWork: (d.openToWork as boolean) ?? true,
        desiredSector: d.desiredSector ? (d.desiredSector as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        desiredRoles: d.desiredRoles ? (d.desiredRoles as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      }
    })

    return { candidates }
  } catch (e) {
    return { candidates: [], error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function scanCandidateCv(candidateId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId)
    const cvFileId = doc.cvFileId as string | undefined
    if (!cvFileId) return { error: 'Ce candidat n\'a pas encore de CV' }

    const { extractCvProfile } = await import('@/lib/cv-profile-extract')
    const profile = await extractCvProfile(cvFileId)
    if (!profile) return { error: 'Impossible d\'extraire les informations de ce CV' }

    const existing: Partial<CvProfile> = doc.cvProfileJson ? JSON.parse(doc.cvProfileJson as string) : {}
    await databases.updateDocument(DB_ID, COLLECTIONS.USERS, candidateId, {
      cvProfileJson: JSON.stringify({ ...existing, ...profile }),
    })

    revalidatePath('/admin/cvtheque')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors du scan' }
  }
}
