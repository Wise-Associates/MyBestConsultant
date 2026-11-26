import 'server-only'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { listAllByValues, listAllDocuments } from '@/lib/appwrite/list-all'
import { mapLimit } from '@/lib/concurrency'
import type { CvProfile } from '@/lib/cv-profile-extract'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { deleteJudgement, isCriteriaJudgementsConfigured, loadJudgements, saveJudgement } from '@/lib/criteria-judgements-store'
import { isAutoMatchable } from '@/lib/ai-matches'
import { extraFingerprints, judgementKey, rescoredStored, type CriteriaContext } from '@/lib/criteria-view'
import { loadOfferCriteria } from '@/lib/offer-criteria-store'
import { offerDetails } from '@/lib/match-scoring'
import { matchVivierCvAgainstJob, runPoolMatching, vivierCvText } from '@/lib/matching-core'
import { criteriaFingerprint, type OfferCriteriaSet } from '@/lib/offer-criteria'
import { aoSourceContext, criteriaScorer, readCvForScoring, type OfferForMatching } from '@/lib/sourcing-core'

// Notations demandées par un changement de critères (ADR 0061 phase 3), en arrière-plan (after() des actions du Matching
// IA) :
// - critères généraux de l'offre : libellés changés, les candidats de l'offre sont renotés comme par « Rafraîchir »
//   (base candidats déjà notés, CV des viviers de l'offre) ; poids ou ★ seuls, leurs scores enregistrés sont recalculés
//   sans IA (les seuils automatiques les lisent) ;
// - critères propres d'un recruteur (offre ou candidat) aux libellés nouveaux : jugés pour ses candidats — base
//   candidats notés pour l'offre et CV de son vivier de l'offre —, JUDGE_MAX par passage, enregistrés dans
//   criteria_judgements (criteria-judgements-store.ts) et partagés par les recruteurs aux mêmes libellés.

/** CV jugés au plus par passage pour des critères propres (environ 2 min à 5 en parallèle) ; la suite : « Noter la suite ». */
export const JUDGE_MAX = 40
/** Passages par jour de la notation sur des critères propres : par organisation, pour toutes (l'IA est à nos frais). */
export const CRITERIA_JUDGE_DAILY_LIMITS = { perOrganisation: 20, allOrganisations: 200 } as const

const CONCURRENCY = 5
/** CV des viviers de l'offre renotés au plus après un changement de ses libellés (comme la base, RESCORE_MAX). */
const VIVIER_RESCORE_MAX = 120
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Place du quota du jour pour une notation sur des critères propres (adresse e-mail vérifiée exigée : l'inscription est
 * libre) : `release` la rend (enregistrement en échec, rien à noter) ; sinon le message du refus.
 */
export async function takeCriteriaJudgeSlot(emailVerified: boolean, tenantId: string, now = new Date()): Promise<{ error: string } | { release: () => Promise<void> }> {
  if (!emailVerified) return { error: 'Vérifiez votre adresse e-mail (lien reçu à l’inscription) pour faire noter vos candidats sur vos critères.' }
  const own = await takeDailySlotId('criteriaJudgeOrg', tenantId, now, CRITERIA_JUDGE_DAILY_LIMITS.perOrganisation)
  if (!own) return { error: `Limite de ${CRITERIA_JUDGE_DAILY_LIMITS.perOrganisation} notations sur des critères propres par jour atteinte pour votre organisation : réessayez demain.` }
  const all = await takeDailySlotId('criteriaJudgeAll', 'platform', now, CRITERIA_JUDGE_DAILY_LIMITS.allOrganisations)
  if (!all) {
    console.warn('[critères] plafond quotidien des notations sur des critères propres atteint pour toutes les organisations')
    // La place de l'organisation n'a pas servi : rendue.
    await releaseDailySlot(own)
    return { error: 'Trop de notations demandées aujourd’hui sur la plateforme : réessayez demain.' }
  }
  return {
    release: async () => {
      await Promise.all([releaseDailySlot(own), releaseDailySlot(all)]).catch(err =>
        console.error('[critères] place du quota non rendue', message(err)))
    },
  }
}

/**
 * Critères qui s'appliquent pour ce recruteur sur une offre notée sur ses critères (criteria-view.ts) : ceux de l'offre,
 * les siens (`own`, `candidates` : loadWeightsForJob) et les jugements enregistrés pour leurs libellés ; null si l'offre
 * n'a pas de critères. Critères de l'offre illisibles : levé (la page s'arrête plutôt que de montrer d'autres scores) ;
 * jugements illisibles : journalisé, scores de l'offre affichés « en cours de notation ».
 */
