import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { ID, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'

// Équipe d'un recruteur. Modèle : toutes les données (offres, candidatures, pipeline, rapports,
// historique) sont déjà rattachées au tenant ; un collaborateur est donc simplement un compte
// recruteur portant le même `tenantId` — il voit tout ce que voit le propriétaire, sans copie
// de données. Le propriétaire est `tenants.recruiterId` ; lui seul gère l'équipe.
//
// Invitation : le compte Appwrite est créé tout de suite (mot de passe aléatoire inutilisable)
// avec un jeton à usage unique dans ses préférences ; le collaborateur choisit son mot de passe
// depuis le lien reçu par email (/rejoindre/<jeton>). Aucune collection supplémentaire.

export const MAX_TEAM_SIZE = 15
const INVITE_TTL_MS = 7 * 86_400_000

export interface TeamMember {
  userId: string
  firstName: string
  lastName: string
  email: string
  isOwner: boolean
  status: 'active' | 'pending'
  inviteExpiresAt?: string
  lastAccess?: string
}

interface InvitePrefs { hash: string; expiresAt: string; invitedBy: string; tenantId: string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'

function readInvite(prefs: unknown): InvitePrefs | null {
  const inv = (prefs as { invite?: InvitePrefs } | null)?.invite
  return inv && typeof inv.hash === 'string' && typeof inv.expiresAt === 'string' ? inv : null
}

export async function listTeam(tenantId: string): Promise<TeamMember[]> {
  const { databases, users } = createAdminClient()
  const [tenant, profiles] = await Promise.all([
    databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId),
    databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('tenantId', tenantId), Query.limit(100)]),
  ])
  const ownerId = tenant.recruiterId as string

  const members = await Promise.all(profiles.documents.filter(p => p.role === 'recruiter').map(async (p): Promise<TeamMember> => {
    const userId = p.userId as string
    let status: TeamMember['status'] = 'active'
    let inviteExpiresAt: string | undefined
    let lastAccess: string | undefined
    try {
      const auth = await users.get(userId)
      const inv = readInvite(auth.prefs)
      if (inv) { status = 'pending'; inviteExpiresAt = inv.expiresAt }
      lastAccess = (auth as unknown as { accessedAt?: string }).accessedAt || undefined
    } catch { /* compte Auth introuvable : on l'affiche quand même comme actif */ }
    return {
      userId, firstName: (p.firstName as string) ?? '', lastName: (p.lastName as string) ?? '',
      email: (p.email as string) ?? '', isOwner: userId === ownerId, status, inviteExpiresAt, lastAccess,
    }
  }))
  // Propriétaire d'abord, puis membres actifs, puis invitations en attente.
  return members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || Number(a.status === 'pending') - Number(b.status === 'pending') || a.firstName.localeCompare(b.firstName, 'fr'))
}

async function sendInviteEmail(params: { userId: string; firstName: string; invitedBy: string; company: string; url: string }): Promise<boolean> {
  try {
    const { messaging } = createAdminClient()
    const title = `Rejoignez l’équipe de ${escapeHtml(params.company)}`
    const body = `
      <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;">Bonjour ${escapeHtml(params.firstName)},</p>
      <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;"><strong>${escapeHtml(params.invitedBy)}</strong> vous invite à rejoindre l’équipe recrutement de <strong>${escapeHtml(params.company)}</strong> sur MyBestConsultant. Vous aurez accès aux offres, aux candidatures, au pipeline et aux rapports de l’équipe.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${params.url}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Créer mon mot de passe</a>
        </td></tr>
      </table>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">Ce lien est valable 7 jours. Ou copiez-le : <a href="${params.url}" style="color:#E8A33D;">${params.url}</a></p>`
    await messaging.createEmail(
      ID.unique(), `${params.invitedBy} vous invite à rejoindre ${params.company}`, wrapEmailHtml(title, body),
      [], [params.userId], [], [], [], [], false, true,
    )
    return true
  } catch {
    return false
  }
}

async function issueInvite(userId: string, tenantId: string, invitedBy: string): Promise<string> {
  const { users } = createAdminClient()
  const secret = randomBytes(24).toString('hex')
  const invite: InvitePrefs = { hash: sha(secret), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(), invitedBy, tenantId }
  await users.updatePrefs(userId, { invite })
  return `${origin()}/rejoindre/${userId}.${secret}`
}

