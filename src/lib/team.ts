import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { ID, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { wrapEmailHtml } from '@/lib/email-template'
import { deleteAssistantTurnsForUser, isAssistantStorageConfigured } from '@/lib/assistant/host'
import { deleteMbcSearchesForUser } from '@/lib/mbc-search/history-store'
import { deleteSavedPeopleForUser } from '@/lib/mbc-search/saved-store'
import { adminUserIdsOf, roleOf, withRole, type TeamRole, type TeamStatus } from '@/lib/team-roles'

// Équipe d'un recruteur. Modèle : toutes les données (offres, candidatures, pipeline, rapports,
// historique) sont déjà rattachées au tenant ; un collaborateur est donc simplement un compte
// recruteur portant le même `tenantId` — il voit tout ce que voit le propriétaire, sans copie
// de données. Le propriétaire est `tenants.recruiterId` ; avec les administrateurs (`tenants.adminUserIds`, ADR 0033)
// il gère l'équipe — qui peut faire quoi : src/lib/team-roles.ts. Un compte désactivé garde ses données mais ne peut
// plus se connecter (statut du compte Appwrite).
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
  role: TeamRole
  status: TeamStatus
  inviteExpiresAt?: string
  lastAccess?: string
}

const ROLES_UNAVAILABLE = 'Les rôles d’administrateur ne sont pas encore activés sur la plateforme. Contactez le support.'

// Invitation en cours : étiquette posée par le serveur (seule la clé d'API écrit les étiquettes), exigée en plus du
// jeton des préférences, que l'utilisateur peut réécrire avec sa propre session (revue de sécurité du 2026-11-13 :
// sinon, n'importe qui se fabriquait une invitation pour faire vérifier son adresse, et un membre se faisait passer
// pour une invitation en attente, qu'on ne peut pas désactiver). Toujours après le rôle : labels[0] est le rôle.
const INVITED_LABEL = 'invited'

/**
 * État d'un compte Auth : désactivé d'abord (statut bloqué), puis invitation en attente — étiquette posée par le
 * serveur, ou, pour une invitation envoyée avant l'étiquette, jeton présent sur un compte jamais utilisé —, sinon actif.
 */
function accountStatus(auth: { status: boolean; labels: string[]; prefs: unknown; accessedAt?: string }): TeamStatus {
  if (auth.status === false) return 'disabled'
  if (readInvite(auth.prefs) && (auth.labels.includes(INVITED_LABEL) || !auth.accessedAt)) return 'pending'
  return 'active'
}

/** Revérifie juste avant l'écriture qu'un compte est actif (rôle, transfert) : la liste lue avant a pu changer. */
async function assertActiveAccount(userId: string): Promise<void> {
  const { users } = createAdminClient()
  const auth = await users.get(userId)
  if (accountStatus(auth as unknown as Parameters<typeof accountStatus>[0]) !== 'active') {
    throw new TeamRefusal('Le compte doit être actif (invitation acceptée, compte non désactivé).')
  }
}

/** Refus prévu (compte d'une autre organisation, propriétaire) : son message est montré tel quel. */
class TeamRefusal extends Error {}

/** Échec d'une opération sur l'équipe : refus prévu tel quel ; autre erreur journalisée, message générique au navigateur. */
function teamError(what: string, e: unknown): { error: string } {
  if (e instanceof TeamRefusal) return { error: e.message }
  console.error(`[equipe] ${what} impossible`, e instanceof Error ? e.message : String(e))
  return { error: 'Action impossible pour le moment : réessayez dans quelques instants.' }
}

interface InvitePrefs { hash: string; expiresAt: string; invitedBy: string; tenantId: string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'

function readInvite(prefs: unknown): InvitePrefs | null {
  const inv = (prefs as { invite?: InvitePrefs } | null)?.invite
  return inv && typeof inv.hash === 'string' && typeof inv.expiresAt === 'string' ? inv : null
}

/** Équipe et document de l'organisation (rôles, nom), lus ensemble. */
export async function loadTeam(tenantId: string): Promise<{ members: TeamMember[]; tenant: Record<string, unknown> }> {
  const { databases, users } = createAdminClient()
  const [tenant, profiles] = await Promise.all([
    databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId).then(d => d as unknown as Record<string, unknown>),
    databases.listDocuments(DB_ID, COLLECTIONS.USERS, [Query.equal('tenantId', tenantId), Query.limit(100)]),
  ])

