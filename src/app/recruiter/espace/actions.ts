'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { checkAssignee, setAoAssignee, setJobRecruiter } from '@/lib/recruiter-assignment'

// Actions de « Mon espace » (demande de Dav du 2026-10-31). Une Server Action est un point d'entrée public : le
// recruteur et l'organisation de l'offre sont vérifiés ici.

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/** Affecte une offre de l'organisation à un de ses recruteurs (`userId` vide : personne). */
export async function assignJobAction(jobId: unknown, userId: unknown): Promise<{ error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : reconnectez-vous.' }
  if (typeof jobId !== 'string' || !ID.test(jobId) || typeof userId !== 'string' || (userId && !ID.test(userId))) {
    return { error: 'Affectation invalide.' }
  }
  try {
    const refused = await checkAssignee(user.tenantId, userId)
    if (refused) return { error: refused }
    if (!(await setJobRecruiter(user.tenantId, jobId, userId))) return { error: 'Offre introuvable.' }
    // Offre publiée depuis un AO (identifiant « ao<offre> ») : la page de l'AO montre le même recruteur.
    if (jobId.startsWith('ao')) {
      await setAoAssignee(jobId.slice(2), userId).catch(err => {
        console.error('Mon espace : recruteur de l\'AO non mis à jour', jobId, err instanceof Error ? err.message : err)
      })
    }
  } catch (err) {
    console.error('Mon espace : affectation impossible', jobId, err instanceof Error ? err.message : err)
    return { error: 'Affectation impossible pour le moment. Réessayez dans un instant.' }
  }
  revalidatePath('/recruiter/espace')
  return {}
}
