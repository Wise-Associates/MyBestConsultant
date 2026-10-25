import 'server-only'
import type { AoOfferRow } from './filters'
import { listAoOfferRows, listRecentAoEmails } from './repo'
import { listSources, type AoSource } from './sources'
import { PLATFORM_TENANT_ID } from './tenancy'
import type { AoEmail } from './types'

/**
 * Données du tableau AO d'une organisation (ses boîtes seulement, ADR 0005) : partagées par la page et par chaque
 * passage du bouton « Synchroniser maintenant », qui les renvoie pour mettre le tableau à jour au fil de l'eau.
 * `tenantId` vient de la session de l'appelant (plateforme : /admin/candidats ; recruteur : /recruiter/parametres/boites-ao).
 */
export async function loadAoView(tenantId: string): Promise<{ rows: AoOfferRow[]; recentEmails: AoEmail[]; sources: AoSource[] }> {
  const sources = await listSources(tenantId)
  const ids = sources.map(s => s.$id)
  const [rows, recentEmails] = await Promise.all([listAoOfferRows(ids), listRecentAoEmails(ids, 50)])
  return { rows, recentEmails, sources }
}

/** Données de la page /admin/candidats (boîtes de la plateforme). */
export const loadPlatformAoView = () => loadAoView(PLATFORM_TENANT_ID)
