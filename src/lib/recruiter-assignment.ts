import 'server-only'
import { AppwriteException, ID, MessagingProviderType, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { assignmentEmail } from '@/lib/assignment-email'
import { wrapEmailHtml } from '@/lib/email-template'

// Affectation d'un recrutement à un recruteur de l'organisation (demande de Dav du 2026-10-31) : sur la page d'un
// appel d'offres avant sa publication (ao_offer_details.assigneeId, ao_offers étant à 16/16), puis sur l'offre publiée
// (jobs.recruiterId), affiché et modifiable dans « Mes offres » du tableau de bord. Identifiant = identifiant Auth du recruteur
// (UserProfile.userId), comme tenants.recruiterId. Aucune vérification d'appelant ici : à faire par chaque action.

export interface AssignableRecruiter {
  userId: string
  name: string
}

/** Recruteurs de l'organisation, par prénom (une équipe compte 15 personnes au plus, team.ts). */
export async function listTenantRecruiters(tenantId: string): Promise<AssignableRecruiter[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.USERS, [
    Query.equal('tenantId', tenantId), Query.equal('role', 'recruiter'), Query.limit(100),
  ])
  return res.documents
    .map(d => ({
      userId: d.userId as string,
      name: `${(d.firstName as string) ?? ''} ${(d.lastName as string) ?? ''}`.trim() || (d.email as string) || 'Recruteur',
    }))
    .filter(r => r.userId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** `userId` vide (désaffecter) ou recruteur de l'organisation ; sinon une erreur à afficher. */
export async function checkAssignee(tenantId: string, userId: string): Promise<string | null> {
  if (!userId) return null
  const recruiters = await listTenantRecruiters(tenantId)
  return recruiters.some(r => r.userId === userId) ? null : 'Ce recruteur ne fait pas partie de votre équipe.'
}

const isMissing = (err: unknown) => err instanceof AppwriteException && err.type === 'document_not_found'

/** Recruteur affecté à une offre AO ('' : personne, ou détails absents). */
export async function getAoAssignee(offerId: string): Promise<string> {
  const { databases } = createAdminClient()
  try {
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId)
    return typeof doc.assigneeId === 'string' ? doc.assigneeId : ''
  } catch (err) {
    if (isMissing(err)) return ''
    throw err
  }
}

/** Affecte une offre AO (document de détails créé s'il n'existe pas, comme saveAoOfferSourcing). */
export async function setAoAssignee(offerId: string, userId: string): Promise<void> {
  const { databases } = createAdminClient()
  const assigneeId = userId || null
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, { assigneeId })
  } catch (err) {
    if (!isMissing(err)) throw err
    await databases.createDocument(DB_ID, COLLECTIONS.AO_OFFER_DETAILS, offerId, { engagement: '', technologies: [], assigneeId })
  }
}

const origin = () => process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'

/**
 * Prévient par e-mail le recruteur affecté (`assigneeId`, recruteur de l'organisation), celui qui affecte en copie.
 * Appwrite Messaging n'accepte que des identifiants : destinataire = compte Auth, copie = cible e-mail du compte de
 * celui qui affecte. Sans cette cible, l'e-mail part sans copie (`copied: false`). Les erreurs remontent à l'appelant :
 * l'affectation est déjà faite, l'action le signale sans l'annuler.
 */
export async function notifyAssignee(params: {
  tenantId: string; assigneeId: string; assignerId: string; assignerName: string
  kind: 'job' | 'ao'; title: string; location: string; path: string
}): Promise<{ copied: boolean }> {
  const assignee = (await listTenantRecruiters(params.tenantId)).find(r => r.userId === params.assigneeId)
  if (!assignee) throw new Error('recruteur affecté absent de l’équipe')
  const { users, messaging } = createAdminClient()
  const targets = await users.listTargets(params.assignerId)
  const cc = targets.targets.filter(t => t.providerType === MessagingProviderType.Email).map(t => t.$id).slice(0, 1)
  const mail = assignmentEmail({
    kind: params.kind, title: params.title, location: params.location,
    assigneeName: assignee.name, assignerName: params.assignerName, url: `${origin()}${params.path}`,
  })
  await messaging.createEmail(ID.unique(), mail.subject, wrapEmailHtml(mail.heading, mail.bodyHtml), [], [params.assigneeId], [], cc, [], [], false, true)
  return { copied: cc.length > 0 }
}

/** notifyAssignee sans faire échouer l'affectation : le message à afficher si l'e-mail ou sa copie ne sont pas partis. */
export async function notifyAssigneeWarning(params: Parameters<typeof notifyAssignee>[0]): Promise<string | null> {
  try {
    if ((await notifyAssignee(params)).copied) return null
    console.error('[affectation] e-mail envoyé sans copie : aucune adresse e-mail sur le compte qui affecte', params.assignerId)
    return 'Recruteur prévenu par e-mail, mais vous n’êtes pas en copie : aucune adresse e-mail sur votre compte.'
  } catch (err) {
    console.error('[affectation] e-mail au recruteur affecté non envoyé', params.assigneeId, err instanceof Error ? err.message : err)
    return 'Recruteur affecté, mais l’e-mail pour le prévenir n’est pas parti : prévenez-le directement.'
  }
}

/** Affecte une offre publiée ; false si elle n'existe pas ou n'est pas de l'organisation. */
export async function setJobRecruiter(tenantId: string, jobId: string, userId: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const job = await databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(err => {
    if (isMissing(err)) return null
    throw err
  })
  if (!job || job.tenantId !== tenantId) return false
  await databases.updateDocument(DB_ID, COLLECTIONS.JOBS, jobId, { recruiterId: userId || null })
  return true
}
