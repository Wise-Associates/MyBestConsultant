'use server'

import { parseModelJson } from '@/lib/ai/model-json'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { acquireSyncLock, releaseDailySlot, releaseSyncLock, takeDailySlotId, type SyncLock } from '@/lib/ao/state'
import {
  ApolloSearchError, briefQuestionsText, briefToCriteriaText, outreachDraftText, refineCriteriaText, revealApolloPeople, searchApolloPeople,
  evaluationText, pollApolloPhone, requestApolloPhone, strategiesText, titleFitsText,
} from '@/lib/mbc-search/apollo'
import {
  MBC_PHONE_DAILY_LIMITS, MBC_PHONE_QUOTA_MESSAGE, canRequestPhone, mergeNumbers, parsePhoneResult, settledPhone, type MbcPhone,
} from '@/lib/mbc-search/phone'
import { parseTitleRelations, type TitleRelation } from '@/lib/match-scoring'
import { STRATEGY_LIMITS, parseStrategies, titleKey, titlePairs, type MbcStrategy } from '@/lib/mbc-search/strategies'
import { takeBurstSlot } from '@/lib/mbc-search/burst'
// Cause de chaque modèle essayé dans les journaux (jamais le texte envoyé à l'IA) : « claude : crédits épuisés ; gpt4o : HTTP 400 … ».
import { llmFailureDetail } from '@/lib/ao/ai-failures'
import { evaluationOf, parseEvaluationExtras, similarBrief, similarNeed, type MbcEvaluation } from '@/lib/mbc-search/evaluation'
import { evaluationPrompt } from '@/lib/mbc-search/prompts'
import { parseJudgements, parseScoringNotes } from '@/lib/match-scoring'
import { withCheckedTitles } from '@/lib/title-check'
import { loadRecruiterWeights } from '@/lib/scoring-weights-store'
import {
  MBC_REVEAL_DAILY_LIMITS, MBC_REVEAL_QUOTA_MESSAGE, MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial,
} from '@/lib/mbc-search/access'
import { featureDenial } from '@/lib/plans'
import { loadTenantAccess } from '@/lib/tenant-access'
import {
  APOLLO_PERSON_ID, CRITERIA_LIMITS, REVEAL_BATCH, cleanOutreachDraft, criteriaProblem, criteriaSchema, outreachNeedText,
  OUTREACH_CHANNELS, outreachPersonSchema, outreachPersonText, parseBriefCriteria, rankProfiles, type MbcCriteria, type MbcProfile, type MbcRevealed,
  type ScoredProfile,
} from '@/lib/mbc-search/rules'
import {
  answersSchema, briefForAi, briefWithAnswers, criteriaForAi, parseQuestionsAnswer, parseRefinement, refineMessageSchema, type MbcQuestion,
} from '@/lib/mbc-search/conversation'
import { SAVED_SEARCHES_MAX, searchIdSchema, searchNameSchema, type MbcSearchEntry } from '@/lib/mbc-search/history'
import {
  MbcDiscussionUnavailableError, deleteMbcSearch, getMbcDiscussion, isMbcHistoryConfigured, recordMbcSearch, setMbcSearchPinned, writeMbcDiscussion,
} from '@/lib/mbc-search/history-store'
import { DISCUSSION_LIMITS, discussionSchema, mergeDiscussionPeople, type DiscussionPerson, type MbcDiscussion } from '@/lib/mbc-search/discussion'
import { isMbcRevealStoreConfigured, saveRevealPhone, saveReveals, storedReveals, vivierTargetsOf } from '@/lib/mbc-search/reveal-store'
import { revealDocId } from '@/lib/mbc-search/reveals'
import { SAVED_PEOPLE_MAX, searchRowSchema, type MbcSavedPerson } from '@/lib/mbc-search/saved'
import {
  MbcFollowUnavailableError, countSavedPeople, deleteSavedPerson, isMbcSavedStoreConfigured, saveSavedPerson, saveSavedPhone, savedPeopleAmong, savedPerson, updateSavedFollow,
} from '@/lib/mbc-search/saved-store'
import { followSchema, type MbcFollow } from '@/lib/mbc-search/follow'
import type { UserProfile } from '@/types'

// Actions de MBC Search (/recruiter/mbc-search, ADR 0018). Chacune vérifie elle-même le recruteur : une Server Action
// est un point d'entrée public. Les pages de résultats ne sont pas enregistrées : seuls sont écrits les places de quota,
// l'historique des recherches du recruteur (critères, brief, nombre de résultats), les profils complets payés par
// l'organisation (gardés 90 jours pour ne pas les payer deux fois), les personnes que le recruteur enregistre (gardées
// jusqu'à ce qu'il les retire) et, pour une recherche qu'il enregistre, sa discussion et les personnes qu'il y a
// révélées (ADR 0041, gardées tant qu'elle reste enregistrée).

const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'

// Appels récents de chaque recruteur (burst.ts) : propres à ce processus serveur, perdus à son redémarrage.
const recentCalls = new Map<string, number[]>()
// Enregistrements de discussions de chaque recruteur (l'écran en envoie un par seconde au plus) : leur propre débit, pour
// ne pas prendre les places des recherches.
const discussionSaves = new Map<string, number[]>()
const DISCUSSION_SAVES_PER_MINUTE = 30
// Relectures du téléphone demandé (l'écran relit toutes les 5 s pendant 2 min) : débit à part, sans place de quota.
const phoneChecks = new Map<string, number[]>()
const PHONE_CHECKS_PER_MINUTE = 30

/**
 * Recruteur de la session, débit de ses appels (20 par minute, burst.ts), formule qui comprend MBC Search, abonnement
 * actif et adresse vérifiée, puis une place sur les quotas du jour (celui de la formule de l'organisation, puis celui
 * de toutes). Une demande qui échoue ensuite compte quand même (l'IA a pu être facturée, Apollo limite le débit).
 */
