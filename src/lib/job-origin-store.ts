import 'server-only'
import { isDocumentId } from '@/lib/ao/access'
import { aoAccessFor } from '@/lib/ao/platform-view'
import { getAoOffer, listAoOfferDetails } from '@/lib/ao/repo'
import { aoOfferIdOfJob, type JobOrigin } from './job-origin'

/**
 * Origine de l'offre `jobId` pour un recruteur de l'organisation `tenantId` (de la session), qui ouvre déjà l'offre
 * (viewerCanOpenJob). L'e-mail AO n'est lu que s'il a été reçu dans une boîte de cette organisation (aoAccess) : une
 * offre partagée par la plateforme ne dit rien de son client ni de son expéditeur. Ne rejette jamais : une lecture en
 * échec est journalisée et rendue comme « illisible ».
 */
export async function loadJobOrigin(jobId: string, tenantId: string, shared: boolean): Promise<JobOrigin> {
  if (shared) return { kind: 'shared' }
  const offerId = aoOfferIdOfJob(jobId)
  if (!offerId) return { kind: 'platform' }
  try {
    const offer = isDocumentId(offerId) ? await getAoOffer(offerId) : null
    const owned = offer ? await aoAccessFor(tenantId).email(offer.emailId) : null
    if (!offer || !owned) return { kind: 'ao-unavailable' }
    const details = (await listAoOfferDetails([offer.$id])).get(offer.$id)
    return {
      kind: 'ao',
      offerId: offer.$id,
      channel: details?.channel ?? 'email',
      veilleSource: details?.veilleSource ?? '',
      mailbox: owned.source.label,
      email: owned.email,
    }
  } catch (err) {
    console.error('[offre] origine illisible', jobId, err instanceof Error ? err.message : err)
    return { kind: 'unreadable' }
  }
}
