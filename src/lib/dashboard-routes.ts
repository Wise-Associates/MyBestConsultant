import type { UserRole } from '@/types'

export const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  candidate: '/candidate/dashboard',
  // Le recruteur arrive sur MBC Search, première rubrique de son menu (demande du 2026-11-13).
  recruiter: '/recruiter/mbc-search',
  admin: '/admin/dashboard',
  hunter: '/hunter/dashboard',
}

/**
 * Tableau de bord d'arrivée après connexion ou inscription. Un rôle absent ou inconnu (profil incomplet)
 * mène à l'espace candidat, le rôle par défaut à la création d'un profil.
 */
export function dashboardPathFor(role: string | null | undefined): string {
  return role && Object.hasOwn(DASHBOARD_BY_ROLE, role)
    ? DASHBOARD_BY_ROLE[role as UserRole]
    : DASHBOARD_BY_ROLE.candidate
}