async function searchSlot(): Promise<{ error: string } | { user: UserProfile & { tenantId: string } }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!takeBurstSlot(recentCalls, user.userId, Date.now())) {
    console.warn('[mbc-search] trop d\'appels en une minute pour un recruteur')
    return { error: 'Trop de demandes en une minute : patientez quelques secondes, puis relancez.' }
  }
  const tenantId = user.tenantId
  try {
    const access = await loadTenantAccess(tenantId)
    const denial = featureDenial(access.entitlements, 'mbcSearch')
      ?? mbcSearchDenial({ tenantId, subscriptionStatus: access.subscriptionStatus, emailVerified: user.emailVerification })
    if (denial) return { error: denial }
    const now = new Date()
    const limit = access.entitlements.dailyQuotas.mbcSearch
    const own = await takeDailySlotId('mbcSearchOrg', tenantId, now, limit)
    if (!own) return { error: MBC_SEARCH_QUOTA_MESSAGE.organisation(limit) }
    if (!(await takeDailySlotId('mbcSearchAll', 'platform', now, MBC_SEARCH_DAILY_LIMITS.allOrganisations))) {
      console.warn('[mbc-search] plafond quotidien atteint pour toutes les organisations')
      // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
      await releaseDailySlot(own)
      return { error: MBC_SEARCH_QUOTA_MESSAGE.platform }
    }
    return { user: { ...user, tenantId } }
  } catch (err) {
    console.error('[mbc-search] abonnement ou quota illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Recherche impossible pour le moment : réessayez dans quelques instants.' }
  }
}

const briefSchema = z.string().trim().min(20, 'Décrivez le profil en quelques phrases (20 caractères au moins).').max(CRITERIA_LIMITS.brief, `Brief limité à ${CRITERIA_LIMITS.brief} caractères.`)

/**
 * Questions de l'IA avant la recherche (conversation, demande du 2026-11-13) : au plus 3, à choix, sur ce que le brief
 * laisse ouvert ; aucune si le brief suffit. Même quota que les recherches : un appel à l'IA.
 */
export async function askMbcQuestions(brief: unknown): Promise<{ reply?: string; questions?: MbcQuestion[]; error?: string }> {
  const parsed = briefSchema.safeParse(brief)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Brief invalide.' }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  let text: string
  try {
    text = await briefQuestionsText(parsed.data, user.tenantId)
  } catch (err) {
    console.error('[mbc-search] questions sur le brief impossibles', llmFailureDetail(err))
    return { error: 'L\'IA n\'a pas pu préparer ses questions : réessayez, ou lancez la recherche sans questions.' }
  }
  const res = parseQuestionsAnswer(text)
  if (!res) return { error: 'L\'IA n\'a pas pu préparer ses questions : réessayez, ou lancez la recherche sans questions.' }
  return res
}

/**
 * « Analyser le brief » : l'IA en tire les critères, complétés par les réponses du recruteur à ses questions
 * (`answers`, facultatif). Le recruteur peut ensuite les corriger.
 */
export async function analyseMbcBrief(brief: unknown, answers: unknown = []): Promise<{ criteria?: MbcCriteria; error?: string }> {
  const parsed = briefSchema.safeParse(brief)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Brief invalide.' }
  const replies = answersSchema.safeParse(answers)
  if (!replies.success) return { error: 'Réponses invalides : rechargez la page.' }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  let text: string
  try {
    text = await briefToCriteriaText(briefWithAnswers(parsed.data, replies.data), user.tenantId)
  } catch (err) {
    console.error('[mbc-search] analyse du brief impossible', llmFailureDetail(err))
    return { error: 'L\'IA n\'a pas pu lire le brief : réessayez, ou renseignez les critères vous-même.' }
  }
  const criteria = parseBriefCriteria(text)
  if (!criteria) return { error: 'L\'IA n\'a pas trouvé d\'intitulé ni de compétence dans ce brief : précisez-le, ou renseignez les critères vous-même.' }
  return { criteria }
}

const refineSchema = z.object({
  brief: z.string().max(CRITERIA_LIMITS.brief),
  criteria: criteriaSchema,
  message: refineMessageSchema,
})

/**
 * Message du recruteur sous les résultats (« ce qui ne va pas, ce qui manque ») : l'IA ajuste les critères et dit ce
 * qu'elle a changé ; la page relance ensuite la recherche. Même quota que les recherches : un appel à l'IA.
 */
export async function refineMbcSearch(input: unknown): Promise<{ reply?: string; criteria?: MbcCriteria; error?: string }> {
  const parsed = refineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.find(i => i.path[0] === 'message')?.message ?? 'Recherche invalide : rechargez la page.' }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  const { brief, criteria, message } = parsed.data
  let text: string
  try {
    text = await refineCriteriaText({ brief: briefForAi(brief), criteria: criteriaForAi(criteria), message }, user.tenantId)
  } catch (err) {
    console.error('[mbc-search] ajustement des critères impossible', llmFailureDetail(err))
    return { error: 'L\'IA n\'a pas pu ajuster la recherche : réessayez, ou modifiez les critères vous-même.' }
  }
  const res = parseRefinement(text, criteria)
  if (!res) return { error: 'L\'IA n\'a pas compris comment ajuster la recherche : reformulez, ou modifiez les critères vous-même.' }
  return res
}

const planSchema = z.object({ brief: z.string().max(CRITERIA_LIMITS.brief), criteria: criteriaSchema })

/**
 * Requêtes d'un besoin (ADR 0037) : celle des critères du recruteur, puis jusqu'à 4 autres proposées par l'IA (autres
 * intitulés du même métier). Un appel à l'IA, une place du quota. L'IA indisponible ou illisible n'empêche pas la
 * recherche : la requête du recruteur seule, et `note` le dit.
 */
export async function planMbcStrategies(input: unknown): Promise<{ strategies?: MbcStrategy[]; note?: string; error?: string }> {
  const parsed = planSchema.safeParse(input)
  if (!parsed.success) return { error: 'Critères invalides : rechargez la page.' }
  const problem = criteriaProblem(parsed.data.criteria)
  if (problem) return { error: problem }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  const only = 'Je n\'ai pas pu préparer d\'autres recherches : je cherche avec vos critères seulement.'
  try {
    const strategies = parseStrategies(await strategiesText(parsed.data, user.tenantId), parsed.data.criteria)
    return strategies.length > 1 ? { strategies } : { strategies, note: 'Vos critères suffisent : une seule recherche.' }
  } catch (err) {
    console.error('[mbc-search] requêtes supplémentaires impossibles', llmFailureDetail(err))
    return { strategies: parseStrategies('', parsed.data.criteria), note: only }
  }
}

