import { CV_INDEX_SETTINGS, type CvSearchDocument, type SearchHit } from './cv-search'
import type { RawStats } from './cv-stats'

// Accès à Meilisearch (ADR 0044 phase 2) par son API REST, sans dépendance : quelques appels seulement (documents,
// réglages, recherche). Serveur seulement : l'URL et la clé ne sont jamais envoyées au navigateur, et Meilisearch n'est
// joignable que depuis le réseau interne du VPS. Non configuré (MEILI_URL vide) : rien n'est indexé, le matching garde
// son comportement d'avant (les candidats les plus récents).

const config = () => ({
  url: (process.env.MEILI_URL ?? '').replace(/\/+$/, ''),
  key: process.env.MEILI_API_KEY ?? '',
  index: process.env.MEILI_INDEX_CVS || 'cvs',
})

export const isSearchConfigured = () => !!config().url && !!config().key
export const cvIndexUid = () => config().index

export class MeiliError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Appel à l'API ; lève MeiliError (statut HTTP, 0 si injoignable ou délai dépassé) avec le message de Meilisearch. */
async function meili<T>(method: string, path: string, body?: unknown, timeoutMs = 5_000): Promise<T> {
  const { url, key } = config()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    throw new MeiliError(0, `Meilisearch injoignable (${err instanceof Error ? err.name : 'erreur'})`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 300)
    try { message = (JSON.parse(text) as { message?: string }).message ?? message } catch { /* corps non JSON */ }
    throw new MeiliError(res.status, `Meilisearch ${res.status} : ${message}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

interface EnqueuedTask { taskUid: number }

/** Attend la fin d'une tâche (écritures asynchrones de Meilisearch) ; lève si elle échoue ou dépasse `timeoutMs`. */
export async function waitForTask(taskUid: number, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const task = await meili<{ status: string; error?: { message?: string } }>('GET', `/tasks/${taskUid}`)
    if (task.status === 'succeeded') return
    if (task.status === 'failed' || task.status === 'canceled') throw new MeiliError(0, `tâche ${taskUid} ${task.status} : ${task.error?.message ?? ''}`)
    if (Date.now() > until) throw new MeiliError(0, `tâche ${taskUid} toujours en cours après ${timeoutMs / 1000} s`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

/** Crée l'index s'il manque et applique ses réglages (idempotent) ; renvoie la tâche des réglages. */
export async function applyCvIndexSettings(): Promise<number> {
  const uid = cvIndexUid()
  try {
    await waitForTask((await meili<EnqueuedTask>('POST', '/indexes', { uid, primaryKey: 'id' })).taskUid)
  } catch (err) {
    // Index déjà présent : la tâche de création échoue avec index_already_exists, rien à faire.
    if (!(err instanceof MeiliError && /already exists/i.test(err.message))) throw err
  }
  return (await meili<EnqueuedTask>('PATCH', `/indexes/${encodeURIComponent(uid)}/settings`, CV_INDEX_SETTINGS)).taskUid
}

/** Ajoute ou remplace des documents (tâche asynchrone). */
export async function upsertCvDocuments(docs: CvSearchDocument[]): Promise<number> {
  return (await meili<EnqueuedTask>('PUT', `/indexes/${encodeURIComponent(cvIndexUid())}/documents`, docs, 30_000)).taskUid
}

/** Retire des documents (tâche asynchrone). */
export async function deleteCvDocuments(ids: string[]): Promise<number> {
  return (await meili<EnqueuedTask>('POST', `/indexes/${encodeURIComponent(cvIndexUid())}/documents/delete-batch`, ids)).taskUid
}

/** Identifiants de tous les documents de l'index (réconciliation). */
export async function listCvDocumentIds(): Promise<string[]> {
  const ids: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await meili<{ results: { id: string }[]; total: number }>(
      'GET', `/indexes/${encodeURIComponent(cvIndexUid())}/documents?fields=id&limit=1000&offset=${offset}`, undefined, 30_000)
    ids.push(...page.results.map(d => d.id))
    if (page.results.length < 1000) return ids
  }
}

/** Plusieurs recherches en un appel ; résultats dans l'ordre des requêtes. */
export async function multiSearch(queries: object[]): Promise<SearchHit[][]> {
  const res = await meili<{ results: { hits: SearchHit[] }[] }>('POST', '/multi-search', { queries }, 5_000)
  return res.results.map(r => r.hits)
}

/**
 * Une page des CV qui répondent au filtre, du dépôt le plus récent au plus ancien (sans date : à la fin) ; `totalHits`
 * exact jusqu'à 1 000 (réglage par défaut de l'index, au-delà Meilisearch ne compte ni ne décale).
 */
export async function searchCvPage<T>(filter: string, page: number, hitsPerPage: number, attributes: readonly string[]): Promise<{ hits: T[]; totalHits: number; totalPages: number }> {
  return meili('POST', `/indexes/${encodeURIComponent(cvIndexUid())}/search`,
    { q: '', filter, sort: ['cvDate:desc'], page, hitsPerPage, attributesToRetrieve: attributes }, 8_000)
}

/** Comptes de plusieurs filtres en un seul appel (multi-search), dans l'ordre des requêtes ; aucun CV renvoyé. */
export async function facetCountsMany(queries: { filter: string; facets: readonly string[] }[]): Promise<RawStats[]> {
  if (!queries.length) return []
  const indexUid = cvIndexUid()
  const res = await meili<{ results: RawStats[] }>('POST', '/multi-search',
    { queries: queries.map(q => ({ indexUid, q: '', filter: q.filter, facets: q.facets, limit: 0 })) }, 8_000)
  return res.results
}

/**
 * Métiers (facette `roles`) des CV dont les métiers exercés contiennent tous les mots de `q`, avec leur nombre de CV ;
 * aucun CV renvoyé. Autres intitulés proposés pour une offre (related-titles.ts).
 */
export async function roleCounts(q: string, filter: string): Promise<Record<string, number>> {
  const res = await meili<{ facetDistribution?: { roles?: Record<string, number> } }>('POST', `/indexes/${encodeURIComponent(cvIndexUid())}/search`,
    { q, filter, attributesToSearchOn: ['roles'], matchingStrategy: 'all', facets: ['roles'], limit: 0 }, 5_000)
  return res.facetDistribution?.roles ?? {}
}

/** Comptes par champ (facettes) et bornes des champs numériques des CV qui répondent au filtre ; aucun CV renvoyé. */
export async function facetCounts(filter: string, facets: readonly string[]): Promise<RawStats> {
  return meili<RawStats>('POST', `/indexes/${encodeURIComponent(cvIndexUid())}/search`, { q: '', filter, facets, limit: 0 }, 8_000)
}
