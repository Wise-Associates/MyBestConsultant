import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { listAllDocuments } from '@/lib/appwrite/list-all'
import { getActiveJobs } from '@/lib/appwrite/jobs'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { searchableCandidateOf, SEARCHABLE_FIELDS } from '@/lib/cvtheque-candidate'
import { mapLimit } from '@/lib/concurrency'
import { offerDetails } from '@/lib/match-scoring'
import { poolRowId } from '@/lib/pool-matching'
import { alertIdealCandidates } from '@/lib/recruiter-alerts-store'
import { aoSourceContext, matchingScorer, readCvForScoring } from '@/lib/sourcing-core'
import { loadOfferCriteria } from '@/lib/offer-criteria-store'
import {
  AUTO_MATCH_DAILY_LIMIT, AUTO_MATCH_LEASE_MS, AUTO_MATCH_MIN_SCORE, autoMatchDecision, autoMatchTaskId, isAutoMatchable, matchHighlights,
  parseAutoMatchState, pickOffersForCandidate, type AutoMatchState, type AutoMatchTask,
} from '@/lib/ai-matches'
import type { ReviewStatus } from '@/lib/match-review'
import { organisationOf } from '@/lib/ai/usage'

// Correspondances IA des nouveaux candidats (ADR 0047) : file de tâches persistante (un document de AO_STATE par
// candidat, genre « automatch »), comparaison aux offres actives, association (ligne job_matches « auto »), alerte au
// recruteur de l'offre ; revue des correspondances et suppression avec le compte du candidat. Appelé par le dépôt du CV
// (actions du candidat), le cron recruiter-alerts et les actions du Matching IA, qui vérifient chacun leur appelant.

/**
 * Fonction activée (variable `AI_AUTO_MATCHING_ENABLED=true`) : à poser seulement une fois les attributs `origin`,
 * `reviewStatus`, `reviewedAt` et `reviewedBy` de job_matches créés (schema:push) — sans eux, Appwrite refuse l'écriture.
 */
export const isAutoMatchingEnabled = () => process.env.AI_AUTO_MATCHING_ENABLED === 'true' && !!COLLECTIONS.JOB_MATCHES

const TASK_KIND = 'automatch'
/** Notations simultanées pour un candidat, comme la base candidats (sourcing-core.ts). */
const SCORING_CONCURRENCY = 5
const PLATFORM_KEY = 'plateforme'
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const codeOf = (err: unknown) => (err as { code?: unknown } | null)?.code
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Champs du document de tâche (AO_STATE) : `holder` = état, `token` = candidat, `count` = essais, `expiresAt` = fin de
// la tenue d'un passage en cours. Aucune donnée personnelle (l'identifiant du profil seulement).
function taskOf(doc: Models.Document): AutoMatchTask & { candidateId: string } {
  return {
    candidateId: str(doc.token),
    state: parseAutoMatchState(doc.holder),
    attempts: typeof doc.count === 'number' ? doc.count : 0,
    createdAt: doc.$createdAt,
    leaseUntil: str(doc.expiresAt),
  }
}

/**
 * Met le candidat en file, au dépôt de son premier CV (avant la réponse : la tâche existe même si la suite est
 * interrompue). Déjà en file : rien. Ne lève jamais : le dépôt du CV ne doit pas échouer pour cela.
 */
export async function queueAutoMatching(candidateId: string): Promise<boolean> {
  if (!isAutoMatchingEnabled()) return false
  try {
    await createAdminClient().databases.createDocument(DB_ID, COLLECTIONS.AO_STATE, autoMatchTaskId(candidateId), {
      kind: TASK_KIND, holder: 'pending' satisfies AutoMatchState, token: candidateId, count: 0,
    })
    return true
  } catch (err) {
    if (codeOf(err) === 409) return true
    console.error('[correspondances IA] candidat non mis en file', message(err))
    return false
  }
}

/** 'deferred' : quota du jour plein ; 'waiting' : adresse du candidat pas encore vérifiée (la tâche attend, sans essai compté). */
export type AutoMatchOutcome = 'done' | 'failed' | 'deferred' | 'waiting' | 'skipped'

/**
 * Exécute la tâche d'un candidat si elle est due (autoMatchDecision) : la tient AUTO_MATCH_LEASE_MS, compare le candidat
 * aux offres choisies par le préfiltre, associe celles notées AUTO_MATCH_MIN_SCORE ou plus, prévient leurs recruteurs.
 * Quota du jour plein : la tâche reste en file, sans essai compté. Ne lève jamais.
 */