const searchSchema = z.object({
  /** Critères du recruteur : la note de chaque profil, et la ligne de son historique. */
  criteria: criteriaSchema,
  /** Critères de la requête envoyée à Apollo (une des requêtes de planMbcStrategies, ou les critères eux-mêmes). */
  query: criteriaSchema,
  page: z.number().int().min(1).max(STRATEGY_LIMITS.maxPage),
  brief: z.string().max(CRITERIA_LIMITS.brief),
  /** Noter la recherche dans l'historique du recruteur (première page de la requête de ses critères). */
  record: z.boolean(),
})

/**
 * Comparaison par l'IA des intitulés de la page au métier demandé (title-check) : relation par intitulé (clé
 * `titleKey`). `failed` : l'IA indisponible ou illisible (réponse d'une autre longueur que la liste comprise), les mots
 * en commun départagent les intitulés.
 */
async function titleFits(criteria: MbcCriteria, profiles: MbcProfile[], tenantId: string): Promise<{ fits: Map<string, TitleRelation | null>; failed: boolean }> {
  const pairs = titlePairs(criteria, profiles)
  if (pairs.length === 0) return { fits: new Map(), failed: false }
  try {
    const relations = parseTitleRelations(await titleFitsText(pairs, tenantId), pairs.length, true)
    if (relations.every(r => r === null)) console.warn('[mbc-search] comparaison des intitulés illisible : mots en commun')
    return { fits: new Map(pairs.map((p, i) => [titleKey(p.intitule), relations[i]])), failed: relations.every(r => r === null) }
  } catch (err) {
    console.error('[mbc-search] comparaison des intitulés impossible : mots en commun', llmFailureDetail(err))
    return { fits: new Map(), failed: true }
  }
}

/**
 * « Rechercher » : une page (100 profils) d'une des requêtes du besoin, notée sur les critères du recruteur avec les
 * intitulés comparés par l'IA, et classée. Une place du quota par page. `stop` : refus qui se répéterait pour les
 * requêtes suivantes (session, formule, quota, clé ou crédits Apollo, débit) : la page arrête la recherche. Notée dans
 * l'historique si `record` (`entry`) ; un historique indisponible n'empêche pas la recherche (`historyError`).
 */
export async function searchMbcProfiles(input: unknown): Promise<{
  profiles?: ScoredProfile[]
  total?: number
  entry?: MbcSearchEntry
  historyError?: string
  /** Profils de la page déjà révélés par l'organisation : affichés sans nouveau crédit. */
  revealed?: MbcRevealed[]
  /** Personnes de la page déjà dans un vivier du recruteur : « general » ou l'offre. */
  inVivier?: Record<string, string[]>
  /** Intitulés comparés sans l'IA (indisponible) : classement par mots en commun. */
  titleCheckFailed?: boolean
  stop?: true
  error?: string
}> {
  const parsed = searchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Critères invalides : rechargez la page.' }
  const { criteria, query, page, brief, record } = parsed.data
  const problem = criteriaProblem(criteria) ?? criteriaProblem(query)
  if (problem) return { error: problem }
  const slot = await searchSlot()
  if ('error' in slot) return { ...slot, stop: true }
  const { user } = slot
  let found: { total: number; profiles: ScoredProfile[]; titleCheckFailed: boolean; revealed?: MbcRevealed[]; inVivier?: Record<string, string[]> }
  try {
    const { total, profiles } = await searchApolloPeople(query, page, STRATEGY_LIMITS.perPage)
    const { fits, failed } = await titleFits(criteria, profiles, user.tenantId)
    found = { total, titleCheckFailed: failed, profiles: rankProfiles(profiles, criteria, new Date(), p => fits.get(titleKey(p.title)) ?? null) }
  } catch (err) {
    if (err instanceof ApolloSearchError) return err.blocking ? { error: err.message, stop: true } : { error: err.message }
    console.error('[mbc-search] recherche impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Recherche impossible pour le moment : réessayez dans quelques instants.' }
  }
  // Ce que l'organisation a déjà payé et ce qui est déjà dans le vivier : facultatif, la liste s'affiche sans.
  const ids = found.profiles.map(x => x.id)
  // Lus séparément : une lecture en échec ne prive pas de l'autre.
  const [revealed, inVivier] = await Promise.allSettled([storedReveals(user.tenantId, ids, new Date()), vivierTargetsOf(user.tenantId, user.$id, ids)])
  if (revealed.status === 'fulfilled') found = { ...found, revealed: revealed.value }
  else console.error('[mbc-search] profils déjà révélés illisibles', revealed.reason instanceof Error ? revealed.reason.message : String(revealed.reason))
  if (inVivier.status === 'fulfilled') found = { ...found, inVivier: inVivier.value }
  else console.error('[mbc-search] vivier illisible', inVivier.reason instanceof Error ? inVivier.reason.message : String(inVivier.reason))
  if (!record || !isMbcHistoryConfigured()) return found
  try {
    const entry = await recordMbcSearch({ userId: user.userId, tenantId: user.tenantId, brief: brief.trim(), criteria, total: found.total, now: new Date() })
    return { ...found, entry }
  } catch (err) {
    console.error('[mbc-search] historique non mis à jour', err instanceof Error ? err.message : String(err))
    return { ...found, historyError: 'Recherche non ajoutée à votre historique (enregistrement impossible).' }
  }
}

const HISTORY_UNAVAILABLE = 'Historique des recherches indisponible pour le moment.'

/** Recruteur de la session (compte Auth : clé de son historique). */
async function historyOwner(): Promise<{ userId: string } | { error: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!isMbcHistoryConfigured()) return { error: HISTORY_UNAVAILABLE }
  return { userId: user.userId }
}

