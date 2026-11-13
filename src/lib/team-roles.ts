// Rôles dans l'organisation d'un recruteur et ce que chacun peut faire (demande du 2026-11-13, ADR 0033) : un
// propriétaire (`tenants.recruiterId`, compte Auth), des administrateurs (`tenants.adminUserIds`) et des membres.
// Règles pures, testées dans team-roles.test.ts ; les Server Actions les appliquent avant chaque écriture.

export type TeamRole = 'owner' | 'admin' | 'member'
/** Compte actif, invitation pas encore acceptée, ou compte désactivé (connexion bloquée). */
export type TeamStatus = 'active' | 'pending' | 'disabled'

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre' }

/** Rôle d'un compte Auth dans l'organisation `tenant`. */
export function roleOf(userId: string, tenant: { recruiterId?: unknown; adminUserIds?: unknown }): TeamRole {
  if (typeof tenant.recruiterId === 'string' && tenant.recruiterId === userId) return 'owner'
  return Array.isArray(tenant.adminUserIds) && tenant.adminUserIds.includes(userId) ? 'admin' : 'member'
}

/** Liste des administrateurs de l'organisation ; null si l'attribut n'existe pas encore en base (schema:push à faire). */
export function adminUserIdsOf(tenant: Record<string, unknown>): string[] | null {
  if (!('adminUserIds' in tenant)) return null
  return Array.isArray(tenant.adminUserIds) ? tenant.adminUserIds.filter((id): id is string => typeof id === 'string') : []
}

/** Gère les utilisateurs et l'organisation : propriétaire et administrateurs. */
export const canManageTeam = (role: TeamRole) => role === 'owner' || role === 'admin'

export type TeamAction = 'invite' | 'resend' | 'remove' | 'disable' | 'enable' | 'setRole' | 'transfer' | 'editOrganisation' | 'billing'

export interface TeamTarget { role: TeamRole; status: TeamStatus; isSelf: boolean }

/**
 * Pourquoi `actor` ne peut pas faire `action` (sur `target`) ; null s'il le peut.
 * - Inviter, modifier l'organisation : propriétaire et administrateurs.
 * - Renvoyer une invitation, désactiver, réactiver, retirer : le propriétaire sur tout autre compte, un administrateur
 *   sur les membres seulement ; jamais sur soi-même, jamais sur le propriétaire.
 * - Changer un rôle, transférer la propriété, facturation : le propriétaire seul.
 */
export function teamActionDenial(actor: TeamRole, action: TeamAction, target?: TeamTarget): string | null {
  if (action === 'invite' || action === 'editOrganisation') {
    return canManageTeam(actor) ? null : 'Réservé au propriétaire et aux administrateurs de l’organisation.'
  }
  if (action === 'billing') return actor === 'owner' ? null : 'Réservé au propriétaire de l’organisation.'
  if (!target) return 'Utilisateur introuvable.'
  if (target.isSelf) return 'Vous ne pouvez pas faire cette action sur votre propre compte.'
  if (target.role === 'owner') return 'Le propriétaire de l’organisation ne peut pas être modifié.'
  if (action === 'setRole' || action === 'transfer') {
    if (actor !== 'owner') return 'Réservé au propriétaire de l’organisation.'
    if (target.status !== 'active') return 'Le compte doit être actif (invitation acceptée, compte non désactivé).'
    return null
  }
  if (!canManageTeam(actor)) return 'Réservé au propriétaire et aux administrateurs de l’organisation.'
  if (actor === 'admin' && target.role !== 'member') return 'Seul le propriétaire peut modifier un administrateur.'
  if (action === 'resend' && target.status !== 'pending') return 'Cette personne a déjà activé son compte.'
  if (action === 'disable' && target.status !== 'active') return target.status === 'pending' ? 'Invitation en attente : retirez-la plutôt.' : 'Ce compte est déjà désactivé.'
  if (action === 'enable' && target.status !== 'disabled') return 'Ce compte n’est pas désactivé.'
  return null
}

/** Administrateurs après le passage de `userId` au rôle `role` (sans doublon, ordre gardé). */
export function withRole(adminUserIds: string[], userId: string, role: 'admin' | 'member'): string[] {
  const others = adminUserIds.filter(id => id !== userId)
  return role === 'admin' ? [...others, userId] : others
}

export interface TeamListFilter { query: string; status: TeamStatus | 'all'; role: TeamRole | 'all' }

/** Recherche (nom, e-mail, accents et casse près) et filtres de la page « Utilisateurs ». */
export function filterTeam<T extends { firstName: string; lastName: string; email: string; role: TeamRole; status: TeamStatus }>(list: T[], f: TeamListFilter): T[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const q = norm(f.query.trim())
  return list.filter(m =>
    (f.status === 'all' || m.status === f.status)
    && (f.role === 'all' || m.role === f.role)
    && (!q || norm(`${m.firstName} ${m.lastName} ${m.email}`).includes(q)))
}
