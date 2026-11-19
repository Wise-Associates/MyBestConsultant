import 'server-only'
import { createHash } from 'node:crypto'
import { AppwriteException, Query } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import {
  DEFAULT_WEIGHTS, mergeOverride, parseRecruiterWeights, parseWeightsOverride, withOverride, type RecruiterWeights, type ScaleWeights,
  type WeightsOverride,
} from '@/lib/scoring-weights'
import type { ActiveScale } from '@/lib/match-scoring'

// Poids personnels du recruteur (scoring-weights.ts) gardés dans les préférences de son compte Appwrite : propres à la
// personne, sans collection ni attribut à créer. Les préférences portent aussi le jeton d'invitation (team.ts) : on les
// relit pour les compléter, jamais pour les remplacer.

const PREF_KEY = 'scoringWeights'

/** Poids du recruteur `authUserId` ; préférences illisibles : poids par défaut et `unreadable` (journalisé). */
export async function loadRecruiterWeights(authUserId: string): Promise<{ weights: RecruiterWeights; unreadable: boolean }> {
  try {
    const prefs = await createAdminClient().users.getPrefs(authUserId) as Record<string, unknown>
    return { weights: parseRecruiterWeights(prefs[PREF_KEY]), unreadable: false }
  } catch (e) {
    console.error('[poids] préférences du recruteur non lues : poids par défaut', e instanceof Error ? e.message : e)
    return { weights: DEFAULT_WEIGHTS, unreadable: true }
  }
}

/**
 * Enregistre les poids d'un barème (déjà validés : ScaleWeightsSchemas) dans les préférences du compte : l'autre barème
 * et les autres préférences sont relus et gardés.
 */
export async function saveRecruiterWeights(authUserId: string, scale: ActiveScale, weights: ScaleWeights): Promise<void> {
  const { users } = createAdminClient()
  const prefs = await users.getPrefs(authUserId) as Record<string, unknown>
  const current = parseRecruiterWeights(prefs[PREF_KEY])
  await users.updatePrefs(authUserId, { ...prefs, [PREF_KEY]: { ...current, [scale]: weights } })
}

// Poids d'un recruteur pour une offre et pour un candidat de cette offre (ADR 0049) : collection `job_scoring_weights`,
// un document par compte, offre et candidat (`candidate` vide : l'offre), d'identifiant déduit des trois. Champ
// `weights` : poids remplaçants par barème (WeightsOverride, JSON). Serveur seulement, aucune permission client ; l'accès
// à l'offre est contrôlé par l'appelant (requireJobAccess, matching-actions.ts), et un recruteur ne lit et n'écrit que les
// siens (son compte).

export const isJobWeightsConfigured = () => !!COLLECTIONS.JOB_SCORING_WEIGHTS

/** Identifiant du document (36 caractères au plus) ; `candidate` : clé candidateWeightsKey, absente pour l'offre. */
const weightsDocId = (authUserId: string, jobId: string, candidate?: string) =>
  `jw${createHash('sha256').update(candidate ? `${authUserId}:${jobId}:${candidate}` : `${authUserId}:${jobId}`).digest('hex').slice(0, 34)}`

export interface JobWeightsState {
  /** Poids qui s'appliquent pour l'offre : ceux de l'offre, sinon les globaux du recruteur, sinon ceux par défaut. */
  weights: RecruiterWeights
  /** Poids globaux du recruteur (bouton « Pondération globale »). */
  global: RecruiterWeights
  /** Poids du matching propres à l'offre ; null : ses poids globaux s'appliquent. */
  job: ScaleWeights | null
  /** Poids propres à un candidat de l'offre, par clé candidateWeightsKey ; à appliquer par-dessus `weights` (withOverride). */
  candidates: Record<string, WeightsOverride>
  /** Poids globaux illisibles (poids par défaut appliqués). */
  unreadable: boolean
  /** Poids de l'offre illisibles (poids globaux appliqués). */
  jobUnreadable: boolean
  /** Poids d'au moins un candidat illisibles (ceux de l'offre lui sont appliqués). */
  candidatesUnreadable: boolean
}

/**
 * Candidats pondérés au plus par recruteur et par offre : borne le nombre de documents qu'un compte peut créer (une clé
 * de candidat inexistante est refusée, mais l'inscription d'un recruteur est libre) et la lecture de chaque page.
 */
export const MAX_WEIGHTED_CANDIDATES = 200

/** Poids enregistrés par ce recruteur pour l'offre et ses candidats (une lecture, bornée). Une panne est levée. */
async function readJobDocs(authUserId: string, jobId: string): Promise<Pick<JobWeightsState, 'job' | 'candidates' | 'jobUnreadable' | 'candidatesUnreadable'>> {
  const empty = { job: null, candidates: {}, jobUnreadable: false, candidatesUnreadable: false }
  if (!isJobWeightsConfigured()) return empty
  // L'offre et MAX_WEIGHTED_CANDIDATES candidats : une page suffit (l'écriture refuse au-delà).
  const { documents: docs, total } = await createAdminClient().databases.listDocuments(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, [
    Query.equal('userId', authUserId), Query.equal('jobId', jobId), Query.select(['$id', 'candidate', 'weights']),
    Query.limit(MAX_WEIGHTED_CANDIDATES + 1),
  ])
  if (total > docs.length) console.error('[poids] plus de poids enregistrés que la limite pour une offre : les suivants sont ignorés', jobId, total)
  const state: Pick<JobWeightsState, 'job' | 'candidates' | 'jobUnreadable' | 'candidatesUnreadable'> = { ...empty, candidates: {} }
  for (const doc of docs) {
    const override = parseWeightsOverride(doc.weights)
    const candidate = typeof doc.candidate === 'string' ? doc.candidate : ''
    if (!override) {
      console.error('[poids] poids invalides ignorés', jobId, candidate ? 'candidat' : 'offre')
      if (candidate) state.candidatesUnreadable = true
      else state.jobUnreadable = true
    } else if (!candidate) state.job = override.matching ?? null
    else state.candidates[candidate] = override
  }
  return state
}

