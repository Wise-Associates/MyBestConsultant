import type { AoSource } from './sources'
import type { AoEmail, AoOffer } from './types'

/** Lectures dont dépend le contrôle d'accès : Appwrite en production (aoAccessFor, platform-view.ts), données fictives en test. */
export interface AoAccessStore {
  getEmail(id: string): Promise<AoEmail | null>
  getSource(id: string): Promise<AoSource | null>
  getOffer(id: string): Promise<AoOffer | null>
}

/** Identifiant de document Appwrite (36 caractères au plus, lettres, chiffres, « . », « _ », « - »). */
const DOCUMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
export const isDocumentId = (id: unknown): id is string => typeof id === 'string' && DOCUMENT_ID.test(id)

/**
 * E-mails et offres AO d'une organisation (ADR 0005) : un document est à elle si son e-mail a été lu dans une de ses
 * boîtes (offre → e-mail → boîte → organisation : `ao_offers` est à 16/16 attributs, sans organisation). Sinon null,
 * comme un document inexistant : une organisation ne lit ni ne modifie les offres d'une autre, la plateforme comprise,
 * et la plateforme n'agit que sur ses propres boîtes. `tenantId` vient toujours de la session de l'appelant.
 */
export function aoAccess(store: AoAccessStore, tenantId: string) {
  async function email(id: string): Promise<{ email: AoEmail; source: AoSource } | null> {
    if (!isDocumentId(id)) return null
    const found = await store.getEmail(id)
    const source = found?.sourceId ? await store.getSource(found.sourceId) : null
    return found && source?.tenantId === tenantId ? { email: found, source } : null
  }

  async function offer(id: string): Promise<AoOffer | null> {
    if (!isDocumentId(id)) return null
    const found = await store.getOffer(id)
    return found && (await email(found.emailId)) ? found : null
  }

  return { email, offer }
}
