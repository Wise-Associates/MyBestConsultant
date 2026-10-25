'use server'

import { after } from 'next/server'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { createJob, getJobById, oneMonthFromNow } from '@/lib/appwrite/jobs'
import type { PublicationDraft } from '@/lib/ao/dashboard-types'
import {
  addAoOfferCommentOf, deleteAoOfferCommentOf, deleteAoOfferOf, listAoOfferCommentsOf, previewAoPublicationOf, publishAoOfferOf,
  retryAoEmailOf, setAoOfferStatusOf, syncAoNow, type AoJobPublisher,
} from '@/lib/ao/offer-actions'
import { canUseAoSourcing } from '@/lib/ao/tenancy'
import type { UserProfile } from '@/types'

// Actions du tableau des appels d'offres d'une organisation (/recruiter/parametres/boites-ao). Chacune vérifie
// elle-même le recruteur (une Server Action est un point d'entrée public) et agit sur l'organisation de SA session,
// jamais sur un identifiant reçu du navigateur. Tous les recruteurs de l'organisation voient, commentent, publient et
// suppriment ses offres AO (ADR 0005). Pas de sourcing à la demande (décision du 2026-10-25 : appel d'IA à nos frais).

const PATH = '/recruiter/parametres/boites-ao'
const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'
const NOT_ENTITLED = 'Abonnement inactif : vos boîtes ne sont pas lues. Elles le seront dès sa réactivation.'

async function recruiter(): Promise<{ user: UserProfile; tenantId: string } | null> {
  const user = await getCurrentUser()
  return user && user.role === 'recruiter' && user.tenantId ? { user, tenantId: user.tenantId } : null
}

/** L'IA qui lit les e-mails est à nos frais : seules les organisations abonnées font lire leurs boîtes (tenancy.ts). */
async function entitled(tenantId: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
  return canUseAoSourcing(tenantId, typeof tenant.subscriptionStatus === 'string' ? tenant.subscriptionStatus : null)
}

export async function syncRecruiterAoInbox() {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!(await entitled(me.tenantId))) return { error: NOT_ENTITLED }
  return syncAoNow(me.tenantId, 'recruiter')
}

export async function retryRecruiterAoEmail(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  if (!(await entitled(me.tenantId))) return { error: NOT_ENTITLED }
  // Sans remise à zéro des essais : un recruteur avance la reprise prévue, il ne peut pas faire refacturer l'IA.
  return retryAoEmailOf(me.tenantId, id, { holder: 'recruiter', path: PATH, reset: false })
}

export async function previewRecruiterAoPublication(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return previewAoPublicationOf(me.tenantId, id)
}

/** Offre publique de l'organisation, traitée comme une offre créée par ses recruteurs (createJobAction). */
function organizationPublisher(tenantId: string): AoJobPublisher {
  return {
    async create(job, jobId) {
      const created = await createJob({
        tenantId,
        title: job.title,
        description: job.description,
        skills: job.skills.slice(0, 10),
        location: job.location || 'Non spécifié',
        contractType: job.contractType,
        remote: job.remote,
        salary: job.salary ?? undefined,
        companyName: job.companyName || undefined,
        expiresAt: oneMonthFromNow(),
      }, jobId)
      // Diffusion sur les réseaux de MyBestConsultant en arrière-plan, puis sourcing automatique : comme les autres
      // offres de l'organisation.
      const { tryAutoPublishJob } = await import('@/lib/social')
      after(() => tryAutoPublishJob(created))
      const { tryAutoSourceCandidates } = await import('@/lib/auto-source-candidates')
      await tryAutoSourceCandidates(created)
    },
    exists: async jobId => (await getJobById(jobId)) !== null,
  }
}

export async function publishRecruiterAoOffer(id: string, input: PublicationDraft) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return publishAoOfferOf(me.tenantId, id, input, organizationPublisher(me.tenantId), [PATH, '/recruiter/annonces', '/recruiter/dashboard'])
}

export async function setRecruiterAoOfferStatus(id: string, status: 'to_review' | 'ignored') {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return setAoOfferStatusOf(me.tenantId, id, status, PATH)
}

export async function listRecruiterAoOfferComments(offerId: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return listAoOfferCommentsOf(me.tenantId, me.user.userId, offerId)
}

export async function addRecruiterAoOfferComment(offerId: string, body: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return addAoOfferCommentOf(me.tenantId, me.user, offerId, body)
}

export async function deleteRecruiterAoOfferComment(commentId: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return deleteAoOfferCommentOf(me.tenantId, me.user.userId, commentId)
}

export async function deleteRecruiterAoOffer(id: string) {
  const me = await recruiter()
  if (!me) return { error: SESSION_EXPIRED }
  return deleteAoOfferOf(me.tenantId, id)
}