export async function runAutoMatching(candidateId: string, now: Date = new Date()): Promise<AutoMatchOutcome> {
  if (!isAutoMatchingEnabled()) return 'skipped'
  const { databases } = createAdminClient()
  const taskId = autoMatchTaskId(candidateId)
  let attempts = 0
  const setState = (state: AutoMatchState, extra: Record<string, unknown> = {}) =>
    databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, taskId, { holder: state, ...extra })
      .catch(err => console.error('[correspondances IA] état de la tâche non écrit', state, message(err)))
  try {
    const doc = await databases.getDocument(DB_ID, COLLECTIONS.AO_STATE, taskId).catch(err => {
      if (codeOf(err) === 404) return null
      throw err
    })
    // Jamais mis en file (pas un premier CV) : rien à faire.
    if (!doc || doc.kind !== TASK_KIND) return 'skipped'
    const task = taskOf(doc)
    const decision = autoMatchDecision(task, now)
    if (decision === 'abandon') {
      console.warn('[correspondances IA] candidat abandonné après', task.attempts, 'essai(s)', candidateId)
      await setState('abandoned')
      return 'failed'
    }
    if (decision === 'wait') return 'skipped'
    attempts = task.attempts + 1
    // Tenue écrite avant tout appel : un autre passage (cron, second onglet) attend sa fin. Deux passages lancés à la
    // même milliseconde pourraient tous deux continuer : sans double association ni double e-mail (identifiants fixes).
    await databases.updateDocument(DB_ID, COLLECTIONS.AO_STATE, taskId, {
      holder: 'running' satisfies AutoMatchState, count: attempts, expiresAt: new Date(now.getTime() + AUTO_MATCH_LEASE_MS).toISOString(),
    })

    const result = await compareWithOffers(candidateId, now)
    if (result === 'deferred' || result === 'waiting') {
      // Essai non compté : la tâche attend une place du quota, ou que le candidat vérifie son adresse.
      await setState('pending', { count: attempts - 1, expiresAt: null })
      return result
    }
    await setState(result === 'failed' ? 'failed' : 'done', { expiresAt: null })
    return result
  } catch (err) {
    console.error('[correspondances IA] analyse du candidat en échec', candidateId, message(err))
    if (attempts > 0) await setState('failed', { expiresAt: null })
    return 'failed'
  }
}

