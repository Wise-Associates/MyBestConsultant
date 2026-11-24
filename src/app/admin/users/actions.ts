'use server'

import { deleteJudgementsOfCandidate } from '@/lib/criteria-judgements-store'
import { deleteSavedSearchesOf } from '@/lib/saved-searches-store'
import { deleteJobMatchesOfCandidate } from '@/lib/ai-matches-store'
import { deleteAlertsAboutCandidate } from '@/lib/recruiter-alerts-store'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import { getCurrentUser, createUserAccountAndProfile } from '@/lib/appwrite/auth'
import { deleteAssistantTurnsForUser, isAssistantStorageConfigured } from '@/lib/assistant/host'
import { deleteMbcSearchesForUser } from '@/lib/mbc-search/history-store'
import { deleteSavedPeopleForUser } from '@/lib/mbc-search/saved-store'
import { deleteWeightsOfUser } from '@/lib/scoring-weights-store'
import { cvExportErrorName, deleteCvExportsForCandidate, isCvExportStorageConfigured, isCvExportStorageMissing } from '@/lib/cv-export/store'
import { revalidatePath } from 'next/cache'
import { deleteClassification } from '@/lib/appwrite/cv-classifications'
import type { UserRole } from '@/types'

async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') throw new Error('Non autorisé')
  return user
}

export interface AdminUserRow {
  authId: string
  profileId: string | null
  firstName: string
  lastName: string
  email: string
  role: UserRole
  tenantId: string | null
  companyName: string | null
  status: boolean
  createdAt: string
}

