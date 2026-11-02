import 'server-only'
import { aoAccess } from './access'
import type { AoOfferNeighbours, AoPageView } from './dashboard-types'
import { AO_PAGE_SIZE, type AoFilters, type AoOfferRow } from './filters'
import { aoOfferCounts, getAoEmail, getAoOffer, getAoOfferRow, listAoOfferIds, listAoOfferRowsRange, listRecentAoEmails } from './repo'
import { getAoSource, listSources, type AoSource } from './sources'
import { PLATFORM_TENANT_ID } from './tenancy'

/** Contrôle d'accès aux e-mails et offres AO de l'organisation `tenantId` (access.ts), sur les données Appwrite. */
export const aoAccessFor = (tenantId: string) => aoAccess({ getEmail: getAoEmail, getSource: getAoSource, getOffer: getAoOffer }, tenantId)

/** Paramètres d'adresse tels que Next.js les donne à une page (une clé répétée : la première valeur). */
export function searchParamsOf(record: Record<string, string | string[] | undefined>): URLSearchParams {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(record)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) sp.set(key, first)
  }
  return sp
}

/** Tableau vide (chargement impossible : la page affiche l'erreur). */
export const emptyAoView = (): AoPageView => ({
  rows: [], total: 0, size: AO_PAGE_SIZE, counts: { toReview: 0, published: 0, ignored: 0, duplicates: 0, received: 0 }, recentEmails: [],
})

/**
 * Données du tableau AO d'une organisation (ses boîtes seulement, ADR 0005) pour des filtres : partagées par la page et
 * par chaque passage du bouton « Synchroniser maintenant », qui les renvoie pour mettre le tableau à jour au fil de
 * l'eau. `tenantId` vient de la session de l'appelant (plateforme : /admin/candidats ; recruteur :
 * /recruiter/parametres/boites-ao). `size` : offres affichées (`nb` de l'adresse, par 50).
 */
export async function loadAoView(tenantId: string, filters: AoFilters, size = AO_PAGE_SIZE): Promise<AoPageView & { sources: AoSource[] }> {
  const sources = await listSources(tenantId)
  const [{ rows, total }, counts, recentEmails] = await Promise.all([
    listAoOfferRowsRange(tenantId, filters, 0, size),
    aoOfferCounts(tenantId, filters),
    listRecentAoEmails(sources.map(s => s.$id), 50),
  ])
  return { rows, total, size, counts, recentEmails, sources }
}

/** Page /admin/candidats (boîtes de la plateforme). */
export const loadPlatformAoView = (filters: AoFilters, size = AO_PAGE_SIZE) => loadAoView(PLATFORM_TENANT_ID, filters, size)

/** Offre de la page de détail ; null si elle n'est pas à l'organisation `tenantId` ou n'existe plus. */
export async function loadAoOfferRow(tenantId: string, offerId: string | null): Promise<AoOfferRow | null> {
  if (!offerId) return null
  const offer = await aoAccessFor(tenantId).offer(offerId)
  return offer ? getAoOfferRow(offer, tenantId) : null
}

/**
 * Offres précédente et suivante de `offerId` dans la liste filtrée (mêmes filtres et même ordre que le tableau, lus dans
 * l'adresse de la page de l'offre). Seulement des identifiants de l'organisation : chaque page d'offre revérifie
 * l'accès.
 */
export async function loadAoNeighbours(tenantId: string, filters: AoFilters, offerId: string): Promise<AoOfferNeighbours> {
  const ids = await listAoOfferIds(tenantId, filters)
  const index = ids.indexOf(offerId)
  if (index < 0) return { previous: null, next: null, position: null, total: ids.length }
  return { previous: ids[index - 1] ?? null, next: ids[index + 1] ?? null, position: index + 1, total: ids.length }
}
