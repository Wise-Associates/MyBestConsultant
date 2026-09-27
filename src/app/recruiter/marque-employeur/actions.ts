'use server'

import { revalidatePath } from 'next/cache'
import { ID } from 'node-appwrite'
import { InputFile } from 'node-appwrite/file'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { canPublish, cleanUrl, LIMITS, sanitizeBrand, type BrandProfile } from '@/lib/brand'

// Toute l'équipe du recruteur (propriétaire + collaborateurs invités) peut éditer la page
// employeur : c'est un contenu de communication partagé, pas un réglage de compte.
async function requireTeamMember() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Error('Non autorisé')
  return { ...user, tenantId: user.tenantId }
}

export async function saveBrandAction(input: {
  name: string
  logoUrl: string
  brand: unknown
  published: boolean
}): Promise<{ error?: string; brand?: BrandProfile; name?: string; logoUrl?: string; published?: boolean; publishError?: string }> {
  try {
    const user = await requireTeamMember()
    const name = (input.name ?? '').trim().slice(0, LIMITS.name)
    if (name.length < 2) return { error: 'Le nom de l’entreprise est requis.' }
    const brand = sanitizeBrand(input.brand)
    const logoUrl = cleanUrl(input.logoUrl)

    // Publication impossible (page trop vide) : on ENREGISTRE quand même tout le reste — rien n'est perdu —
    // mais la page reste en brouillon et l'écran explique pourquoi.
    let published = input.published
    let publishError: string | undefined
    if (published) {
      const problem = canPublish(brand)
      if (problem) { published = false; publishError = problem }
    }

    const { databases } = createAdminClient()
    const doc = await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId, {
      name, logoUrl, brandJson: JSON.stringify(brand), brandPublished: published,
    })
    revalidatePath('/entreprises')
    revalidatePath(`/entreprises/${doc.slug as string}`)
    revalidatePath('/recruiter/marque-employeur')
    return { brand, name, logoUrl, published, publishError }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l’enregistrement' }
  }
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // plafond du bucket Logos

export async function uploadBrandImageAction(formData: FormData): Promise<{ url?: string; error?: string }> {
  try {
    await requireTeamMember()
    const file = formData.get('file')
    if (!(file instanceof File)) return { error: 'Aucun fichier reçu' }
    if (!IMAGE_TYPES.includes(file.type)) return { error: 'Format non supporté (JPG, PNG ou WebP)' }
    if (file.size > MAX_IMAGE_BYTES) return { error: 'Image trop lourde (2 Mo maximum)' }

    const { storage } = createAdminClient()
    const uploaded = await storage.createFile(BUCKETS.LOGOS, ID.unique(), InputFile.fromBuffer(Buffer.from(await file.arrayBuffer()), file.name))
    const endpoint = process.env.APPWRITE_ENDPOINT!
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!
    return { url: `${endpoint}/storage/buckets/${BUCKETS.LOGOS}/files/${uploaded.$id}/view?project=${projectId}` }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Échec de l’envoi de l’image' }
  }
}
