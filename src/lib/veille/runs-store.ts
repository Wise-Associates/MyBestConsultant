import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import type { StoredRun } from './monitoring'
import { parseRunReport, runDocumentId, type RunReport } from './run-report'

// Rapports de passage du scanner de la veille (collection veille_runs, aucune permission client ; ADR 0030) : un
// document par passage, identifié par son début. Seulement des nombres, des libellés de sources et des messages
// d'erreur ou d'alerte (au plus l'intitulé public d'une offre refusée par le serveur d'envoi) : aucun contact, aucune
// autre durée de conservation que les passages gardés.

/** Passages gardés : quatre par jour, soit un mois de suivi (la fenêtre des totaux est de 30 jours). */
export const KEPT_RUNS = 120

export function isVeilleRunsStorageConfigured(): boolean {
  return Boolean(COLLECTIONS.VEILLE_RUNS)
}

const codeOf = (err: unknown) => (err as { code?: number }).code

/**
 * Enregistre le rapport d'un passage. Un passage déjà reçu (nouvelle tentative du scanner) n'est pas réécrit : `false`.
 * Les plus anciens au-delà de KEPT_RUNS sont ensuite supprimés.
 */
export async function saveVeilleRun(report: RunReport): Promise<boolean> {
  const { databases } = createAdminClient()
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.VEILLE_RUNS, runDocumentId(report.startedAt), {
      startedAt: report.startedAt,
      report: JSON.stringify(report),
    })
  } catch (err) {
    if (codeOf(err) === 409) return false
    throw err
  }
  await pruneOldRuns().catch(err => {
    // Le rapport est enregistré : seule la place des anciens reste à récupérer au passage suivant.
    console.error('[veille] anciens rapports de passage non supprimés', err instanceof Error ? err.message : String(err))
  })
  return true
}

async function pruneOldRuns(): Promise<void> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VEILLE_RUNS, [
    Query.orderDesc('startedAt'), Query.offset(KEPT_RUNS), Query.limit(100), Query.select(['$id']),
  ])
  for (const doc of res.documents) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.VEILLE_RUNS, doc.$id).catch(err => { if (codeOf(err) !== 404) throw err })
  }
}

/**
 * Rapports gardés, du plus récent au plus ancien. Un rapport illisible (format changé sans mise à jour) est écarté et
 * journalisé : il ne doit pas masquer les autres.
 */
export async function listVeilleRuns(): Promise<StoredRun[]> {
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.VEILLE_RUNS, [Query.orderDesc('startedAt'), Query.limit(KEPT_RUNS)])
  const runs: StoredRun[] = []
  for (const doc of res.documents as (Models.Document & { report?: unknown })[]) {
    let parsed: ReturnType<typeof parseRunReport>
    try {
      parsed = parseRunReport(JSON.parse(String(doc.report)))
    } catch (err) {
      parsed = { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (parsed.success) runs.push({ report: parsed.report })
    else console.error('[veille] rapport de passage illisible, ignoré', doc.$id, parsed.error)
  }
  return runs
}
