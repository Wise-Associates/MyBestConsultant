import { createHash } from 'node:crypto'
import { AppwriteException } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { CRITERIA_MAX_CHARS, parseCriteriaSet, type OfferCriteriaSet } from './offer-criteria'

// Critères généraux d'une offre publiée (ADR 0061), ceux de tous ses recruteurs : gardés dans `job_scoring_weights`
// (ADR 0049, poids par offre), un document par offre, `userId` = OFFER_CRITERIA_OWNER (aucun compte), `candidate` vide,
// `criteria` = critères en JSON (validés à l'écriture et à la lecture), `weights` = « {} » (attribut obligatoire, sans
// objet ici). Les lectures des poids d'un recruteur filtrent sur son compte : elles ne voient jamais ce document ; la
// suppression des poids d'une offre (deleteWeightsOfJob) l'efface avec eux. Serveur seulement, aucune permission client ;
// l'accès à l'offre est contrôlé par l'appelant. Pas de marqueur « server-only » : chargé par sourcing-core.ts, que
// scripts/matching-explain.mts lance hors de Next.js.

/**
 * Valeur de `userId` des critères généraux : « @ » n'est pas permis dans un identifiant Appwrite (a-z, A-Z, 0-9, « . »,
 * « - », « _ »), aucun compte ne peut donc la porter — sinon supprimer ce compte (deleteWeightsOfUser) effacerait les
 * critères de toutes les offres (revue du 2026-11-24 : « offre » était un identifiant de compte possible).
 */
export const OFFER_CRITERIA_OWNER = '@offre'

export const isOfferCriteriaConfigured = () => !!COLLECTIONS.JOB_SCORING_WEIGHTS

const criteriaDocId = (jobId: string) => `jc${createHash('sha256').update(jobId).digest('hex').slice(0, 34)}`

/**
 * Critères généraux de l'offre `jobId` ; null sans critères (offre notée sur le barème « matching », comme avant), ou
 * critères enregistrés devenus invalides (journalisé). Une panne de lecture est levée : noter sur le barème une offre qui
 * a des critères donnerait des scores d'une autre pondération.
 */
export async function loadOfferCriteria(jobId: string): Promise<OfferCriteriaSet | null> {
  if (!isOfferCriteriaConfigured()) return null
  let raw: unknown
  try {
    raw = (await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, criteriaDocId(jobId))).criteria
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) return null
    throw err
  }
  const set = parseCriteriaSet(raw)
  if (!set && raw) console.error('[critères] critères de l’offre illisibles : notation sur le barème « matching »', jobId)
  return set
}

/** Texte enregistré des critères (déjà validés : CriteriaSetSchema) ; null s'ils dépassent l'attribut. */
export function serializeCriteria(set: OfferCriteriaSet): string | null {
  const text = JSON.stringify(set)
  return text.length <= CRITERIA_MAX_CHARS ? text : null
}

/**
 * Enregistre les critères généraux de l'offre (déjà validés) ; lève si la collection n'est pas configurée, s'ils sont
 * trop longs ou si l'écriture échoue (l'appelant le signale : l'offre est alors notée sur le barème).
 */
export async function saveOfferCriteria(jobId: string, set: OfferCriteriaSet): Promise<void> {
  if (!isOfferCriteriaConfigured()) throw new Error('collection des pondérations par offre non configurée (APPWRITE_COLLECTION_JOB_SCORING_WEIGHTS)')
  const criteria = serializeCriteria(set)
  if (!criteria) throw new Error('Critères trop longs : retirez des libellés.')
  const { databases } = createAdminClient()
  const id = criteriaDocId(jobId)
  const data = { userId: OFFER_CRITERIA_OWNER, jobId, candidate: '', weights: '{}', criteria }
  try {
    await databases.createDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id, data)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 409)) throw err
    await databases.updateDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id, { criteria })
  }
}
