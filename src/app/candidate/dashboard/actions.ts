'use server'

import { normalizeWhatsApp } from '@/lib/whatsapp'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import type { CvProfile } from '@/lib/cv-profile-extract'

export async function saveCvFileId(fileId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) return

  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.USERS, user.$id, {
    cvFileId: fileId,
  })

  // Best-effort: pre-fill the candidate's profile (skills, experience) from their CV.
  // Must never break the upload flow if extraction fails.
  try {
    const { extractCvProfile } = await import('@/lib/cv-profile-extract')
    const profile = await extractCvProfile(fileId)
    if (profile) {
      await databases.updateDocument(DB_ID, COLLECTIONS.USERS, user.$id, {
        cvProfileJson: JSON.stringify(profile),
      })
    }
  } catch { /* profile stays as-is — candidate can still fill it in manually */ }

  revalidatePath('/candidate/dashboard')
}

export async function updateCandidateProfile(data: {
  phone: string
  /** Numéro WhatsApp saisi librement ; vide = ne pas être contacté sur WhatsApp. */
  whatsapp?: string
  city: string
  mobilityRadiusKm: number | null
  skills: string[]
  experienceSummary: string
  openToWork: boolean
  desiredSector: string[]
  desiredRoles: string[]
  photoUrl: string
  linkedinUrl: string
}): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Non connecté' }

  // Numéro WhatsApp : normalisé au format international, ou refusé avec un message clair.
  const wa = normalizeWhatsApp(data.whatsapp ?? '')
  if (wa.error) return { error: wa.error }

  try {
    const { databases } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, user.$id)
    const existing: Partial<CvProfile> = doc.cvProfileJson ? JSON.parse(doc.cvProfileJson as string) : {}

    await databases.updateDocument(DB_ID, COLLECTIONS.USERS, user.$id, {
      phone: data.phone || null,
      whatsapp: wa.e164 || null,
      city: data.city || null,
      mobilityRadiusKm: data.mobilityRadiusKm,
      cvProfileJson: JSON.stringify({ ...existing, skills: data.skills, experienceSummary: data.experienceSummary }),
      openToWork: data.openToWork,
      desiredSector: data.desiredSector.length > 0 ? data.desiredSector.join(', ') : null,
      desiredRoles: data.desiredRoles.join(', '),
      photoUrl: data.photoUrl || null,
      linkedinUrl: data.linkedinUrl || null,
    })
    revalidatePath('/candidate/dashboard')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement' }
  }
}

// Best-effort: LinkedIn serves an Open Graph preview image (og:image) on public profile
// pages for link-unfurling (Slack, WhatsApp, etc. all rely on this). We reuse that same
// public, unauthenticated signal — never scraping the logged-in profile — so it can fail
// silently (private profile, rate limit, layout change) without breaking the form.
export async function fetchLinkedinPhoto(linkedinUrl: string): Promise<{ photoUrl?: string; error?: string }> {
  try {
    const url = new URL(linkedinUrl)
    if (!url.hostname.includes('linkedin.com')) return { error: 'URL LinkedIn invalide' }

    const res = await fetch(linkedinUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyBestConsultantBot/1.0; +https://mybestconsultant.fr)' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { error: 'Profil introuvable ou privé' }

    const html = await res.text()
    const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
      ?? html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i)
    if (!match) return { error: 'Aucune photo publique trouvée sur ce profil' }

    // LinkedIn's CDN URL can expire or block hotlinking — copy it into our own storage.
    const imgRes = await fetch(match[1], { signal: AbortSignal.timeout(8000) })
    if (!imgRes.ok) return { error: 'Photo trouvée mais impossible à télécharger' }
    const buffer = Buffer.from(await imgRes.arrayBuffer())

    const { storage } = createAdminClient()
    const { InputFile } = await import('node-appwrite/file')
    const { ID } = await import('node-appwrite')
    const { BUCKETS } = await import('@/lib/appwrite/config')
    const file = await storage.createFile(BUCKETS.LOGOS, ID.unique(), InputFile.fromBuffer(buffer, 'linkedin-photo.jpg'))

    const endpoint = process.env.APPWRITE_ENDPOINT!
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
    const photoUrl = `${endpoint}/storage/buckets/${BUCKETS.LOGOS}/files/${file.$id}/view?project=${projectId}`

    return { photoUrl }
  } catch {
    return { error: 'Récupération impossible — ajoutez votre photo manuellement' }
  }
}

// Best-effort: extract an embedded photo directly from the candidate's own CV
// file (PDF/DOCX). Picks the largest embedded image as a heuristic for "the
// headshot" — small icons/logos/dividers are typically far smaller. Never
// breaks the form if extraction fails or the CV has no embedded image.
export async function fetchPhotoFromCV(): Promise<{ photoUrl?: string; error?: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Non connecté' }

  try {
    const { databases, storage } = createAdminClient()
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, user.$id)
    const cvFileId = doc.cvFileId as string | undefined
    if (!cvFileId) return { error: 'Aucun CV sur votre profil' }

    const { BUCKETS } = await import('@/lib/appwrite/config')
    const bytes = await storage.getFileDownload(BUCKETS.CVS, cvFileId)
    const buffer = Buffer.from(bytes)

    const { parseOffice } = await import('officeparser')
    const ast = await parseOffice(buffer, { extractAttachments: true })
    const images = (ast.attachments ?? []).filter(a => a.type === 'image')
    if (images.length === 0) return { error: 'Aucune photo trouvée dans ce CV' }

    const largest = images.reduce((a, b) => (b.data.length > a.data.length ? b : a))
    const imgBuffer = Buffer.from(largest.data, 'base64')

    const { InputFile } = await import('node-appwrite/file')
    const { ID } = await import('node-appwrite')
    const file = await storage.createFile(BUCKETS.LOGOS, ID.unique(), InputFile.fromBuffer(imgBuffer, `cv-photo.${largest.extension || 'jpg'}`))

    const endpoint = process.env.APPWRITE_ENDPOINT!
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
    const photoUrl = `${endpoint}/storage/buckets/${BUCKETS.LOGOS}/files/${file.$id}/view?project=${projectId}`

    return { photoUrl }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Extraction impossible — ajoutez votre photo manuellement' }
  }
}