/** Enregistre une recherche de l'historique sous un nom (`pinned: true`), ou la retire des recherches enregistrées. */
export async function pinMbcSearch(input: unknown): Promise<{ entry?: MbcSearchEntry; error?: string }> {
  const parsed = z.object({ id: searchIdSchema, pinned: z.boolean(), name: searchNameSchema.optional() }).safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.find(i => i.path[0] === 'name')?.message ?? 'Recherche invalide : rechargez la page.' }
  const owner = await historyOwner()
  if ('error' in owner) return owner
  try {
    const res = await setMbcSearchPinned(owner.userId, parsed.data.id, parsed.data.pinned, parsed.data.name)
    if (res === 'full') return { error: `${SAVED_SEARCHES_MAX} recherches enregistrées au plus : retirez-en une d'abord.` }
    if (!res) return { error: 'Recherche introuvable : elle a peut-être été supprimée.' }
    return { entry: res }
  } catch (err) {
    console.error('[mbc-search] enregistrement d\'une recherche impossible', err instanceof Error ? err.message : String(err))
    return { error: HISTORY_UNAVAILABLE }
  }
}

const DISCUSSION_UNAVAILABLE = 'Discussion non enregistrée : la base de MBC Search doit être mise à jour. Contactez le support.'

/**
 * Discussion enregistrée d'une recherche de l'historique du recruteur, et les personnes révélées pendant celle-ci (profil
 * complet gardé avec elle). `discussion` null : rien d'enregistré, l'écran relance alors la recherche comme avant.
 */
export async function openMbcDiscussion(id: unknown): Promise<{ entry?: MbcSearchEntry; discussion?: MbcDiscussion | null; people?: DiscussionPerson[]; error?: string }> {
  const parsed = searchIdSchema.safeParse(id)
  if (!parsed.success) return { error: 'Recherche invalide : rechargez la page.' }
  const owner = await historyOwner()
  if ('error' in owner) return owner
  try {
    const found = await getMbcDiscussion(owner.userId, parsed.data)
    if (!found) return { error: 'Recherche introuvable : elle a peut-être été supprimée.' }
    return found
  } catch (err) {
    console.error('[mbc-search] discussion illisible', err instanceof Error ? err.message : String(err))
    return { error: HISTORY_UNAVAILABLE }
  }
}

const SaveDiscussionInput = z.object({
  id: searchIdSchema,
  discussion: discussionSchema,
  // Lignes de recherche des personnes révélées dans la discussion : le profil complet, lui, est relu en base.
  people: z.array(searchRowSchema).max(100),
})

/**
 * Garde la discussion d'une recherche **enregistrée** (épinglée) et les personnes révélées pendant celle-ci (demande du
 * 2026-11-17). Le profil complet d'une nouvelle personne est relu en base (révélé par l'organisation ou enregistré par le
 * recruteur), jamais pris du navigateur : une personne non révélée est ignorée. Ni crédit ni quota.
 */
