'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { inviteMember, removeMember, resendInvite, type TeamMember } from '@/lib/team'

// Seul le propriétaire du compte (tenants.recruiterId) gère l'équipe : un collaborateur ne peut
// ni en inviter d'autres ni en retirer.
async function requireOwner() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) throw new Error('Non autorisé')
  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId)
  if (tenant.recruiterId !== user.userId) throw new Error('Seul le propriétaire du compte peut gérer l’équipe.')
  return { user, tenantId: user.tenantId, invitedBy: `${user.firstName} ${user.lastName}`.trim() || user.email }
}

export async function inviteMemberAction(input: { firstName: string; lastName: string; email: string }): Promise<{
  member?: TeamMember; inviteUrl?: string; emailSent?: boolean; error?: string
}> {
  try {
    const { tenantId, invitedBy } = await requireOwner()
    // Champs repris un par un : une action serveur reçoit n'importe quel objet, et un `tenantId` ou un `invitedBy` envoyé
    // par le navigateur ne doit jamais remplacer ceux de la session (sinon : invitation dans une autre organisation).
    const { firstName, lastName, email } = input
    if (typeof firstName !== 'string' || typeof lastName !== 'string' || typeof email !== 'string') {
      return { error: 'Prénom, nom et adresse e-mail requis.' }
    }
    const res = await inviteMember({ tenantId, invitedBy, firstName, lastName, email })
    if (!res.error) revalidatePath('/recruiter/equipe')
    return res
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur lors de l’invitation' }
  }
}

export async function resendInviteAction(userId: string): Promise<{ inviteUrl?: string; emailSent?: boolean; error?: string }> {
  try {
    const { tenantId, invitedBy } = await requireOwner()
    return await resendInvite({ tenantId, userId, invitedBy })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function removeMemberAction(userId: string): Promise<{ error?: string }> {
  try {
    const { tenantId } = await requireOwner()
    const res = await removeMember({ tenantId, userId })
    if (!res.error) revalidatePath('/recruiter/equipe')
    return res
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}
