import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import {
  RISING_RECENT_MONTHS, STAT_FACETS, cvStatsView, risingSkills, sinceFilter, statsFilter, type CvStatsView, type RisingSkill, type StatsScope,
} from './cv-stats'
import { MeiliError, facetCounts, isSearchConfigured } from './meili'

// Lecture des statistiques d'un périmètre (ADR 0044 phase 3) : comptes de l'index, et nombre de CV du périmètre dans
// Appwrite pour dire quelle part est déjà classée (pendant le rattrapage). Serveur seulement ; le périmètre est construit
// par la page à partir de la session, jamais reçu du navigateur.

export type CvStatsResult =
  | { state: 'ok'; view: CvStatsView; cvCount: number | null; /** null : pas assez de CV datés pour comparer. */ rising: RisingSkill[] | null }
  | { state: 'off' }
  | { state: 'error' }

/** Nombre de CV du périmètre dans Appwrite ; null s'il n'a pas pu être lu (la part classée n'est alors pas affichée). */
async function cvCountOf(scope: StatsScope): Promise<number | null> {
  const { databases } = createAdminClient()
  const count = async (collection: string, queries: string[]) =>
    (await databases.listDocuments(DB_ID, collection, [...queries, Query.limit(1), Query.select(['$id'])])).total
  // Candidats avec un CV ; profils de chasseurs, avec ou sans fichier (un profil saisi à la main est classé aussi).
  const pool = () => count(COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.isNotNull('cvFileId')])
  const hunters = () => count(COLLECTIONS.USERS, [Query.equal('role', 'hunter_profile')])
  const viviers = () => count(COLLECTIONS.VIVIER_CVS, [])
  try {
    switch (scope.kind) {
      case 'pool': return await pool()
      case 'hunters': return await hunters()
      case 'viviers': return await viviers()
      case 'platform': return (await Promise.all([pool(), hunters(), viviers()])).reduce((a, b) => a + b, 0)
      case 'vivier': return await count(COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', scope.tenantId), Query.equal('recruiterId', scope.ownerId)])
      case 'tenant': return await count(COLLECTIONS.VIVIER_CVS, [Query.equal('tenantId', scope.tenantId)])
    }
  } catch (err) {
    console.error('[statistiques] nombre de CV illisible', scope.kind, err instanceof Error ? err.message : err)
    return null
  }
}

export async function loadCvStats(scope: StatsScope, now = new Date()): Promise<CvStatsResult> {
  if (!isSearchConfigured()) return { state: 'off' }
  const filter = statsFilter(scope)
  if (!filter) return { state: 'error' }
  try {
    // Compétences en hausse : les mêmes comptes, CV récents d'un côté, plus anciens de l'autre (date de dépôt).
    const split = ['kind', 'skills'] as const
    const [raw, recent, older, cvCount] = await Promise.all([
      facetCounts(filter, STAT_FACETS),
      facetCounts(sinceFilter(filter, RISING_RECENT_MONTHS, now, 'recent'), split),
      facetCounts(sinceFilter(filter, RISING_RECENT_MONTHS, now, 'older'), split),
      cvCountOf(scope),
    ])
    return { state: 'ok', view: cvStatsView(raw, now), cvCount, rising: risingSkills(recent, older) }
  } catch (err) {
    // Index pas encore créé (aucune synchronisation) : aucun CV classé, ce n'est pas une panne.
    if (err instanceof MeiliError && err.status === 404) return { state: 'ok', view: cvStatsView({}, now), cvCount: await cvCountOf(scope), rising: null }
    console.error('[statistiques] index de recherche illisible', scope.kind, err instanceof Error ? err.message : err)
    return { state: 'error' }
  }
}