export async function saveMbcDiscussion(input: unknown): Promise<{ people?: number; error?: string }> {
  const parsed = SaveDiscussionInput.safeParse(input)
  if (!parsed.success) return { error: 'Discussion invalide : rechargez la page.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!isMbcHistoryConfigured()) return { error: HISTORY_UNAVAILABLE }
  if (!takeBurstSlot(discussionSaves, user.userId, Date.now(), DISCUSSION_SAVES_PER_MINUTE)) {
    return { error: 'Discussion enregistrée trop souvent en une minute : elle le sera au prochain message.' }
  }
  const tenantId = user.tenantId
  const { id, discussion, people: rows } = parsed.data
  try {
    const found = await getMbcDiscussion(user.userId, id)
    if (!found) return { error: 'Recherche introuvable : elle a peut-être été supprimée.' }
    if (!found.entry.pinned) return { error: 'Enregistrez d’abord la recherche (marque-page) pour garder sa discussion.' }
    const known = new Set(found.people.map(p => p.profile.id))
    // Nouvelles personnes, sans doublon, pas plus que les places libres de la discussion.
    const fresh = [...new Map(rows.filter(r => !known.has(r.id)).map(r => [r.id, r])).values()]
      .slice(0, Math.max(0, DISCUSSION_LIMITS.people - found.people.length))
    const added: DiscussionPerson[] = []
    if (fresh.length > 0) {
      // Mêmes conditions que la révélation (formule, abonnement, adresse vérifiée) : sans elles, les messages sont gardés,
      // aucun profil n'est copié dans la discussion.
      const access = await loadTenantAccess(tenantId)
      const denial = featureDenial(access.entitlements, 'mbcSearch')
        ?? mbcSearchDenial({ tenantId, subscriptionStatus: access.subscriptionStatus, emailVerified: user.emailVerification })
      if (!denial) {
        const ids = fresh.map(r => r.id)
        const stored = isMbcRevealStoreConfigured() ? await storedReveals(tenantId, ids, new Date()) : []
        const byId = new Map(stored.map(p => [p.id, p]))
        const missing = ids.filter(x => !byId.has(x))
        if (missing.length > 0 && isMbcSavedStoreConfigured()) {
          for (const s of await savedPeopleAmong(user.userId, missing)) byId.set(s.profile.id, s.profile)
        }
        for (const search of fresh) {
          const profile = byId.get(search.id)
          if (profile) added.push({ search, profile })
        }
      }
    }
    const people = mergeDiscussionPeople(found.people, added)
    await writeMbcDiscussion(id, discussion, people)
    return { people: people.length }
  } catch (err) {
    if (err instanceof MbcDiscussionUnavailableError) {
      console.error('[mbc-search] attributs de la discussion absents', err.message)
      return { error: DISCUSSION_UNAVAILABLE }
    }
    console.error('[mbc-search] discussion non enregistrée', err instanceof Error ? err.message : String(err))
    return { error: 'Discussion non enregistrée pour le moment : elle le sera au prochain message.' }
  }
}

/** Supprime une recherche de l'historique du recruteur. */
export async function deleteMbcSearchEntry(id: unknown): Promise<{ ok?: true; error?: string }> {
  const parsed = searchIdSchema.safeParse(id)
  if (!parsed.success) return { error: 'Recherche invalide : rechargez la page.' }
  const owner = await historyOwner()
  if ('error' in owner) return owner
  try {
    // Introuvable (déjà supprimée, ou d'un autre) : rien à faire, la ligne disparaît de l'écran.
    await deleteMbcSearch(owner.userId, parsed.data)
    return { ok: true }
  } catch (err) {
    console.error('[mbc-search] suppression d\'une recherche impossible', err instanceof Error ? err.message : String(err))
    return { error: HISTORY_UNAVAILABLE }
  }
}

const revealSchema = z.array(z.string().regex(APOLLO_PERSON_ID)).min(1).max(REVEAL_BATCH)

/**
 * « Voir le profil complet » : nom entier, LinkedIn, e-mail professionnel, lieu et parcours, par l'enrichissement
 * d'Apollo (un crédit par personne trouvée). Mêmes conditions que la recherche. Un profil déjà révélé par
 * l'organisation (encore conservé) est relu en base, sans crédit ni quota ; pour les autres, une place par profil
 * demandé sur les quotas du jour des profils révélés (organisation, puis toutes), un profil non trouvé comptant quand
 * même. `charged` : places prises.
 */
export async function revealMbcProfiles(ids: unknown): Promise<RevealOutcome> {
  const parsed = revealSchema.safeParse(ids)
  if (!parsed.success) return { error: 'Profils invalides : rechargez la page.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  return revealForRecruiter({ userId: user.userId, tenantId: user.tenantId, emailVerified: user.emailVerification }, [...new Set(parsed.data)])
}

type RevealOutcome = { profiles?: MbcRevealed[]; charged?: number; notKept?: string; error?: string }

/** Révélation pour le recruteur de la session (déjà vérifié par l'action) : voir `revealMbcProfiles`. */
async function revealForRecruiter(user: { userId: string; tenantId: string; emailVerified: boolean }, unique: string[]): Promise<RevealOutcome> {
  const tenantId = user.tenantId
  const taken: string[] = []
  const now = new Date()
  let known: MbcRevealed[] = []
  let wanted = unique
  try {
    const access = await loadTenantAccess(tenantId)
    const denial = featureDenial(access.entitlements, 'mbcSearch')
      ?? mbcSearchDenial({ tenantId, subscriptionStatus: access.subscriptionStatus, emailVerified: user.emailVerified })
    if (denial) return { error: denial }
    const limit = access.entitlements.dailyQuotas.mbcReveal
    try {
      known = await storedReveals(tenantId, unique, now)
      wanted = unique.filter(id => !known.some(k => k.id === id))
    } catch (err) {
      // Illisible : on révèle comme avant (crédit dépensé), plutôt que de bloquer le recruteur.
      console.error('[mbc-search] profils déjà révélés illisibles', err instanceof Error ? err.message : String(err))
    }
    if (wanted.length === 0) return { profiles: known, charged: 0 }
    for (let i = 0; i < wanted.length; i++) {
      const own = await takeDailySlotId('mbcRevealOrg', tenantId, now, limit)
      if (!own) {
        await Promise.all(taken.map(releaseDailySlot))
        return { error: MBC_REVEAL_QUOTA_MESSAGE.organisation(limit) }
      }
      taken.push(own)
      const all = await takeDailySlotId('mbcRevealAll', 'platform', now, MBC_REVEAL_DAILY_LIMITS.allOrganisations)
      if (!all) {
        console.warn('[mbc-search] plafond quotidien des profils révélés atteint pour toutes les organisations')
        // Places non utilisées : rendues, pour ne pas compter un refus de la plateforme contre l'organisation.
        await Promise.all(taken.map(releaseDailySlot))
        return { error: MBC_REVEAL_QUOTA_MESSAGE.platform }
      }
      taken.push(all)
    }
  } catch (err) {
    console.error('[mbc-search] abonnement ou quota des profils révélés illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Profils indisponibles pour le moment : réessayez dans quelques instants.' }
  }
  let fresh: MbcRevealed[]
  try {
    fresh = await revealApolloPeople(wanted)
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
    console.error('[mbc-search] enrichissement impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Profils indisponibles pour le moment : réessayez dans quelques instants.' }
  }
  // Profils affichés quand même (déjà payés) ; non gardés, ils seraient à révéler (et payer) de nouveau : le dire.
  const notKept = 'Profils révélés non gardés : ils ne resteront pas révélés à la prochaine recherche. Prévenez l\'administrateur.'
  if (!isMbcRevealStoreConfigured()) {
    console.error('[mbc-search] profils révélés non gardés : APPWRITE_COLLECTION_MBC_REVEALS non définie')
    return { profiles: [...known, ...fresh], charged: wanted.length, notKept }
  }
  try {
    await saveReveals(tenantId, user.userId, fresh, now)
  } catch (err) {
    console.error('[mbc-search] profils révélés non gardés', err instanceof Error ? err.message : String(err))
    return { profiles: [...known, ...fresh], charged: wanted.length, notKept }
  }
  return { profiles: [...known, ...fresh], charged: wanted.length }
}

/**
 * Profil révélé par l'organisation (gardé 90 jours) ou enregistré par le recruteur, relu en base : l'évaluation et les
 * profils similaires partent de ce que le serveur a payé et gardé, jamais d'un profil envoyé par le navigateur. null :
 * pas révélé (ou plus gardé) pour cette organisation.
 */
async function revealedFor(user: { userId: string; tenantId: string }, id: string): Promise<MbcRevealed | null> {
  const [stored] = await storedReveals(user.tenantId, [id], new Date())
  if (stored) return stored
  return isMbcSavedStoreConfigured() ? (await savedPerson(user.userId, id))?.profile ?? null : null
}

const NOT_REVEALED = 'Révélez d’abord le profil complet de cette personne.'

/**
 * Garde le téléphone avec le profil révélé de l'organisation et, si le recruteur l'a enregistrée, avec la personne
 * enregistrée (ADR 0042 : même conservation que le profil). `savedUpdatedAt` : nouvelle version de la personne enregistrée.
 */
async function keepPhone(user: { userId: string; tenantId: string }, id: string, phone: MbcPhone): Promise<{ kept: boolean; savedUpdatedAt?: string }> {
  const revealKept = await saveRevealPhone(user.tenantId, id, phone, new Date())
  const savedUpdatedAt = isMbcSavedStoreConfigured() ? await saveSavedPhone(user.userId, id, phone) : null
  return { kept: revealKept || savedUpdatedAt !== null, savedUpdatedAt: savedUpdatedAt ?? undefined }
}

type PhoneOutcome = { phone?: MbcPhone; savedUpdatedAt?: string; error?: string }
/** Verrou de la demande de téléphone d'une personne pour une organisation (document de ao_sync_state, 35 caractères). */
const phoneLockId = (tenantId: string, apolloId: string) => `ph_${revealDocId(tenantId, apolloId).slice(1, 33)}`
const phoneForScreen = (phone: MbcPhone): MbcPhone => ({ status: phone.status, numbers: phone.numbers, requestedAt: phone.requestedAt })

/**
 * « Demander le téléphone » d'une personne révélée (ADR 0042, à la demande seulement) : mêmes conditions que la
 * révélation, une place des quotas du jour (20 par organisation, 200 pour toutes), jusqu'à 8 crédits Apollo si un numéro
 * est trouvé. Déjà demandé (trouvé, aucun, ou en attente) : renvoyé sans nouvelle demande.
 */
export async function requestMbcPhone(apolloId: unknown): Promise<PhoneOutcome> {
  const parsed = z.string().regex(APOLLO_PERSON_ID).safeParse(apolloId)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const id = parsed.data
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!takeBurstSlot(recentCalls, user.userId, Date.now())) return { error: 'Trop de demandes en une minute : patientez quelques secondes, puis relancez.' }
  const owner = { userId: user.userId, tenantId: user.tenantId }
  const now = new Date()
  // Une demande à la fois par organisation et par personne (deux onglets, deux collègues) : la seconde attendrait sinon
  // une demande payée en double, dont le résultat serait perdu.
  let lock: SyncLock | null
  try {
    lock = await acquireSyncLock(phoneLockId(owner.tenantId, id), owner.userId, now)
  } catch (err) {
    console.error('[mbc-search] verrou du téléphone illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Téléphone indisponible pour le moment : réessayez dans quelques instants.' }
  }
  if (!lock) return { error: 'Le téléphone de cette personne est déjà demandé : patientez quelques secondes.' }
  try {
    try {
      const access = await loadTenantAccess(owner.tenantId)
      // Téléphone réservé aux formules payées et en cours (demande du 2026-11-17, plans.ts).
      const denial = featureDenial(access.entitlements, 'mbcSearch') ?? featureDenial(access.entitlements, 'mbcPhone')
        ?? mbcSearchDenial({ tenantId: owner.tenantId, subscriptionStatus: access.subscriptionStatus, emailVerified: user.emailVerification })
      if (denial) return { error: denial }
      // Relu sous le verrou : une demande faite entre-temps est renvoyée, pas refaite.
      const profile = await revealedFor(owner, id)
      if (!profile) return { error: NOT_REVEALED }
      if (profile.phone && !canRequestPhone(profile.phone)) return { phone: phoneForScreen(profile.phone) }
      const limit = access.entitlements.dailyQuotas.mbcPhone
      const own = await takeDailySlotId('mbcPhoneOrg', owner.tenantId, now, limit)
      if (!own) return { error: MBC_PHONE_QUOTA_MESSAGE.organisation(limit) }
      if (!(await takeDailySlotId('mbcPhoneAll', 'platform', now, MBC_PHONE_DAILY_LIMITS.allOrganisations))) {
        console.warn('[mbc-search] plafond quotidien des téléphones atteint pour toutes les organisations')
        await releaseDailySlot(own)
        return { error: MBC_PHONE_QUOTA_MESSAGE.platform }
      }
    } catch (err) {
      console.error('[mbc-search] abonnement, profil ou quota des téléphones illisible', err instanceof Error ? err.message : String(err))
      return { error: 'Téléphone indisponible pour le moment : réessayez dans quelques instants.' }
    }
    let asked: { numbers: MbcPhone['numbers']; requestId: string | null }
    try {
      asked = await requestApolloPhone(id)
    } catch (err) {
      if (err instanceof ApolloSearchError) return { error: err.message }
      console.error('[mbc-search] demande de téléphone impossible', err instanceof Error ? err.name : 'inconnu')
      return { error: 'Téléphone indisponible pour le moment : réessayez dans quelques instants.' }
    }
    const phone: MbcPhone = asked.requestId
      ? { status: 'pending', numbers: asked.numbers, requestId: asked.requestId, requestedAt: now.toISOString() }
      : settledPhone(asked.numbers, now.toISOString())
    try {
      const { kept, savedUpdatedAt } = await keepPhone(owner, id, phone)
      if (!kept) return { phone: phoneForScreen(phone), error: 'Numéro demandé mais pas gardé : le profil n’est plus conservé par votre organisation.' }
      return { phone: phoneForScreen(phone), savedUpdatedAt }
    } catch (err) {
      console.error('[mbc-search] téléphone non gardé', err instanceof Error ? err.message : String(err))
      return { phone: phoneForScreen(phone), error: 'Numéro demandé mais pas enregistré : il ne sera peut-être plus affiché au prochain chargement.' }
    }
  } finally {
    await releaseSyncLock(lock)
  }
}

/** Relit une demande de téléphone en attente (sans crédit ni quota) et garde le résultat. */
export async function checkMbcPhone(apolloId: unknown): Promise<PhoneOutcome> {
  const parsed = z.string().regex(APOLLO_PERSON_ID).safeParse(apolloId)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const id = parsed.data
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!takeBurstSlot(phoneChecks, user.userId, Date.now(), PHONE_CHECKS_PER_MINUTE)) return { error: 'Trop de vérifications en une minute : patientez, puis vérifiez de nouveau.' }
  const owner = { userId: user.userId, tenantId: user.tenantId }
  try {
    // Numéro de la demande relu dans le profil gardé par l'organisation, jamais reçu du navigateur.
    const profile = await revealedFor(owner, id)
    const phone = profile?.phone
    if (!phone) return { error: NOT_REVEALED }
    if (phone.status !== 'pending' || !phone.requestId) return { phone: phoneForScreen(phone) }
    const result = await pollApolloPhone(phone.requestId)
    if (result.state === 'pending') return { phone: phoneForScreen(phone) }
    // Écrit sous le verrou de la demande, et seulement si la demande relue est encore celle-ci : un résultat tardif
    // n'écrase jamais une demande plus récente.
    const lock = await acquireSyncLock(phoneLockId(owner.tenantId, id), owner.userId, new Date())
    if (!lock) return { phone: phoneForScreen(phone) }
    try {
      const current = (await revealedFor(owner, id))?.phone
      if (current?.requestId !== phone.requestId) return current ? { phone: phoneForScreen(current) } : { error: NOT_REVEALED }
      const next: MbcPhone = result.state === 'gone'
        ? { status: 'failed', numbers: phone.numbers, requestedAt: phone.requestedAt }
        : settledPhone(mergeNumbers(phone.numbers, parsePhoneResult(result.json, id)), phone.requestedAt)
      const { savedUpdatedAt } = await keepPhone(owner, id, next)
      return { phone: phoneForScreen(next), savedUpdatedAt }
    } finally {
      await releaseSyncLock(lock)
    }
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
    console.error('[mbc-search] relecture du téléphone impossible', err instanceof Error ? err.message : String(err))
    return { error: 'Téléphone indisponible pour le moment : réessayez dans quelques instants.' }
  }
}

