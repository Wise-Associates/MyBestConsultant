import 'server-only'
import type { AoOfferRow } from './filters'
import { listAoOfferRows, listRecentAoEmails } from './repo'
import { listSources, type AoSource } from './sources'
import { PLATFORM_TENANT_ID } from './tenancy'
import type { AoEmail } from './types'

/**
 * Données de la page /admin/ao-offers (boîtes de la plateforme seulement, ADR 0005) : partagées par la page et par
 * chaque passage du bouton « Synchroniser maintenant », qui les renvoie pour mettre le tableau à jour au fil de l'eau.
 */
export async function loadPlatformAoView(): Promise<{ rows: AoOfferRow[]; recentEmails: AoEmail[]; sources: AoSource[] }> {
  const sources = await listSources(PLATFORM_TENANT_ID)
  const ids = sources.map(s => s.$id)
  const [rows, recentEmails] = await Promise.all([listAoOfferRows(ids), listRecentAoEmails(ids, 50)])
  return { rows, recentEmails, sources }
}