export async function loadCriteriaContext(jobId: string, saved: { criteria: OfferCriteriaSet | null; candidateCriteria: Record<string, OfferCriteriaSet> }): Promise<CriteriaContext | null> {
  const general = await loadOfferCriteria(jobId)
  if (!general) return null
  const base = { general, own: saved.criteria, candidates: saved.candidateCriteria }
  const judgements = await loadJudgements(jobId, extraFingerprints(base)).catch(err => {
    console.error('[critères] jugements des critères propres non lus', jobId, message(err))
    return new Map<string, string>()
  })
  return { ...base, judgements }
}

/**
 * L'offre telle que la notation la lit (comme matchCandidatesForJob), ou null si elle n'existe plus. `tenantId` :
 * organisation du recruteur qui déclenche la notation (journal de consommation de l'IA, ADR 0064).
 */
async function offerOf(jobId: string, tenantId: string): Promise<OfferForMatching | null> {
  const job = await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.JOBS, jobId).catch(err => {
    if ((err as { code?: unknown }).code === 404) return null
    throw err
  })
  if (!job) return null
  return {
    title: String(job.title ?? ''), skills: (job.skills as string[]) ?? [], description: String(job.description ?? ''),
    details: offerDetails(job), sourceContext: await aoSourceContext(job), tenantId,
  }
}

const profileOf = (doc: Models.Document): CvProfile | null => {
  try {
    return doc.cvProfileJson ? JSON.parse(String(doc.cvProfileJson)) as CvProfile : null
  } catch {
    return null // profil illisible : le texte du fichier seul
  }
}

/** Le candidat (`p:` profil, `v:` CV du vivier) et l'offre existent-ils encore ? */
async function stillExists(jobId: string, key: string): Promise<boolean> {
  const { databases } = createAdminClient()
  const exists = (collection: string, id: string) => databases.getDocument(DB_ID, collection, id).then(() => true, err => {
    if ((err as { code?: unknown }).code === 404) return false
    throw err
  })
  return (await exists(COLLECTIONS.JOBS, jobId)) && exists(key.startsWith('v:') ? COLLECTIONS.VIVIER_CVS : COLLECTIONS.USERS, key.slice(2))
}

/**
 * Candidats d'une offre à juger pour un recruteur : base candidats notés pour l'offre — seulement des candidats avec CV et
 * non désinscrits (isAutoMatchable : un candidat qui s'est désinscrit n'est plus envoyé à l'IA, revue de sécurité du
 * 2026-11-24) —, CV de son vivier de l'offre.
 */
async function candidatesOf(jobId: string, vivierOwner: string): Promise<{ key: string; cvText: () => Promise<string> }[]> {
  const { databases } = createAdminClient()
  const [pool, vivier] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('jobId', jobId), Query.select(['$id', 'candidateId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [
      Query.equal('jobId', jobId), Query.equal('recruiterId', vivierOwner), Query.select(['$id', 'cvFileId', 'cvProfileJson']),
    ]),
  ])
  const users = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', [...new Set(pool.map(m => String(m.candidateId)))], [
    Query.select(['$id', 'role', 'cvFileId', 'optedOutOfOutreach']),
  ])
  return [
    ...users.filter(u => isAutoMatchable({ role: u.role, cvFileId: u.cvFileId, optedOutOfOutreach: u.optedOutOfOutreach })).map(u => ({ key: `p:${u.$id}`, cvText: () => readCvForScoring(String(u.cvFileId)) })),
    ...vivier.map(v => ({ key: `v:${v.$id}`, cvText: () => vivierCvText(v.cvFileId as string | undefined, profileOf(v)) })),
  ]
}

export interface JudgeOutcome {
  judged: number
  failed: number
  /** Candidats encore à juger pour ces libellés (passage suivant). */
  remaining: number
  /** Refus de `beforeAi` (quota) : rien n'a été jugé. */
  refused?: string
}

/**
 * Juge les candidats de l'offre pour les libellés de `set` (critères propres d'un recruteur), JUDGE_MAX au plus, ceux
 * déjà jugés passés ; `only` : ces candidats seulement (critères propres d'un candidat). `beforeAi` (place du quota) n'est
 * appelé que s'il reste quelqu'un à juger ; son refus arrête tout. Une erreur d'un CV est comptée, jamais bloquante pour
 * les autres.
 */
