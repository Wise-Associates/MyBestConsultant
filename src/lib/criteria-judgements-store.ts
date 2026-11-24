import 'server-only'
import { createHash } from 'node:crypto'
import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { listAllByValues } from '@/lib/appwrite/list-all'
import { judgementKey } from './criteria-view'

// Jugements de l'IA pour d'autres libellés que ceux de l'offre (ADR 0061 phase 3) : critères propres d'un recruteur pour
// l'offre ou pour un candidat. Collection `criteria_judgements`, un document par offre, empreinte des libellés et
// candidat (clé candidateWeightsKey : `p:` base candidats, `v:` CV du vivier), d'identifiant déduit des trois : deux
// recruteurs qui ont les mêmes libellés partagent ces jugements (leurs poids s'appliquent à l'affichage). `reason` :
// résumé v3 puis la phrase de l'IA, comme la raison d'un score de l'offre. Effacés avec l'offre et avec le candidat
// (compte, CV du vivier). Serveur seulement, aucune permission client ; l'accès à l'offre est contrôlé par l'appelant.

/** Taille de l'attribut `reason` (appwrite.config.json). */
export const JUDGEMENT_REASON_MAX = 1000

export const isCriteriaJudgementsConfigured = () => !!COLLECTIONS.CRITERIA_JUDGEMENTS

const judgementDocId = (jobId: string, fingerprint: string, candidate: string) =>
  `cj${createHash('sha256').update(`${jobId}:${fingerprint}:${candidate}`).digest('hex').slice(0, 34)}`

/** Jugements enregistrés de l'offre pour ces empreintes : judgementKey(empreinte, candidat) → raison. Une panne est levée. */
export async function loadJudgements(jobId: string, fingerprints: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!isCriteriaJudgementsConfigured() || fingerprints.length === 0) return map
  // Une empreinte par candidat réglé (jusqu'à 200) : par lots (Appwrite refuse plus de 100 valeurs), `$id` lu pour la
  // pagination (list-all.ts).
  const docs = await listAllByValues(createAdminClient().databases, DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, 'fingerprint', fingerprints, [
    Query.equal('jobId', jobId), Query.select(['$id', 'candidate', 'fingerprint', 'reason']),
  ])
  for (const d of docs) map.set(judgementKey(String(d.fingerprint), String(d.candidate)), String(d.reason))
  return map
}

/** Enregistre (ou remplace) le jugement d'un candidat pour ces libellés. */
export async function saveJudgement(jobId: string, fingerprint: string, candidate: string, reason: string): Promise<void> {
  const { databases } = createAdminClient()
  const id = judgementDocId(jobId, fingerprint, candidate)
  const data = { jobId, fingerprint, candidate, reason: [...reason].slice(0, JUDGEMENT_REASON_MAX).join('') }
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, id, data)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 409)) throw err
    await databases.updateDocument(DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, id, { reason: data.reason })
  }
}

/** Supprime un jugement (son candidat ou son offre a été supprimé pendant qu'il était écrit). */
export async function deleteJudgement(jobId: string, fingerprint: string, candidate: string): Promise<void> {
  await createAdminClient().databases.deleteDocument(DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, judgementDocId(jobId, fingerprint, candidate)).catch(err => {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
  })
}

/** Supprime les jugements qui répondent à `field` = `value`, par pages de 100. */
async function deleteWhere(field: 'jobId' | 'candidate', value: string): Promise<void> {
  const { databases } = createAdminClient()
  for (;;) {
    const docs = await databases.listDocuments(DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, [Query.equal(field, value), Query.select(['$id']), Query.limit(100)])
    await Promise.all(docs.documents.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.CRITERIA_JUDGEMENTS, d.$id)))
    if (docs.documents.length < 100) return
  }
}

/** Offre supprimée : ses jugements aussi. Jamais bloquant : un échec est journalisé. */
export async function deleteJudgementsOfJob(jobId: string): Promise<void> {
  if (!isCriteriaJudgementsConfigured()) return
  await deleteWhere('jobId', jobId).catch(err =>
    console.error('[critères] jugements de l\'offre supprimée non effacés', jobId, err instanceof Error ? err.message : err))
}

/** Candidat supprimé (compte `p:<profil>`, CV du vivier `v:<document>`) : ses jugements aussi. Jamais bloquant. */
export async function deleteJudgementsOfCandidate(candidate: string): Promise<void> {
  if (!isCriteriaJudgementsConfigured()) return
  await deleteWhere('candidate', candidate).catch(err =>
    console.error('[critères] jugements du candidat supprimé non effacés', err instanceof Error ? err.message : err))
}
