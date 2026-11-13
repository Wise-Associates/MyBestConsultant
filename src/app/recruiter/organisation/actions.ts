'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { LIMITS, isLogoFileUrl } from '@/lib/brand'
import { roleOf, teamActionDenial } from '@/lib/team-roles'

// Nom et logo de l'organisation (/recruiter/organisation, ADR 0033) : propriétaire et administrateurs seulement,
// organisation de la session. Le slug (adresse de la page publique) ne change jamais : les liens déjà partagés restent
// bons. Le logo est envoyé par uploadBrandImageAction (marque employeur, même bucket) ; seule une adresse de ce bucket
// est acceptée ici.

const inputSchema = z.object({
  name: z.string().trim().min(2, 'Le nom de l’organisation est requis (2 caractères au moins).').max(LIMITS.name, `Nom limité à ${LIMITS.name} caractères.`),
  logoUrl: z.string().trim().max(500),
})

/** Adresse d'un fichier du bucket des logos du projet ('' : pas de logo). */
function ownLogoUrl(url: string): boolean {
  return url === '' || isLogoFileUrl(url, process.env.APPWRITE_ENDPOINT ?? '', BUCKETS.LOGOS)
}

export async function saveOrganisationAction(input: unknown): Promise<{ name?: string; logoUrl?: string; error?: string }> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Nom ou logo invalide.' }
  if (!ownLogoUrl(parsed.data.logoUrl)) return { error: 'Logo invalide : envoyez de nouveau l’image.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  try {
    const { databases } = createAdminClient()
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>
    const denied = teamActionDenial(roleOf(user.userId, tenant), 'editOrganisation')
    if (denied) return { error: denied }
    const doc = await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId, { name: parsed.data.name, logoUrl: parsed.data.logoUrl })
    revalidatePath('/recruiter/organisation')
    revalidatePath('/recruiter/marque-employeur')
    revalidatePath('/entreprises')
    revalidatePath(`/entreprises/${doc.slug as string}`)
    return { name: parsed.data.name, logoUrl: parsed.data.logoUrl }
  } catch (err) {
    console.error('[organisation] enregistrement impossible', err instanceof Error ? err.message : String(err))
    return { error: 'Enregistrement impossible pour le moment : réessayez dans quelques instants.' }
  }
}
