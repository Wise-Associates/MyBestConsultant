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

/** Page d'une offre publique (`/jobs/<identifiant>`), seule adresse de retour acceptée après connexion ou inscription. */
const OFFER_PATH = /^\/jobs\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/**
 * Adresse de retour reçue du navigateur (`?redirect=`) si c'est la page d'une offre, sinon null. Seule cette forme est
 * acceptée : une adresse quelconque permettrait de renvoyer vers un autre site après la connexion (« //site », « /\site »).
 */
export function offerReturnPath(raw: unknown): string | null {
  return typeof raw === 'string' && OFFER_PATH.test(raw) ? raw : null
}

/**
 * Page d'arrivée après connexion ou inscription : l'offre d'où vient le candidat (« Postuler maintenant », « J'ai déjà
 * un compte »), sinon son tableau de bord.
 */
export function afterAuthPath(role: string | null | undefined, redirect: unknown): string {
  return offerReturnPath(redirect) ?? dashboardPathFor(role)
}