  const members = await Promise.all(profiles.documents.filter(p => p.role === 'recruiter').map(async (p): Promise<TeamMember> => {
    const userId = p.userId as string
    let status: TeamStatus = 'active'
    let inviteExpiresAt: string | undefined
    let lastAccess: string | undefined
    try {
      const auth = await users.get(userId)
      status = accountStatus(auth as unknown as Parameters<typeof accountStatus>[0])
      if (status === 'pending') inviteExpiresAt = readInvite(auth.prefs)?.expiresAt
      lastAccess = (auth as unknown as { accessedAt?: string }).accessedAt || undefined
    } catch (err) {
      // Compte Auth illisible : affiché comme actif, faute de mieux ; la cause est journalisée (identifiant seulement).
      console.error('[equipe] compte Auth illisible', userId, err instanceof Error ? err.message : String(err))
    }
    const role = roleOf(userId, tenant)
    return {
      userId, firstName: (p.firstName as string) ?? '', lastName: (p.lastName as string) ?? '',
      email: (p.email as string) ?? '', isOwner: role === 'owner', role, status, inviteExpiresAt, lastAccess,
    }
  }))
  // Propriétaire, administrateurs, membres ; dans chaque rôle les comptes actifs d'abord, puis par prénom.
  const rank: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2 }
  const statusRank: Record<TeamStatus, number> = { active: 0, pending: 1, disabled: 2 }
  members.sort((a, b) => rank[a.role] - rank[b.role] || statusRank[a.status] - statusRank[b.status] || a.firstName.localeCompare(b.firstName, 'fr'))
  return { members, tenant }
}

export async function listTeam(tenantId: string): Promise<TeamMember[]> {
  return (await loadTeam(tenantId)).members
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
    await users.updateLabels(auth.$id, ['recruiter', INVITED_LABEL])
    await databases.createDocument(DB_ID, COLLECTIONS.USERS, ID.unique(), {
      userId: auth.$id, role: 'recruiter', firstName, lastName, email, tenantId: params.tenantId,
    })
    const inviteUrl = await issueInvite(auth.$id, params.tenantId, params.invitedBy)
    const emailSent = await sendInviteEmail({ userId: auth.$id, firstName, invitedBy: params.invitedBy, company: tenant.name as string, url: inviteUrl })
    const inv = readInvite((await users.get(auth.$id)).prefs)
    return {
      // Lien rendu seulement si l'e-mail n'est pas parti : sinon, celui qui invite pourrait accepter l'invitation à la
      // place de la personne invitée.
      ...(emailSent ? {} : { inviteUrl }), emailSent,
      member: { userId: auth.$id, firstName, lastName, email, isOwner: false, role: 'member', status: 'pending', inviteExpiresAt: inv?.expiresAt },
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
  if (!profile || profile.tenantId !== tenantId || profile.role !== 'recruiter') throw new TeamRefusal('Membre introuvable')
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  if (tenant.recruiterId === userId) throw new TeamRefusal('Le propriétaire du compte ne peut pas être modifié')
  return { profile, tenant }
}

export async function resendInvite(params: { tenantId: string; userId: string; invitedBy: string }): Promise<{ inviteUrl?: string; emailSent?: boolean; error?: string }> {
  try {
    const { profile, tenant } = await requireMemberOfTenant(params.tenantId, params.userId)
    const { users } = createAdminClient()
    const auth = await users.get(params.userId)
    if (accountStatus(auth as unknown as Parameters<typeof accountStatus>[0]) !== 'pending') return { error: 'Cette personne a déjà activé son compte.' }
    // Invitation envoyée avant l'étiquette : elle la reçoit maintenant (le nouveau lien en dépend).
    if (!auth.labels.includes(INVITED_LABEL)) await users.updateLabels(params.userId, [...auth.labels, INVITED_LABEL])
    const inviteUrl = await issueInvite(params.userId, params.tenantId, params.invitedBy)
    const emailSent = await sendInviteEmail({ userId: params.userId, firstName: profile.firstName as string, invitedBy: params.invitedBy, company: tenant.name as string, url: inviteUrl })
    return { emailSent, ...(emailSent ? {} : { inviteUrl }) }
  } catch (e) {
    return teamError('nouvel envoi de l’invitation', e)
  }
}

export async function removeMember(params: { tenantId: string; userId: string }): Promise<{ error?: string }> {
  try {
    const { profile } = await requireMemberOfTenant(params.tenantId, params.userId)
    const { databases, users } = createAdminClient()
    // Retirer un membre supprime son compte : ses conversations avec l'assistant IA, son historique MBC Search et ses
    // personnes enregistrées d'abord (RGPD) ; si cela échoue, rien n'est supprimé et le propriétaire peut recommencer.
    if (isAssistantStorageConfigured()) await deleteAssistantTurnsForUser(params.userId)
    await deleteMbcSearchesForUser(params.userId)
    await deleteSavedPeopleForUser(params.userId)
    await databases.deleteDocument(DB_ID, COLLECTIONS.USERS, profile.$id)
    try { await users.delete(params.userId) } catch { /* déjà supprimé */ }
    // Plus administrateur d'une organisation qu'il a quittée. Organisation relue ici, après les suppressions (lentes) :
    // un changement de rôle fait entre-temps ne doit pas être effacé par une copie ancienne de la liste.
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, params.tenantId) as unknown as Record<string, unknown>
    const admins = adminUserIdsOf(tenant)
    if (admins?.includes(params.userId)) {
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, params.tenantId, { adminUserIds: withRole(admins, params.userId, 'member') })
    }
    // Second passage, sessions révoquées : une personne enregistrée dans MBC Search pendant la suppression (gardée sans
    // limite de durée ; un échec laisse des documents mbc_saved_people de ce compte, à supprimer à la main).
    await deleteSavedPeopleForUser(params.userId).catch(e => console.error('[mbc-search] second passage de suppression des personnes enregistrées en échec, à supprimer à la main', e instanceof Error ? e.message : String(e)))
    return {}
  } catch (e) {
    return teamError('retrait du membre', e)
  }
}

