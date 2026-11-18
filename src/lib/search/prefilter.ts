import { offerSearchQueries, poolFilter, rankHits, type OfferForSearch } from './cv-search'
import { cvIndexUid, isSearchConfigured, multiSearch } from './meili'

// Préfiltre de la base candidats avant l'IA (ADR 0044 phase 2) : au lieu des 30 candidats inscrits le plus récemment,
// les CV de toute la base les plus proches de l'offre (index Meilisearch, puis pré-score du code), PREFILTER_KEEP au plus.

/** CV notés par l'IA par passage quand le préfiltre répond (30 sans lui) : moins d'appels, mieux choisis. */
export const PREFILTER_KEEP = 15
/** Identifiants exclus envoyés à Meilisearch au plus ; au-delà, ils sont écartés après coup (scorableCandidates). */
const MAX_EXCLUDED_IN_FILTER = 1000

/**
 * Identifiants des candidats de la base à noter pour cette offre, les plus proches d'abord, hors `exclude` (candidats qui
 * ont postulé, déjà notés) ; null si le préfiltre n'est pas configuré ou ne répond pas (l'appelant fait comme avant).
 */
export async function prefilterPool(offer: OfferForSearch, exclude: Set<string>): Promise<string[] | null> {
  if (!isSearchConfigured()) return null
  try {
    const filter = poolFilter([...exclude].slice(0, MAX_EXCLUDED_IN_FILTER))
    const lists = await multiSearch(offerSearchQueries(offer, filter, cvIndexUid()))
    return rankHits(offer, lists.map(l => l.filter(hit => !exclude.has(hit.sourceId))), PREFILTER_KEEP)
  } catch (err) {
    console.error('[recherche] préfiltre indisponible : candidats les plus récents', err instanceof Error ? err.message : err)
    return null
  }
}

/** Lieu de l'offre tel que la notation le reçoit (« Lieu : Paris », offerDetails) ; '' sans lieu. */
export const offerLocation = (details: string[] = []) => details.find(line => line.startsWith('Lieu : '))?.slice('Lieu : '.length) ?? ''
