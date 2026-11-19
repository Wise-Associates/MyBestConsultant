import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import {
  RISING_RECENT_MONTHS, STAT_FACETS, cvStatsView, risingSkills, sinceFilter, statsFilter, treeWithRoles, treeWithSkills,
  type CvStatsView, type JobTreeNode, type RisingSkill, type StatRow, type StatsScope,
} from './cv-stats'
import { selectionFilter, type StatSelection } from './cv-stats-selection'
import { MeiliError, facetCounts, facetCountsMany, isSearchConfigured } from './meili'

// Lecture des statistiques d'un périmètre (ADR 0044 phase 3) : comptes de l'index, et nombre de CV du périmètre dans
// Appwrite pour dire quelle part est déjà classée (pendant le rattrapage), avec les candidats en recherche (base
// candidats). Serveur seulement ; le périmètre est construit par la page à partir de la session, jamais reçu du navigateur.

export type CvStatsResult =
  | {
    state: 'ok'; view: CvStatsView; cvCount: number | null; /** null : pas assez de CV datés pour comparer. */ rising: RisingSkill[] | null
    /** Arbre familles → métiers → compétences ; null s'il n'a pas pu être lu (le reste de la page s'affiche). */
    tree: JobTreeNode[] | null
    /** Base candidats : candidats en recherche parmi les `cvCount` qui ont un CV ; null pour un autre périmètre ou illisible. */
    jobSeekers: number | null
  }
  | { state: 'off' }
  | { state: 'error' }

/** Nombre de documents qui répondent aux requêtes (aucun document lu). */
async function count(collection: string, queries: string[]): Promise<number> {
  const { databases } = createAdminClient()
  return (await databases.listDocuments(DB_ID, collection, [...queries, Query.limit(1), Query.select(['$id'])])).total
}

/** Base candidats dans Appwrite : les candidats qui ont un CV (ceux de la CV Thèque). */
const POOL_WITH_CV = [Query.equal('role', 'candidate'), Query.isNotNull('cvFileId')]

/** Nombre de CV du périmètre dans Appwrite ; null s'il n'a pas pu être lu (la part classée n'est alors pas affichée). */
async function cvCountOf(scope: StatsScope): Promise<number | null> {
  // Candidats avec un CV ; profils de chasseurs, avec ou sans fichier (un profil saisi à la main est classé aussi).
  const pool = () => count(COLLECTIONS.USERS, POOL_WITH_CV)
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

/**
 * Candidats de la base qui ont décoché « En recherche de mission » sur leur profil (demande du 2026-11-19 : candidats en
 * recherche sur le total). Les autres sont en recherche : case jamais modifiée (valeur absente sur les profils plus anciens
 * que la case) comprise, comme le profil et la CV Thèque. Lu dans Appwrite et non dans l'index : la case change sans
 * nouveau classement du CV. null hors base candidats, ou s'il n'a pas pu être lu.
 */
async function notSeekingOf(scope: StatsScope): Promise<number | null> {
  if (scope.kind !== 'pool') return null
  try {
    return await count(COLLECTIONS.USERS, [...POOL_WITH_CV, Query.equal('openToWork', false)])
  } catch (err) {
    console.error('[statistiques] nombre de candidats en recherche illisible', err instanceof Error ? err.message : err)
    return null
  }
}

/** Nombres lus dans Appwrite : CV du périmètre, et candidats en recherche (base candidats). */
async function appwriteCounts(scope: StatsScope): Promise<{ cvCount: number | null; jobSeekers: number | null }> {
  const [cvCount, notSeeking] = await Promise.all([cvCountOf(scope), notSeekingOf(scope)])
  // Deux lectures distinctes : un candidat qui change entre les deux ne doit pas donner un nombre négatif.
  return { cvCount, jobSeekers: cvCount !== null && notSeeking !== null ? Math.max(0, cvCount - notSeeking) : null }
}

/**
 * Arbre « Métiers en détail » : métiers des CV de chaque famille, puis compétences des CV de chaque métier, deux appels
 * groupés. Chaque nœud est compté avec le filtre de la liste de ses profils (selectionFilter, champ « arbre ») : le
 * nombre affiché et la liste ouverte portent sur les mêmes CV.
 */
async function loadJobTree(filter: string, families: StatRow[], now: Date): Promise<JobTreeNode[] | null> {
  const nodeFilter = (selection: StatSelection) => `(${filter}) AND (${selectionFilter(selection, now)})`
  try {
    const byFamily = await facetCountsMany(families.map(f => ({ filter: nodeFilter({ field: 'arbre', famille: f.key }), facets: ['roles'] })))
    const withRoles = treeWithRoles(families, byFamily)
    const roles = withRoles.flatMap(f => f.children.map((r): StatSelection => ({ field: 'arbre', famille: f.key, metier: r.key })))
    const byRole = await facetCountsMany(roles.map(s => ({ filter: nodeFilter(s), facets: ['skills'] })))
    return treeWithSkills(withRoles, byRole)
  } catch (err) {
    console.error('[statistiques] arbre des métiers illisible', err instanceof Error ? err.message : err)
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
    const [raw, recent, older, counts] = await Promise.all([
      facetCounts(filter, STAT_FACETS),
      facetCounts(sinceFilter(filter, RISING_RECENT_MONTHS, now, 'recent'), split),
      facetCounts(sinceFilter(filter, RISING_RECENT_MONTHS, now, 'older'), split),
      appwriteCounts(scope),
    ])
    const view = cvStatsView(raw, now)
    return { state: 'ok', view, ...counts, rising: risingSkills(recent, older), tree: await loadJobTree(filter, view.families, now) }
  } catch (err) {
    // Index pas encore créé (aucune synchronisation) : aucun CV classé, ce n'est pas une panne.
    if (err instanceof MeiliError && err.status === 404) return { state: 'ok', view: cvStatsView({}, now), ...await appwriteCounts(scope), rising: null, tree: [] }
    console.error('[statistiques] index de recherche illisible', scope.kind, err instanceof Error ? err.message : err)
    return { state: 'error' }
  }
}
