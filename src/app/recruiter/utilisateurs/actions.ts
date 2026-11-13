'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import {
  inviteMember, loadTeam, removeMember, resendInvite, setMemberActive, setMemberRole, transferOwnership, type TeamMember,
} from '@/lib/team'
import { roleOf, teamActionDenial, type TeamAction } from '@/lib/team-roles'

// Gestion des utilisateurs de l'organisation (/recruiter/utilisateurs, ADR 0033). Chaque action vérifie elle-même le
// recruteur de la session, lit l'équipe de SON organisation (jamais un identifiant d'organisation venu du navigateur),
// puis applique les règles de team-roles.ts ; les fonctions de team.ts revérifient que le compte visé est de
// l'organisation et n'en est pas le propriétaire.

const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'
const NOT_FOUND = 'Utilisateur introuvable : rechargez la page.'
const userIdSchema = z.string().regex(/^[\w-]{1,36}$/)

type Context = { tenantId: string; userId: string; invitedBy: string; target?: TeamMember }

/** Recruteur de la session, son droit de faire `action`, et le membre visé (`userId`) s'il y en a un. */
async function allowed(action: TeamAction, userId?: unknown): Promise<{ error: string } | Context> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  const { members, tenant } = await loadTeam(user.tenantId)
  const role = roleOf(user.userId, tenant)
  const base = { tenantId: user.tenantId, userId: user.userId, invitedBy: `${user.firstName} ${user.lastName}`.trim() || user.email }
  if (userId === undefined) {
    const denied = teamActionDenial(role, action)
    return denied ? { error: denied } : base
  }
  const id = userIdSchema.safeParse(userId)
  const target = id.success ? members.find(m => m.userId === id.data) : undefined
  if (!target) return { error: NOT_FOUND }
  const denied = teamActionDenial(role, action, { role: target.role, status: target.status, isSelf: target.userId === user.userId })
  return denied ? { error: denied } : { ...base, target }
}

function refresh() {
  revalidatePath('/recruiter/utilisateurs')
  revalidatePath('/recruiter/equipe')
  revalidatePath('/recruiter/organisation')
}

/** Message d'échec sans détail technique ; la cause va dans les journaux, sans données personnelles. */
function failure(what: string, err: unknown): { error: string } {
  console.error(`[utilisateurs] ${what} impossible`, err instanceof Error ? err.message : String(err))
  return { error: `${what.charAt(0).toUpperCase()}${what.slice(1)} impossible pour le moment : réessayez dans quelques instants.` }
}

const inviteSchema = z.object({
  firstName: z.string().trim().min(1, 'Prénom requis.').max(100),
  lastName: z.string().trim().min(1, 'Nom requis.').max(100),
  email: z.string().trim().max(254),
})

export async function inviteUserAction(input: unknown): Promise<{ member?: TeamMember; inviteUrl?: string; emailSent?: boolean; error?: string }> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Prénom, nom et adresse e-mail requis.' }
  try {
    const ctx = await allowed('invite')
    if ('error' in ctx) return ctx
    const res = await inviteMember({ tenantId: ctx.tenantId, invitedBy: ctx.invitedBy, ...parsed.data })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure('invitation', err)
  }
}

export async function resendInviteAction(userId: unknown): Promise<{ inviteUrl?: string; emailSent?: boolean; error?: string }> {
  try {
    const ctx = await allowed('resend', userId)
    if ('error' in ctx || !ctx.target) return 'error' in ctx ? ctx : { error: NOT_FOUND }
    const res = await resendInvite({ tenantId: ctx.tenantId, userId: ctx.target.userId, invitedBy: ctx.invitedBy })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure('nouvel envoi de l’invitation', err)
  }
}

export async function removeUserAction(userId: unknown): Promise<{ error?: string }> {
  try {
    const ctx = await allowed('remove', userId)
    if ('error' in ctx || !ctx.target) return 'error' in ctx ? ctx : { error: NOT_FOUND }
    const res = await removeMember({ tenantId: ctx.tenantId, userId: ctx.target.userId })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure('retrait', err)
  }
}

export async function setUserActiveAction(userId: unknown, active: unknown): Promise<{ error?: string }> {
  if (typeof active !== 'boolean') return { error: NOT_FOUND }
  try {
    const ctx = await allowed(active ? 'enable' : 'disable', userId)
    if ('error' in ctx || !ctx.target) return 'error' in ctx ? ctx : { error: NOT_FOUND }
    const res = await setMemberActive({ tenantId: ctx.tenantId, userId: ctx.target.userId, active })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure(active ? 'réactivation' : 'désactivation', err)
  }
}

export async function setUserRoleAction(userId: unknown, role: unknown): Promise<{ error?: string }> {
  if (role !== 'admin' && role !== 'member') return { error: NOT_FOUND }
  try {
    const ctx = await allowed('setRole', userId)
    if ('error' in ctx || !ctx.target) return 'error' in ctx ? ctx : { error: NOT_FOUND }
    const res = await setMemberRole({ tenantId: ctx.tenantId, userId: ctx.target.userId, role })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure('changement de rôle', err)
  }
}

export async function transferOwnershipAction(userId: unknown): Promise<{ error?: string }> {
  try {
    const ctx = await allowed('transfer', userId)
    if ('error' in ctx || !ctx.target) return 'error' in ctx ? ctx : { error: NOT_FOUND }
    const res = await transferOwnership({ tenantId: ctx.tenantId, userId: ctx.target.userId })
    if (!res.error) refresh()
    return res
  } catch (err) {
    return failure('transfert de la propriété', err)
  }
}