export async function inviteMember(params: {
  tenantId: string; invitedBy: string; firstName: string; lastName: string; email: string
}): Promise<{ member?: TeamMember; inviteUrl?: string; emailSent?: boolean; error?: string }> {
  const email = params.email.trim().toLowerCase()
  const firstName = params.firstName.trim().slice(0, 100)
  const lastName = params.lastName.trim().slice(0, 100)
  if (!firstName || !lastName) return { error: 'Prénom et nom requis.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Adresse email invalide.' }

  const { databases, users } = createAdminClient()
  const team = await listTeam(params.tenantId)
  if (team.length >= MAX_TEAM_SIZE) return { error: `Votre équipe est limitée à ${MAX_TEAM_SIZE} membres.` }

  const existing = await users.list([Query.equal('email', [email]), Query.limit(1)])
  if (existing.total > 0) return { error: 'Un compte existe déjà avec cette adresse email.' }

  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, params.tenantId)
  const auth = await users.create(ID.unique(), email, undefined, randomBytes(24).toString('base64url') + 'aA1!', `${firstName} ${lastName}`)
  try {
    await users.updateLabels(auth.$id, ['recruiter'])
    await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
      userId: auth.$id, role: 'recruiter', firstName, lastName, email, tenantId: params.tenantId,
    })
    const inviteUrl = await issueInvite(auth.$id, params.tenantId, params.invitedBy)
    const emailSent = await sendInviteEmail({ userId: auth.$id, firstName, invitedBy: params.invitedBy, company: tenant.name as string, url: inviteUrl })
    const inv = readInvite((await users.get(auth.$id)).prefs)
    return {
      inviteUrl, emailSent,
      member: { userId: auth.$id, firstName, lastName, email, isOwner: false, status: 'pending', inviteExpiresAt: inv?.expiresAt },
    }
  } catch (e) {
    // Rollback : sans profil complet, le compte deviendrait un orphelin qui bloque l'adresse email.
    try { await users.delete(auth.$id) } catch { /* best effort */ }
    return { error: e instanceof Error ? e.message : 'Erreur lors de l’invitation' }
  }
}

async function requireMemberOfTenant(tenantId: string, userId: string) {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('userId', userId), Query.limit(1)])
  const profile = res.documents[0]
  if (!profile || profile.tenantId !== tenantId || profile.role !== 'recruiter') throw new Error('Membre introuvable')
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  if (tenant.recruiterId === userId) throw new Error('Le propriétaire du compte ne peut pas être modifié')
  return { profile, tenant }
}

export async function resendInvite(params: { tenantId: string; userId: string; invitedBy: string }): Promise<{ inviteUrl?: string; emailSent?: boolean; error?: string }> {
  try {
    const { profile, tenant } = await requireMemberOfTenant(params.tenantId, params.userId)
    const { users } = createAdminClient()
    if (!readInvite((await users.get(params.userId)).prefs)) return { error: 'Cette personne a déjà activé son compte.' }
    const inviteUrl = await issueInvite(params.userId, params.tenantId, params.invitedBy)
    const emailSent = await sendInviteEmail({ userId: params.userId, firstName: profile.firstName as string, invitedBy: params.invitedBy, company: tenant.name as string, url: inviteUrl })
    return { inviteUrl, emailSent }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

export async function removeMember(params: { tenantId: string; userId: string }): Promise<{ error?: string }> {
  try {
    const { profile } = await requireMemberOfTenant(params.tenantId, params.userId)
    const { databases, users } = createAdminClient()
    await databases.deleteDocument(DB_ID, COLLECTIONS.USERS, profile.$id)
    try { await users.delete(params.userId) } catch { /* déjà supprimé */ }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur' }
  }
}

// ── Acceptation d'une invitation (page publique /rejoindre/<jeton>) ──────────────

async function verifyInvite(token: string) {
  const [userId, secret] = token.split('.')
  if (!userId || !secret || !/^[\w-]{1,36}$/.test(userId)) return null
  const { users, databases } = createAdminClient()
  try {
    const auth = await users.get(userId)
    const inv = readInvite(auth.prefs)
    if (!inv || new Date(inv.expiresAt) < new Date()) return null
    const a = Buffer.from(sha(secret)), b = Buffer.from(inv.hash)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, inv.tenantId).catch(() => null)
    return { auth, inv, companyName: (tenant?.name as string) ?? 'votre entreprise' }
  } catch {
    return null
  }
}

export async function getInviteInfo(token: string): Promise<{ firstName: string; email: string; company: string; invitedBy: string } | null> {
  const v = await verifyInvite(token)
  if (!v) return null
  return { firstName: v.auth.name.split(' ')[0] ?? '', email: v.auth.email, company: v.companyName, invitedBy: v.inv.invitedBy }
}

export async function acceptInvite(token: string, password: string): Promise<{ email?: string; error?: string }> {
  const v = await verifyInvite(token)
  if (!v) return { error: 'Ce lien d’invitation est invalide ou a expiré. Demandez-en un nouveau à votre responsable.' }
  const { users } = createAdminClient()
  await users.updatePassword(v.auth.$id, password)
  await users.updateEmailVerification(v.auth.$id, true)
  const { invite: _consumed, ...rest } = (v.auth.prefs ?? {}) as Record<string, unknown>
  void _consumed
  await users.updatePrefs(v.auth.$id, rest)
  return { email: v.auth.email }
}