/** Comparaison elle-même ; 'done' aussi quand il n'y avait rien à comparer (profil vide, aucune offre proche). */
async function compareWithOffers(candidateId: string, now: Date): Promise<'done' | 'failed' | 'deferred' | 'waiting'> {
  const { databases, users } = createAdminClient()
  const doc = await readCandidate(candidateId)
  // Compte supprimé, autre rôle, CV retiré, candidat désinscrit des sollicitations : rien à comparer.
  if (!doc || !isAutoMatchable(doc as { role?: unknown; cvFileId?: unknown; optedOutOfOutreach?: unknown })) return 'done'
  // Adresse vérifiée exigée avant tout appel d'IA et tout e-mail aux recruteurs (inscription libre : des comptes jetables
  // épuiseraient le quota de la plateforme et feraient écrire la plateforme aux recruteurs ; revue du 2026-11-18). Compte
  // bloqué : rien. Le cron reprend la tâche une fois l'adresse vérifiée (72 h au plus).
  if (!str(doc.userId)) return 'done'
  const auth = await users.get(str(doc.userId)).catch(err => {
    if (codeOf(err) === 404) return null
    throw err
  })
  if (!auth || auth.status === false) return 'done'
  if (auth.emailVerification !== true) return 'waiting'
  const cvFileId = str(doc.cvFileId)
  const candidate = searchableCandidateOf(doc as unknown as Record<string, unknown>)

  // Offres déjà liées au candidat (candidature, correspondance) : ni recomparées, ni réassociées.
  const [offers, applications, existing] = await Promise.all([
    getActiveJobs(),
    listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [Query.equal('candidateId', candidateId), Query.select(['$id', 'jobId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [
      Query.equal('candidateId', candidateId), Query.select(['$id', 'jobId', 'origin', 'score', 'reason']),
    ]),
  ])
  const offersById = new Map(offers.map(j => [j.$id, j]))
  const alertFor = (s: { jobId: string; score: number; reason: string }) => ({
    jobId: s.jobId, source: 'base' as const, subjectId: candidateId, score: s.score,
    highlights: matchHighlights(s.reason, candidate.skills, offersById.get(s.jobId)?.skills ?? []),
  })
  // Associations d'un essai précédent interrompu avant ses alertes : alertées maintenant (une alerte a un identifiant fixe,
  // celles déjà faites ne repartent pas).
  const earlier = existing
    .filter(d => d.origin === 'auto' && typeof d.score === 'number' && offersById.has(str(d.jobId)))
    .map(d => ({ jobId: str(d.jobId), score: d.score as number, reason: str(d.reason) }))
  const exclude = new Set([...applications, ...existing].map(d => str(d.jobId)))
  const picked = pickOffersForCandidate(candidate, offers, exclude)
  if (picked.length === 0) {
    await alertIdealCandidates(earlier.map(alertFor))
    return 'done'
  }

  const slot = await takeDailySlotId('autoMatchAll', PLATFORM_KEY, now, AUTO_MATCH_DAILY_LIMIT)
  if (!slot) {
    console.warn('[correspondances IA] quota du jour atteint pour la plateforme : candidat remis en file')
    return 'deferred'
  }
  let cvText: string
  try {
    cvText = await readCvForScoring(cvFileId)
  } catch (err) {
    // CV illisible (fichier abîmé, format) : la place n'a rien coûté.
    await releaseDailySlot(slot).catch(e => console.error('[correspondances IA] place du quota non rendue', message(e)))
    throw err
  }
  // PDF scanné, sans texte : jamais une note sur un texte vide.
  if (!cvText.trim()) {
    await releaseDailySlot(slot).catch(e => console.error('[correspondances IA] place du quota non rendue', message(e)))
    return 'done'
  }

  // Une notation par offre, la même que « Rafraîchir » du Matching IA (matchingScorer : critères de l'offre ou barème du
  // matching, cache des notations, préfixe mis en cache chez Claude) : le candidat a le même score dans l'alerte et dans
  // l'offre.
  let failed = false
  const scores = (await mapLimit(picked, SCORING_CONCURRENCY, async job => {
    try {
      // Critères de l'offre s'il y en a (ADR 0061), comme « Rafraîchir » du Matching IA.
      const scored = await matchingScorer({
        title: job.title ?? '', skills: job.skills, description: job.description ?? '', details: offerDetails(job),
        sourceContext: await aoSourceContext(job), criteria: await loadOfferCriteria(job.$id),
        tenantId: organisationOf(job.tenantId),
      })(cvText)
      // Réponse sans jugement lisible : offre non notée (jamais un score inventé).
      if (!scored) {
        failed = true
        return null
      }
      return { jobId: job.$id, score: scored.score, reason: scored.reason }
    } catch (err) {
      failed = true
      console.error('[correspondances IA] notation d’une offre en échec', job.$id, message(err))
      return null
    }
  })).filter((s): s is { jobId: string; score: number; reason: string } => s !== null)
  // Toutes les comparaisons en échec (IA indisponible) : réessayé par le cron ; place rendue, sans quoi chaque essai
  // d'une panne en prendrait une.
  if (failed && scores.length === 0) {
    await releaseDailySlot(slot).catch(e => console.error('[correspondances IA] place du quota non rendue', message(e)))
    return 'failed'
  }
  if (failed) console.warn('[correspondances IA] une partie des offres non comparées', candidateId)

  const byId = new Map(picked.map(j => [j.$id, j]))
  const kept = scores.filter(s => s.score >= AUTO_MATCH_MIN_SCORE && byId.has(s.jobId))
  const created: typeof kept = []
  for (const s of kept) {
    const job = byId.get(s.jobId)!  // filtré juste au-dessus (byId.has)
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.JOB_MATCHES, poolRowId(s.jobId, candidateId), {
        tenantId: job.tenantId, jobId: s.jobId, candidateId, score: s.score, reason: s.reason.slice(0, 1000),
        origin: 'auto', reviewStatus: 'nouveau' satisfies ReviewStatus,
      })
      created.push(s)
    } catch (err) {
      // Déjà associé (Matching IA de l'offre entre-temps) : la ligne existante et son statut de revue restent.
      if (codeOf(err) !== 409) throw err
    }
  }
  // Compte supprimé pendant l'analyse (jusqu'à 2 minutes) : ses associations sont retirées, sans alerte (RGPD).
  if (created.length > 0 && !await readCandidate(candidateId)) {
    for (const s of created) {
      await databases.deleteDocument(DB_ID, COLLECTIONS.JOB_MATCHES, poolRowId(s.jobId, candidateId)).catch(err => { if (codeOf(err) !== 404) throw err })
    }
    return 'done'
  }
  await alertIdealCandidates([...earlier, ...created].map(alertFor))
  return 'done'
}