/** Poids d'un recruteur pour une offre et ses candidats (Matching IA, pipeline et « Réponse client »). Ne lève jamais. */
export async function loadWeightsForJob(authUserId: string, jobId: string): Promise<JobWeightsState> {
  const [{ weights: global, unreadable }, saved] = await Promise.all([
    loadRecruiterWeights(authUserId),
    readJobDocs(authUserId, jobId).catch(err => {
      console.error('[poids] poids de l\'offre non lus : poids globaux', jobId, err instanceof Error ? err.message : err)
      return { job: null, candidates: {}, jobUnreadable: true, candidatesUnreadable: true }
    }),
  ])
  return { weights: withOverride(global, saved.job && { matching: saved.job }), global, ...saved, unreadable }
}

/** Crée ou remplace un document de poids (deux onglets : le dernier enregistrement l'emporte). */
async function upsertWeightsDoc(id: string, data: { userId: string; jobId: string; candidate: string; weights: string }): Promise<void> {
  const { databases } = createAdminClient()
  try {
    await databases.updateDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id, data)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id, data)
    } catch (createErr) {
      if (!(createErr instanceof AppwriteException && createErr.code === 409)) throw createErr
      await databases.updateDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id, data)
    }
  }
}

async function deleteWeightsDoc(id: string): Promise<void> {
  await createAdminClient().databases.deleteDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id).catch(err => {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
  })
}

/** Poids du matching d'une offre pour ce recruteur (déjà validés : ScaleWeightsSchemas.matching) ; null : les retire. */
export async function saveJobWeights(authUserId: string, jobId: string, weights: ScaleWeights | null): Promise<void> {
  const id = weightsDocId(authUserId, jobId)
  if (!weights) return deleteWeightsDoc(id)
  await upsertWeightsDoc(id, { userId: authUserId, jobId, candidate: '', weights: JSON.stringify({ matching: weights }) })
}

/**
 * Poids d'un barème pour un candidat de l'offre (clé candidateWeightsKey et poids déjà validés) ; null : retire ceux de
 * ce barème (et le document s'il n'en reste aucun). L'autre barème du candidat est relu et gardé (mergeOverride).
 * Lecture puis écriture sans verrou : deux enregistrements simultanés des deux barèmes d'un même candidat (deux onglets)
 * peuvent en perdre un — limité aux poids de ce recruteur pour ce candidat, accepté. Un document illisible est remplacé.
 */
export async function saveCandidateWeights(
  authUserId: string, jobId: string, candidate: string, scale: ActiveScale, weights: ScaleWeights | null,
): Promise<'saved' | 'limit'> {
  const { databases } = createAdminClient()
  const id = weightsDocId(authUserId, jobId, candidate)
  let current: WeightsOverride | null = null
  let exists = true
  try {
    current = parseWeightsOverride((await databases.getDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, id)).weights)
  } catch (err) {
    if (!(err instanceof AppwriteException && err.code === 404)) throw err
    exists = false
  }
  const next = mergeOverride(current, scale, weights)
  if (!next) {
    await deleteWeightsDoc(id)
    return 'saved'
  }
  if (!exists) {
    // Nouveau candidat pondéré : l'offre compte pour un document, d'où la limite + 1.
    const { total } = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, [
      Query.equal('userId', authUserId), Query.equal('jobId', jobId), Query.select(['$id']), Query.limit(1),
    ])
    if (total >= MAX_WEIGHTED_CANDIDATES + 1) return 'limit'
  }
  await upsertWeightsDoc(id, { userId: authUserId, jobId, candidate, weights: JSON.stringify(next) })
  return 'saved'
}

/** Supprime tous les poids qui répondent à `field` = `value`, par pages de 100 jusqu'au dernier. */
async function deleteWeightsWhere(field: 'jobId' | 'userId', value: string): Promise<void> {
  const { databases } = createAdminClient()
  for (;;) {
    const docs = await databases.listDocuments(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, [Query.equal(field, value), Query.select(['$id']), Query.limit(100)])
    await Promise.all(docs.documents.map(d => databases.deleteDocument(DB_ID, COLLECTIONS.JOB_SCORING_WEIGHTS, d.$id)))
    if (docs.documents.length < 100) return
  }
}

/** Offre supprimée : les poids de tous ses recruteurs le sont aussi. Jamais bloquant : un échec est journalisé. */
export async function deleteWeightsOfJob(jobId: string): Promise<void> {
  if (!isJobWeightsConfigured()) return
  await deleteWeightsWhere('jobId', jobId).catch(err =>
    console.error('[poids] poids de l\'offre supprimée non effacés', jobId, err instanceof Error ? err.message : err))
}

/**
 * Compte supprimé : ses poids d'offre le sont aussi. Jamais bloquant (des nombres, aucune donnée personnelle) : un
 * échec est journalisé, les documents restants sont sans effet (plus aucun compte ne les lit).
 */
export async function deleteWeightsOfUser(authUserId: string): Promise<void> {
  if (!isJobWeightsConfigured()) return
  await deleteWeightsWhere('userId', authUserId).catch(err =>
    console.error('[poids] poids d\'offre du compte supprimé non effacés', err instanceof Error ? err.message : err))
}