export async function listAllUsers(): Promise<{ users: AdminUserRow[]; tenants: Record<string, string>; error?: string }> {
  try {
    await requireAdmin()
    const { databases, users } = createAdminClient()

    const [authRes, profileRes, tenantsRes] = await Promise.all([
      users.list([Query.limit(500)]),
      databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.limit(500)]),
      databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.limit(200)]),
    ])

    const profileByAuthId = new Map(profileRes.documents.map(d => [d.userId as string, d]))
    const tenants: Record<string, string> = {}
    for (const t of tenantsRes.documents) tenants[t.$id] = t.name as string

    const rows: AdminUserRow[] = authRes.users.map(u => {
      const profile = profileByAuthId.get(u.$id)
      const [nameFirst, ...nameRest] = u.name.split(' ')
      const role = ((profile?.role as UserRole) ?? (u.labels[0] as UserRole) ?? 'candidate')
      const tenantId = (profile?.tenantId as string) || null
      return {
        authId: u.$id,
        profileId: profile?.$id ?? null,
        firstName: (profile?.firstName as string) ?? nameFirst ?? '',
        lastName: (profile?.lastName as string) ?? nameRest.join(' '),
        email: (profile?.email as string) || u.email,
        role,
        tenantId,
        companyName: (profile?.companyName as string) || (tenantId ? tenants[tenantId] ?? null : null),
        status: u.status,
        createdAt: u.registration,
      }
    })

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return { users: rows, tenants }
  } catch (e) {
    return { users: [], tenants: {}, error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function createUserManually(params: {
  email: string
  password: string
  firstName: string
  lastName: string
  role: UserRole
  companyName?: string
}): Promise<{ ok?: boolean; error?: string }> {
  try {
    await requireAdmin()
    if (!params.email.trim() || !params.password || params.password.length < 8) {
      return { error: 'Email requis et mot de passe d\'au moins 8 caractères' }
    }
    await createUserAccountAndProfile(params)
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function toggleUserStatus(authId: string, active: boolean): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await requireAdmin()
    if (admin.userId === authId) return { error: 'Vous ne pouvez pas désactiver votre propre compte' }
    const { users } = createAdminClient()
    await users.updateStatus(authId, active)
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}

export async function deleteUserAccount(authId: string, listedProfileId: string | null): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await requireAdmin()
    if (admin.userId === authId) return { error: 'Vous ne pouvez pas supprimer votre propre compte' }
    const { users, databases } = createAdminClient()
    // Fiche profil retrouvée côté serveur : la liste de l'admin n'en charge que 500, au-delà elle arrive vide et ses
    // données (exports de CV compris) resteraient. Celle de la liste ne sert que pour une fiche sans lien vers le compte.
    const linked = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', authId), Query.limit(1)])
    const profileId = linked.documents[0]?.$id ?? listedProfileId
    // Conversations avec l'assistant IA (RGPD), avant le compte : si leur suppression échoue, le compte n'est pas
    // supprimé et l'admin peut recommencer.
    if (isAssistantStorageConfigured()) {
      try {
        await deleteAssistantTurnsForUser(authId)
      } catch (e) {
        console.error('[assistant] suppression des conversations en échec', e instanceof Error ? e.message : String(e))
        return { error: 'Compte non supprimé : la suppression de ses conversations avec l’assistant IA a échoué. Réessayez.' }
      }
    }
    // Historique des recherches MBC Search d'un recruteur (RGPD), même règle : avant le compte.
    try {
      await deleteMbcSearchesForUser(authId)
    } catch (e) {
      console.error('[mbc-search] suppression de l\'historique en échec', e instanceof Error ? e.message : String(e))
      return { error: 'Compte non supprimé : la suppression de son historique de recherches MBC Search a échoué. Réessayez.' }
    }
    // Personnes enregistrées dans MBC Search (profils de tiers gardés sans limite de durée : RGPD), même règle.
    try {
      await deleteSavedPeopleForUser(authId)
    } catch (e) {
      console.error('[mbc-search] suppression des personnes enregistrées en échec', e instanceof Error ? e.message : String(e))
      return { error: 'Compte non supprimé : la suppression de ses personnes enregistrées dans MBC Search a échoué. Réessayez.' }
    }
    await deleteWeightsOfUser(authId) // poids du matching par offre (ne lève jamais)
    // Recherches enregistrées de la CV Thèque (ADR 0045), même règle : avant le compte.
    if (profileId) {
      try {
        await deleteSavedSearchesOf(profileId)
      } catch (e) {
        console.error('[recherches] suppression des recherches enregistrées en échec', e instanceof Error ? e.message : String(e))
        return { error: 'Compte non supprimé : la suppression de ses recherches enregistrées a échoué. Réessayez.' }
      }
      // Correspondances d'un candidat avec les offres (job_matches : citent son CV ; ADR 0047) et alertes des recruteurs
      // qui le concernent (recruiter_alerts : son identifiant et son score), même règle.
      try {
        await deleteJobMatchesOfCandidate(profileId)
        await deleteAlertsAboutCandidate(profileId)
      } catch (e) {
        console.error('[correspondances IA] suppression des correspondances en échec', e instanceof Error ? e.message : String(e))
        return { error: 'Compte non supprimé : la suppression de ses correspondances avec les offres ou des alertes qui le concernent a échoué. Réessayez.' }
      }
    }
    // CV au format ESN enregistrés pour ce candidat (RGPD), même règle : avant le compte.
    const hasCvExports = isCvExportStorageConfigured()
    if (profileId && hasCvExports) {
      try {
        await deleteCvExportsForCandidate(profileId)
      } catch (e) {
        console.error('[cv-export] suppression des exports en échec', profileId, cvExportErrorName(e))
        return {
          error: isCvExportStorageMissing(e)
            ? 'Compte non supprimé : stockage des CV format cabinet introuvable. Vérifiez APPWRITE_COLLECTION_CV_EXPORTS et APPWRITE_STORAGE_CV_EXPORTS (npm run cv-export:setup).'
            : 'Compte non supprimé : la suppression de ses CV format cabinet a échoué. Réessayez.',
        }
      }
    }
    await users.delete(authId)
    // Second passage, sessions désormais révoquées : un message envoyé pendant la suppression a pu être enregistré.
    // Un échec ici est journalisé ; la purge quotidienne (ASSISTANT_RETENTION_DAYS) supprimera ce reste.
    if (isAssistantStorageConfigured()) {
      await deleteAssistantTurnsForUser(authId).catch(e => console.error('[assistant] second passage de suppression en échec', e instanceof Error ? e.message : String(e)))
    }
    // Même raison pour une personne enregistrée dans MBC Search pendant la suppression (gardée sans limite de durée :
    // un échec ici laisse des documents mbc_saved_people de ce compte, à supprimer à la main).
    await deleteSavedPeopleForUser(authId).catch(e => console.error('[mbc-search] second passage de suppression des personnes enregistrées en échec, à supprimer à la main', e instanceof Error ? e.message : String(e)))
    // Même raison pour une recherche enregistrée pendant la suppression (un échec laisse des documents saved_searches de ce
    // profil, à supprimer à la main ; sans auteur, elle n'envoie plus rien).
    if (profileId) {
      await deleteSavedSearchesOf(profileId).catch(e => console.error('[recherches] second passage de suppression en échec, à supprimer à la main', e instanceof Error ? e.message : String(e)))
    }
    if (profileId) {
      try {
        await databases.deleteDocument(DB_ID, COLLECTIONS.USERS, profileId)
      } catch { /* profile doc may already be gone */ }
      await deleteClassification('candidate', profileId) // classification du CV (ADR 0044) ; ne lève jamais
      await deleteJudgementsOfCandidate(`p:${profileId}`) // jugements sur des critères propres (ADR 0061) ; ne lève jamais
      // Second passage après la fiche : une analyse du candidat en cours (correspondances IA, ADR 0047) relit la fiche
      // après ses écritures et retire ses associations si elle a disparu ; ce passage couvre ce qu'elle a pu écrire avant.
      await deleteJobMatchesOfCandidate(profileId).catch(e => console.error('[correspondances IA] second passage de suppression en échec, lignes job_matches de ce candidat à supprimer à la main', e instanceof Error ? e.message : String(e)))
      await deleteAlertsAboutCandidate(profileId).catch(e => console.error('[alertes] second passage de suppression en échec, alertes de ce candidat à supprimer à la main', e instanceof Error ? e.message : String(e)))
      // Second passage : un export terminé pendant la suppression a pu être enregistré entre-temps (saveCvExports
      // revérifie l'existence du candidat après avoir écrit). Un échec ici est journalisé : fichiers
      // « <profileId>_*.docx » du bucket et documents de ce candidat dans cv_exports, à supprimer à la main.
      if (hasCvExports) {
        await deleteCvExportsForCandidate(profileId).catch(e => console.error('[cv-export] second passage de suppression en échec, à supprimer à la main', profileId, cvExportErrorName(e)))
      }
    }
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur inconnue' }
  }
}
