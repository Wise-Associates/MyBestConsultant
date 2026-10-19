import { ID } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { oneMonthFromNow } from '@/lib/appwrite/jobs'

// Création d'une offre publique par l'admin (import d'appels d'offres, publication depuis AO Offers).
// À n'appeler qu'après avoir vérifié que l'appelant est admin.

export interface AdminJobInput {
  title: string
  companyName: string
  location: string
  contractType: 'cdi' | 'cdd' | 'freelance' | 'mission'
  remote: 'onsite' | 'hybrid' | 'remote'
  salary: number | null
  skills: string[]
  description: string
}

/**
 * Crée l'offre (active un mois), puis la diffusion LinkedIn et le sourcing automatiques. Renvoie son $id.
 * `id` fixe l'identifiant : une seconde création avec le même id échoue (409) au lieu de créer un doublon.
 */
export async function createAdminJob(job: AdminJobInput, tenantId: string, id?: string): Promise<string> {
  const { databases } = createAdminClient()
  const { tryAutoPostJobToLinkedIn } = await import('@/lib/linkedin-publish')
  const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
  const doc = await databases.createDocument(DB_ID, COLLECTIONS.JOBS, id ? ID.custom(id) : ID.unique(), {
    tenantId,
    title: job.title,
    description: job.description,
    skills: job.skills.slice(0, 10),
    // "France" was too generic and would silently match any region/city search (it's
    // literally a substring of "Île-de-France"), polluting results. An honest
    // placeholder that doesn't accidentally match real place names is safer.
    location: job.location || 'Non spécifié',
    contractType: job.contractType || 'mission',
    remote: job.remote || 'hybrid',
    salary: job.salary ?? undefined,
    companyName: job.companyName || undefined,
    isActive: true,
    expiresAt: oneMonthFromNow(),
  })
  await tryAutoPostJobToLinkedIn({ ...doc, $id: doc.$id } as never)
  await tryAutoSourceCandidates({ ...doc, $id: doc.$id } as never)
  return doc.$id
}

export async function adminJobExists(id: string): Promise<boolean> {
  const { databases } = createAdminClient()
  try {
    await databases.getDocument(DB_ID, COLLECTIONS.JOBS, id)
    return true
  } catch {
    return false
  }
}