const evaluateSchema = z.object({
  id: z.string().regex(APOLLO_PERSON_ID),
  brief: z.string().max(CRITERIA_LIMITS.brief),
  criteria: criteriaSchema,
})

/**
 * « Évaluer » un profil révélé pour le besoin (ADR 0037, phase 2) : l'IA juge le profil Apollo sur le barème du matching,
 * comme un CV (preuves vérifiées, intitulés comparés), le code calcule le score avec les poids du recruteur, sans les
 * critères qu'Apollo ne donne pas (evaluation.ts). Un appel à l'IA, une place du quota. Rien n'est enregistré.
 */
export async function evaluateMbcProfile(input: unknown): Promise<{ evaluation?: MbcEvaluation; error?: string }> {
  const parsed = evaluateSchema.safeParse(input)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const { id, brief, criteria } = parsed.data
  const problem = criteriaProblem(criteria)
  if (problem) return { error: problem }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  let profile: MbcRevealed | null
  try {
    profile = await revealedFor({ userId: user.userId, tenantId: user.tenantId }, id)
  } catch (err) {
    console.error('[mbc-search] profil révélé illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Profil indisponible pour le moment : réessayez dans quelques instants.' }
  }
  if (!profile) return { error: NOT_REVEALED }
  const failed = 'L\'IA n\'a pas pu évaluer ce profil : réessayez dans quelques instants.'
  try {
    const { weights } = await loadRecruiterWeights(user.userId)
    // Consignes et message de prompts.ts (ceux des exemples d'affinage) ; judged et cvText servent à lire la réponse.
    const prompt = evaluationPrompt({ brief, criteria, profile })
    const { judged, cvText } = prompt
    const content = await evaluationText(prompt, user.tenantId)
    // Lu comme une notation de CV (cvScorer, sourcing-core.ts) : jugements vérifiés dans le texte lu, intitulés comparés.
    const json = content.match(/\{[\s\S]*\}/)
    let answer: unknown = null
    try { answer = json ? parseModelJson(json[0]) : null } catch { answer = null }
    const judgements = parseJudgements(answer, judged, cvText, 'matching')
    if (!judgements) return { error: failed }
    const [checked] = await withCheckedTitles([judgements], { feature: 'title-check', tenantId: user.tenantId })
    return { evaluation: evaluationOf(checked, judged, weights.matching, parseScoringNotes(answer), parseEvaluationExtras(answer), { titleAsked: criteria.titles.length > 0 }) }
  } catch (err) {
    console.error('[mbc-search] évaluation impossible', llmFailureDetail(err))
    return { error: failed }
  }
}