export async function judgeOnCriteria(
  jobId: string, set: OfferCriteriaSet, scope: { vivierOwner: string; tenantId: string; only?: string[] }, beforeAi?: () => Promise<string | null>,
): Promise<JudgeOutcome> {
  if (!isCriteriaJudgementsConfigured()) return { judged: 0, failed: 0, remaining: 0 }
  const offer = await offerOf(jobId, scope.tenantId)
  if (!offer) return { judged: 0, failed: 0, remaining: 0 }
  const fingerprint = criteriaFingerprint(set)
  const [done, all] = await Promise.all([loadJudgements(jobId, [fingerprint]), candidatesOf(jobId, scope.vivierOwner)])
  const todo = all.filter(c => !done.has(judgementKey(fingerprint, c.key)) && (!scope.only || scope.only.includes(c.key)))
  const batch = todo.slice(0, JUDGE_MAX)
  if (batch.length === 0) return { judged: 0, failed: 0, remaining: 0 }
  const refused = beforeAi ? await beforeAi() : null
  if (refused) return { judged: 0, failed: 0, remaining: todo.length, refused }
  const score = criteriaScorer({ ...offer, criteria: set }, set)
  let judged = 0
  let failed = 0
  await mapLimit(batch, CONCURRENCY, async c => {
    try {
      const text = await c.cvText()
      const scored = text ? await score(text) : null
      if (!scored) {
        failed++
        return
      }
      await saveJudgement(jobId, fingerprint, c.key, scored.reason)
      // Candidat ou offre supprimés pendant la notation (plusieurs minutes) : le jugement écrit après leur suppression
      // n'est pas gardé (appréciation de l'IA sur un CV supprimé).
      if (!await stillExists(jobId, c.key)) {
        await deleteJudgement(jobId, fingerprint, c.key)
        return
      }
      judged++
    } catch (err) {
      failed++
      console.error('[critères] candidat non jugé pour des critères propres', jobId, message(err))
    }
  })
  if (failed > 0) console.error('[critères] candidats non jugés pour des critères propres', jobId, failed)
  return { judged, failed, remaining: todo.length - batch.length }
}

/**
 * Après un changement des critères généraux de l'offre (`previous` : ceux d'avant, null si elle n'en avait pas).
 * Libellés changés : renotation (IA) des candidats de la base déjà notés et des CV des viviers de l'offre. Mêmes libellés :
 * scores enregistrés recalculés sans IA. Ne lève jamais (journalisé) : la page montre les scores à renoter, et
 * « Rafraîchir » termine ce qu'un passage interrompu (durée de la requête) n'a pas fait.
 */
export async function rescoreGeneral(jobId: string, previous: OfferCriteriaSet | null, next: OfferCriteriaSet, tenantId: string): Promise<void> {
  const { databases } = createAdminClient()
  try {
    const vivier = await listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [
      Query.equal('jobId', jobId), Query.select(['$id', 'matchScore', 'matchReason', 'cvProfileJson']),
    ])
    if (!previous || criteriaFingerprint(previous) !== criteriaFingerprint(next)) {
      const pool = await runPoolMatching(jobId, undefined, 'all', tenantId)
      if (pool.error) console.error('[critères] renotation de la base candidats incomplète', jobId, pool.error)
      // Viviers : au plus autant que la base (RESCORE_MAX de matching-core.ts), les autres restent « à renoter ».
      await mapLimit(vivier.slice(0, VIVIER_RESCORE_MAX), CONCURRENCY, async v => {
        const profile = profileOf(v)
        if (profile) await matchVivierCvAgainstJob(jobId, v.$id, profile)
      })
      return
    }
    const pool = await listAllDocuments(databases, DB_ID, COLLECTIONS.JOB_MATCHES, [Query.equal('jobId', jobId), Query.select(['$id', 'score', 'reason'])])
    const poolChanges = rescoredStored(pool.map(m => ({ id: m.$id, score: Number(m.score), reason: String(m.reason ?? '') })), next)
    const vivierChanges = rescoredStored(vivier.flatMap(v => (typeof v.matchScore === 'number'
      ? [{ id: v.$id, score: v.matchScore, reason: String(v.matchReason ?? '') }] : [])), next)
    await mapLimit(poolChanges, CONCURRENCY, c => databases.updateDocument(DB_ID, COLLECTIONS.JOB_MATCHES, c.id, { score: c.score }))
    await mapLimit(vivierChanges, CONCURRENCY, c => databases.updateDocument(DB_ID, COLLECTIONS.VIVIER_CVS, c.id, { matchScore: c.score }))
  } catch (err) {
    console.error('[critères] scores de l\'offre non recalculés après le changement de ses critères', jobId, message(err))
  }
}
