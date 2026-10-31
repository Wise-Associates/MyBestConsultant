import 'server-only'
import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'

// Affectation d'un recrutement à un recruteur de l'organisation (demande de Dav du 2026-10-31) : sur la page d'un
// appel d'offres avant sa publication (ao_offer_details.assigneeId, ao_offers étant à 16/16), puis sur l'offre publiée
// (jobs.recruiterId), où il apparaît dans « Mon espace » du recruteur. Identifiant = identifiant Auth du recruteur
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
