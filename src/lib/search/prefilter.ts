import type { OfferCriteriaSet } from '@/lib/offer-criteria'
import { poolFilter, type OfferForSearch } from './cv-search'
import { cvIndexUid, isSearchConfigured, multiSearch } from './meili'
import { profileQueries, searchProfileOf, selectHits, type FilterResult } from './offer-filter'

// Préfiltre de la base candidats avant l'IA (ADR 0044 phase 2) : au lieu des 30 candidats inscrits le plus récemment,
// les CV de toute la base les plus proches de l'offre (index Meilisearch), puis le filtre des critères de l'offre (ADR
// 0061 phase 2, offer-filter.ts : ★ requis, assouplis pas à pas, pré-score aux poids de l'offre) : PREFILTER_KEEP au plus.

/**
 * CV notés par l'IA par passage quand le préfiltre répond (30 sans lui) : 10 depuis le filtre des critères (choix de
 * l'utilisateur du 2026-11-24 ; 15 avant).
 */
export const PREFILTER_KEEP = 10
/** Identifiants exclus envoyés à Meilisearch au plus ; au-delà, ils sont écartés après coup (scorableCandidates). */
const MAX_EXCLUDED_IN_FILTER = 1000

/**
 * Candidats de la base à noter pour cette offre (`ids`, les plus proches d'abord, hors `exclude` : candidats qui ont
 * postulé, déjà notés), avec le nombre de CV trouvés par les recherches et écartés faute d'une technologie ★ ; null si le
 * préfiltre n'est pas configuré ou ne répond pas (l'appelant fait comme avant). `criteria` : ceux de l'offre (ADR 0061),
 * sinon ses critères par défaut.
 */
export async function prefilterPool(offer: OfferForSearch, exclude: Set<string>, criteria?: OfferCriteriaSet | null): Promise<FilterResult | null> {
  if (!isSearchConfigured()) return null
  try {
    const filter = poolFilter([...exclude].slice(0, MAX_EXCLUDED_IN_FILTER))
    const profile = searchProfileOf(offer, criteria)
    const lists = await multiSearch(profileQueries(profile, filter, cvIndexUid()))
    const result = selectHits(profile, lists.map(l => l.filter(hit => !exclude.has(hit.sourceId))), PREFILTER_KEEP)
    // Rien trouvé alors que des candidats sont exclus (déjà notés, ont postulé : « Rafraîchir ») : l'index connaît-il des
    // CV pour l'offre ? Oui : il n'y a personne de nouveau, les plus récents ne doivent pas compléter (des CV jamais
    // passés par le filtre) ; non (index vide, CV pas encore classés) : ils complètent, comme sans préfiltre.
    const indexed = result.found > 0 || (exclude.size > 0 && (await multiSearch([
      { indexUid: cvIndexUid(), q: profile.titles[0] ?? '', filter: poolFilter([]), limit: 1, attributesToRetrieve: ['id'], matchingStrategy: 'last' },
    ]))[0].length > 0)
    return { ...result, indexed }
  } catch (err) {
    console.error('[recherche] préfiltre indisponible : candidats les plus récents', err instanceof Error ? err.message : err)
    return null
  }
}

/** Lieu de l'offre tel que la notation le reçoit (« Lieu : Paris », offerDetails) ; '' sans lieu. */
export const offerLocation = (details: string[] = []) => details.find(line => line.startsWith('Lieu : '))?.slice('Lieu : '.length) ?? ''