/**
 * « Profils similaires » à un profil révélé (ADR 0038) : l'IA tire des critères de son poste, de son titre, de son
 * parcours et du secteur de son employeur (sans son nom), comme d'un besoin ; la page lance ensuite la recherche.
 * Un appel à l'IA, une place du quota. `brief` : besoin tiré des critères seuls (similarNeed), gardé dans l'historique.
 */
export async function similarMbcCriteria(id: unknown): Promise<{ criteria?: MbcCriteria; brief?: string; error?: string }> {
  const parsed = z.string().regex(APOLLO_PERSON_ID).safeParse(id)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  let profile: MbcRevealed | null
  try {
    profile = await revealedFor({ userId: user.userId, tenantId: user.tenantId }, parsed.data)
  } catch (err) {
    console.error('[mbc-search] profil révélé illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Profil indisponible pour le moment : réessayez dans quelques instants.' }
  }
  if (!profile) return { error: NOT_REVEALED }
  try {
    const criteria = parseBriefCriteria(await briefToCriteriaText(similarBrief(profile), user.tenantId))
    if (!criteria) return { error: 'L\'IA n\'a pas tiré de critères de ce profil : renseignez-les vous-même.' }
    // Le parcours de la personne ne quitte pas le serveur : le besoin gardé est tiré des critères seuls (similarNeed).
    return { criteria, brief: similarNeed(criteria) }
  } catch (err) {
    console.error('[mbc-search] critères de profils similaires impossibles', llmFailureDetail(err))
    return { error: 'L\'IA n\'a pas pu lire ce profil : réessayez dans quelques instants.' }
  }
}

const SAVED_UNAVAILABLE = 'Personnes enregistrées indisponibles pour le moment : réessayez dans quelques instants.'
const savedFullMessage = `${SAVED_PEOPLE_MAX} personnes enregistrées au plus : retirez-en une d'abord.`

/**
 * « Enregistrer » une personne : la révèle si besoin (mêmes conditions, crédit et quota que « Révéler » ; aucun crédit
 * si l'organisation l'a déjà révélée), puis la garde, révélée, dans la liste du recruteur jusqu'à ce qu'il la retire.
 * Déjà enregistrée : renvoyée telle quelle, sans crédit. `row` : la ligne de recherche affichée (`searchRowSchema`).
 * Révélée mais pas enregistrée (écriture en échec) : `revealed` et `error`. Introuvable chez Apollo : `missing`.
 */
