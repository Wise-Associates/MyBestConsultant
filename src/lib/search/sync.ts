import { Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite/config'
import { listAllByValues, listAllDocuments } from '@/lib/appwrite/list-all'
import type { CvClassification } from '@/lib/cv-classification'
import { cvSearchDocument, type CvSearchDocument } from './cv-search'
import { MeiliError, applyCvIndexSettings, deleteCvDocuments, listCvDocumentIds, upsertCvDocuments, waitForTask } from './meili'

// Réconciliation de l'index de recherche des CV avec Appwrite (ADR 0044 phase 2) : réglages de l'index, chaque CV classé
// (cv_classifications) écrit, les documents qui n'y correspondent plus retirés. Idempotente. Deux appelants :
// - la tâche planifiée du serveur (/api/cron/search-sync, deploy/crontab, mbc-cron.sh search-sync) — l'application est
//   la seule à joindre Meilisearch, sur le réseau Docker interne, sans port publié ;
// - `npm run search:sync` sur un poste qui joint Meilisearch (celui de docker-compose.yml en local, ou un tunnel).
// Aucune donnée de CV n'est renvoyée ni journalisée : des nombres seulement.

const BATCH = 500
const TASK_TIMEOUT_MS = 120_000

/** Ce que la synchronisation écrirait et retirerait. */
export interface CvIndexPlan {
  docs: CvSearchDocument[]
  /** Documents de l'index sans classification (CV supprimé, candidat disparu). */
  stale: string[]
  /** Documents dans l'index avant la synchronisation. */
  indexed: number
  /** CV classés sans date de dépôt connue (fichier introuvable). */
  undated: number
  /** Classifications au JSON illisible, ignorées. */
  unreadable: number
}

/** Prépare la synchronisation : lit Appwrite et la liste des documents de l'index ; ne modifie rien. */
export async function planCvIndexSync(): Promise<CvIndexPlan> {
  const { databases, storage } = createAdminClient()
  const classifications = await listAllDocuments(databases, DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, [
    Query.select(['$id', 'kind', 'sourceId', 'tenantId', 'ownerId', 'data']),
  ])
  // Rôle et désinscription des candidats et profils de chasseurs (filtres de l'index), lus d'un coup.
  const userIds = classifications.filter(d => d.kind === 'candidate').map(d => String(d.sourceId))
  const users = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', userIds, [Query.select(['$id', '$updatedAt', 'role', 'optedOutOfOutreach', 'cvFileId'])])
  const userById = new Map(users.map(u => [u.$id, u]))
  // Dates de dépôt (fraîcheur et tendances des statistiques) : CV des candidats d'après leur fichier, lus en une liste
  // du bucket plutôt qu'un appel par CV ; CV des viviers d'après leur import ; profil sans fichier : sa dernière modification.
  const fileDates = new Map<string, string>()
  for (let cursor: string | undefined; ;) {
    const page = await storage.listFiles(BUCKETS.CVS, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])])
    for (const f of page.files) fileDates.set(f.$id, f.$createdAt)
    if (page.files.length < 100) break
    cursor = page.files[page.files.length - 1].$id
  }
  const vivierIds = classifications.filter(d => d.kind === 'vivier').map(d => String(d.sourceId))
  const viviers = await listAllByValues(databases, DB_ID, COLLECTIONS.VIVIER_CVS, '$id', vivierIds, [Query.select(['$id', '$createdAt'])])
  const vivierDate = new Map(viviers.map(v => [v.$id, v.$createdAt]))

  let unreadable = 0
  const docs = classifications.flatMap(d => {
    let classification: CvClassification
    try {
      classification = JSON.parse(String(d.data)) as CvClassification
    } catch {
      unreadable++ // compté et renvoyé : la classification sera refaite par npm run cv:classify
      return []
    }
    const kind = d.kind === 'vivier' ? 'vivier' as const : 'candidate' as const
    const user = kind === 'candidate' ? userById.get(String(d.sourceId)) : undefined
    // Candidat supprimé entre-temps : pas indexé (sa classification sera effacée par npm run cv:classify).
    if (kind === 'candidate' && !user) return []
    return [cvSearchDocument({
      id: d.$id, kind, sourceId: String(d.sourceId), tenantId: String(d.tenantId ?? ''), ownerId: String(d.ownerId ?? ''),
      role: kind === 'vivier' ? 'vivier' : String(user?.role ?? ''), optedOut: user?.optedOutOfOutreach === true, classification,
      cvDate: kind === 'vivier' ? vivierDate.get(String(d.sourceId)) ?? null
        : user?.cvFileId ? fileDates.get(String(user.cvFileId)) ?? null : user?.$updatedAt ?? null,
    })]
  })
  const wanted = new Set(docs.map(d => d.id))
  let indexed: string[] = []
  try {
    indexed = await listCvDocumentIds()
  } catch (err) {
    // Index pas encore créé : tout est à écrire.
    if (!(err instanceof MeiliError && err.status === 404)) throw err
  }
  return {
    docs, stale: indexed.filter(id => !wanted.has(id)), indexed: indexed.length,
    undated: docs.filter(d => d.cvDate === null).length, unreadable,
  }
}

/** Applique un plan : réglages de l'index (un changement de CV_INDEX_SETTINGS passe ici), documents écrits, documents en trop retirés. */
export async function applyCvIndexSync(plan: CvIndexPlan, onProgress?: (written: number, total: number) => void): Promise<{ written: number; removed: number }> {
  await waitForTask(await applyCvIndexSettings(), TASK_TIMEOUT_MS)
  for (let i = 0; i < plan.docs.length; i += BATCH) {
    await waitForTask(await upsertCvDocuments(plan.docs.slice(i, i + BATCH)), TASK_TIMEOUT_MS)
    onProgress?.(Math.min(i + BATCH, plan.docs.length), plan.docs.length)
  }
  for (let i = 0; i < plan.stale.length; i += BATCH) {
    await waitForTask(await deleteCvDocuments(plan.stale.slice(i, i + BATCH)), TASK_TIMEOUT_MS)
  }
  return { written: plan.docs.length, removed: plan.stale.length }
}