/** Profil du candidat (champs de la CV Thèque et désinscription) ; null s'il n'existe plus. */
async function readCandidate(candidateId: string): Promise<Models.Document | null> {
  return createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId, [
    Query.select([...SEARCHABLE_FIELDS, 'optedOutOfOutreach', 'userId']),
  ]).catch(err => {
    if (codeOf(err) === 404) return null
    throw err
  })
}

/** Passages du cron : tâches dues reprises une à une tant que le temps le permet. Renvoie le nombre de candidats traités. */
export async function sweepAutoMatching(now: Date, budgetMs: number): Promise<{ processed: number; pending: number }> {
  if (!isAutoMatchingEnabled()) return { processed: 0, pending: 0 }
  const started = Date.now()
  const { databases } = createAdminClient()
  const docs = (await databases.listDocuments(DB_ID, COLLECTIONS.AO_STATE, [
    Query.equal('kind', TASK_KIND), Query.equal('holder', ['pending', 'running', 'failed']), Query.orderAsc('$createdAt'), Query.limit(100),
  ])).documents
  let processed = 0
  for (const doc of docs) {
    // Une analyse prend jusqu'à 2 minutes : pas de nouvelle tâche si elle risque de dépasser la durée de la route.
    if (Date.now() - started > budgetMs) break
    const task = taskOf(doc)
    if (!task.candidateId || autoMatchDecision(task, now) === 'wait') continue
    const outcome = await runAutoMatching(task.candidateId, now)
    if (outcome !== 'skipped' && outcome !== 'waiting') processed++
    if (outcome === 'deferred') break // quota du jour plein : les suivantes aussi attendraient
  }
  await purgeFinishedTasks(now)
  return { processed, pending: docs.length - processed }
}

/** Tâches finies ou abandonnées de plus de 30 jours supprimées (100 par passage). */
async function purgeFinishedTasks(now: Date): Promise<void> {
  const { databases } = createAdminClient()
  try {
    const old = await databases.listDocuments(DB_ID, COLLECTIONS.AO_STATE, [
      Query.equal('kind', TASK_KIND), Query.equal('holder', ['done', 'abandoned']),
      Query.lessThan('$updatedAt', new Date(now.getTime() - 30 * 86_400_000).toISOString()), Query.limit(100),
    ])
    for (const doc of old.documents) {
      await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, doc.$id).catch(err => { if (codeOf(err) !== 404) throw err })
    }
  } catch (err) {
    console.error('[correspondances IA] tâches anciennes non purgées', message(err))
  }
}

/**
 * Statut de revue d'une correspondance de la base candidats, par le recruteur `reviewerId` (profil). L'appelant a
 * vérifié qu'il ouvre l'offre ; la ligne doit être de cette offre. false : correspondance introuvable.
 */
export async function setMatchReview(jobId: string, matchId: string, status: ReviewStatus, reviewerId: string, now: Date = new Date()): Promise<boolean> {
  const { databases } = createAdminClient()
  const doc = await databases.getDocument(DB_ID, COLLECTIONS.JOB_MATCHES, matchId, [Query.select(['$id', 'jobId'])]).catch(err => {
    if (codeOf(err) === 404) return null
    throw err
  })
  if (!doc || doc.jobId !== jobId) return false
  await databases.updateDocument(DB_ID, COLLECTIONS.JOB_MATCHES, matchId, { reviewStatus: status, reviewedAt: now.toISOString(), reviewedBy: reviewerId })
  return true
}

/**
 * Correspondances d'un candidat supprimées avec son compte (elles citent son CV), et sa tâche. Lève en cas d'échec :
 * la suppression du compte s'arrête, comme pour ses autres données.
 */
export async function deleteJobMatchesOfCandidate(candidateId: string): Promise<void> {
  // Collection non configurée : rien à supprimer (sinon toute suppression de compte serait refusée).
  if (!COLLECTIONS.JOB_MATCHES) return
  const { databases } = createAdminClient()
  const rows = await listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('candidateId', candidateId), Query.select(['$id'])])
  for (const row of rows) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.JOB_MATCHES, row.$id).catch(err => { if (codeOf(err) !== 404) throw err })
  }
  if (COLLECTIONS.AO_STATE) {
    await databases.deleteDocument(DB_ID, COLLECTIONS.AO_STATE, autoMatchTaskId(candidateId)).catch(err => { if (codeOf(err) !== 404) throw err })
  }
}