export async function saveMbcPerson(row: unknown): Promise<{
  saved?: MbcSavedPerson; revealed?: MbcRevealed; missing?: true; charged?: number; error?: string
}> {
  const parsed = searchRowSchema.safeParse(row)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!isMbcSavedStoreConfigured()) return { error: 'L\'enregistrement des personnes n\'est pas encore activé sur la plateforme. Contactez le support.' }
  const id = parsed.data.id
  try {
    const already = await savedPerson(user.userId, id)
    if (already) return { saved: already, charged: 0 }
    // Vérifié avant de payer : une personne qui ne pourrait pas être gardée ne coûte pas de crédit.
    if ((await countSavedPeople(user.userId)) >= SAVED_PEOPLE_MAX) return { error: savedFullMessage }
  } catch (err) {
    console.error('[mbc-search] personnes enregistrées illisibles', err instanceof Error ? err.message : String(err))
    return { error: SAVED_UNAVAILABLE }
  }
  const res = await revealForRecruiter({ userId: user.userId, tenantId: user.tenantId, emailVerified: user.emailVerification }, [id])
  if (res.error) return { error: res.error }
  const profile = res.profiles?.find(p => p.id === id)
  if (!profile) return { missing: true, charged: res.charged, error: 'Apollo ne trouve pas le profil complet de cette personne : elle n\'est pas enregistrée.' }
  try {
    const saved = await saveSavedPerson({ userId: user.userId, tenantId: user.tenantId, search: parsed.data, profile, now: new Date() })
    if (saved === 'full') return { revealed: profile, charged: res.charged, error: savedFullMessage }
    return { saved, charged: res.charged }
  } catch (err) {
    console.error('[mbc-search] personne non enregistrée', err instanceof Error ? err.message : String(err))
    // Le profil est payé : il s'affiche quand même ; un nouvel essai le relit parmi les profils révélés, sans crédit.
    return { revealed: profile, charged: res.charged, error: 'Profil révélé, mais pas enregistré : réessayez « Enregistrer ».' }
  }
}

/** Retire une personne de la liste du recruteur (son profil révélé reste gardé pour l'organisation, 90 jours). */
export async function unsaveMbcPerson(apolloId: unknown): Promise<{ ok?: true; error?: string }> {
  const parsed = z.string().regex(APOLLO_PERSON_ID).safeParse(apolloId)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!isMbcSavedStoreConfigured()) return { error: SAVED_UNAVAILABLE }
  try {
    // Absente (déjà retirée, ou d'un autre recruteur) : rien à faire, la ligne disparaît de l'écran.
    await deleteSavedPerson(user.userId, parsed.data)
    return { ok: true }
  } catch (err) {
    console.error('[mbc-search] personne non retirée', err instanceof Error ? err.message : String(err))
    return { error: SAVED_UNAVAILABLE }
  }
}

const followInputSchema = z.object({ id: z.string().regex(APOLLO_PERSON_ID), follow: followSchema, updatedAt: z.string().max(40) })

/**
 * Suivi d'une personne enregistrée (ADR 0039) : statut, note et étiquettes du recruteur, gardés avec elle. Seulement une
 * personne de sa liste (compte Auth de la session) ; ni crédit ni quota. `updatedAt` : la version que l'écran a lue (un
 * suivi enregistré depuis, dans un autre onglet, n'est pas écrasé). Rendus : le suivi tel qu'enregistré et sa version.
 */
export async function updateMbcFollow(input: unknown): Promise<{ follow?: MbcFollow; updatedAt?: string; error?: string }> {
  const parsed = followInputSchema.safeParse(input)
  if (!parsed.success) return { error: 'Suivi invalide : 2 000 caractères de note et 10 étiquettes de 40 caractères au plus.' }
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  if (!isMbcSavedStoreConfigured()) return { error: SAVED_UNAVAILABLE }
  try {
    const res = await updateSavedFollow(user.userId, parsed.data.id, parsed.data.follow, parsed.data.updatedAt)
    if (res === 'missing') return { error: 'Personne introuvable dans votre sélection : elle a peut-être été retirée.' }
    if (res === 'stale') return { error: 'Suivi modifié ailleurs (un autre onglet ?) : rechargez la page avant de l’enregistrer.' }
    return { follow: parsed.data.follow, updatedAt: res.updatedAt }
  } catch (err) {
    if (err instanceof MbcFollowUnavailableError) {
      console.error('[mbc-search] suivi impossible : attributs followStatus / followNote / followTags absents (schema:push)', err.message)
      return { error: 'Le suivi des personnes n\'est pas encore activé sur la plateforme. Contactez le support.' }
    }
    console.error('[mbc-search] suivi non enregistré', err instanceof Error ? err.message : String(err))
    return { error: SAVED_UNAVAILABLE }
  }
}

const outreachSchema = z.object({
  brief: z.string().max(CRITERIA_LIMITS.brief),
  criteria: criteriaSchema,
  person: outreachPersonSchema,
  channel: z.enum(OUTREACH_CHANNELS).default('email'),
})

/**
 * « Rédiger une approche » : brouillon du premier message à la personne, que le recruteur relit, modifie et envoie
 * lui-même (rien n'est envoyé ni enregistré). Même quota que les recherches : un appel à l'IA.
 */
export async function draftMbcOutreach(input: unknown): Promise<{ message?: string; error?: string }> {
  const parsed = outreachSchema.safeParse(input)
  if (!parsed.success) return { error: 'Profil invalide : rechargez la page.' }
  const need = outreachNeedText(parsed.data.brief, parsed.data.criteria)
  if (!need) return { error: 'Décrivez d\'abord le besoin (brief ou critères).' }
  const slot = await searchSlot()
  if ('error' in slot) return slot
  const { user } = slot
  try {
    const recruiter = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Le recruteur'
    const message = cleanOutreachDraft(await outreachDraftText({ need, recruiter, person: outreachPersonText(parsed.data.person), channel: parsed.data.channel }, user.tenantId))
    if (!message) return { error: 'L\'IA n\'a pas rédigé de message : réessayez.' }
    return { message }
  } catch (err) {
    console.error('[mbc-search] rédaction de l\'approche impossible', llmFailureDetail(err))
    return { error: 'L\'IA n\'a pas pu rédiger le message : réessayez dans quelques instants.' }
  }
}