/**
 * Désactive (connexion bloquée, sessions fermées) ou réactive le compte d'un membre de l'organisation. Ses données
 * (offres affectées, vivier, historique) restent. Droits vérifiés par l'appelant (teamActionDenial).
 */
export async function setMemberActive(params: { tenantId: string; userId: string; active: boolean }): Promise<{ error?: string }> {
  try {
    await requireMemberOfTenant(params.tenantId, params.userId)
    const { users } = createAdminClient()
    await users.updateStatus(params.userId, params.active)
    if (!params.active) {
      // Appwrite refuse déjà les sessions d'un compte bloqué : les fermer en plus ne doit pas faire croire à un échec.
      await users.deleteSessions(params.userId).catch(err => console.error('[equipe] sessions du compte désactivé non fermées', err instanceof Error ? err.message : String(err)))
    }
    return {}
  } catch (e) {
    return teamError('changement d’état du compte', e)
  }
}

/** Fait d'un membre un administrateur de l'organisation, ou l'inverse. Droits vérifiés par l'appelant. */
export async function setMemberRole(params: { tenantId: string; userId: string; role: 'admin' | 'member' }): Promise<{ error?: string }> {
  try {
    const { tenant } = await requireMemberOfTenant(params.tenantId, params.userId)
    const admins = adminUserIdsOf(tenant)
    if (admins === null) {
      console.error('[equipe] attribut tenants.adminUserIds absent : npm run schema:push à faire')
      return { error: ROLES_UNAVAILABLE }
    }
    if (params.role === 'admin') await assertActiveAccount(params.userId)
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, params.tenantId, { adminUserIds: withRole(admins, params.userId, params.role) })
    return {}
  } catch (e) {
    return teamError('changement de rôle', e)
  }
}

/**
 * Transfère la propriété de l'organisation à un membre : il devient propriétaire (et n'est plus dans la liste des
 * administrateurs), l'ancien propriétaire devient membre. Les e-mails adressés au propriétaire (résultats
 * d'entretien, réponses des candidats) partent ensuite au nouveau. Droits vérifiés par l'appelant.
 */
export async function transferOwnership(params: { tenantId: string; userId: string }): Promise<{ error?: string }> {
  try {
    const { tenant } = await requireMemberOfTenant(params.tenantId, params.userId)
    await assertActiveAccount(params.userId)
    const admins = adminUserIdsOf(tenant)
    const { databases } = createAdminClient()
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, params.tenantId, {
      recruiterId: params.userId,
      // Sans l'attribut en base (schema:push pas fait), seul le propriétaire change.
      ...(admins === null ? {} : { adminUserIds: withRole(admins, params.userId, 'member') }),
    })
    return {}
  } catch (e) {
    return teamError('transfert de la propriété', e)
  }
}

// ── Acceptation d'une invitation (page publique /rejoindre/<jeton>) ──────────────

async function verifyInvite(token: string) {
  const [userId, secret] = token.split('.')
  if (!userId || !secret || !/^[\w-]{1,36}$/.test(userId)) return null
  const { users, databases } = createAdminClient()
  try {
    const auth = await users.get(userId)
    // Étiquette posée par le serveur exigée : le jeton seul vient de préférences que l'utilisateur peut écrire.
    if (!auth.labels.includes(INVITED_LABEL)) return null
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
  await users.updateLabels(v.auth.$id, v.auth.labels.filter(l => l !== INVITED_LABEL))
  const { invite: _consumed, ...rest } = (v.auth.prefs ?? {}) as Record<string, unknown>
  void _consumed
  await users.updatePrefs(v.auth.$id, rest)
  return { email: v.auth.email }
}
