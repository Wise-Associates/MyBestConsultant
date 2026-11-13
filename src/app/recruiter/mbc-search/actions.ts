'use server'

import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { tenantSubscriptionStatus } from '@/lib/ao/offer-actions'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import {
  ApolloSearchError, briefQuestionsText, briefToCriteriaText, outreachDraftText, refineCriteriaText, revealApolloPeople, searchApolloPeople,
} from '@/lib/mbc-search/apollo'
import {
  MBC_REVEAL_DAILY_LIMITS, MBC_REVEAL_QUOTA_MESSAGE, MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial,
} from '@/lib/mbc-search/access'
import {
  APOLLO_PERSON_ID, CRITERIA_LIMITS, MAX_PAGE, REVEAL_BATCH, cleanOutreachDraft, criteriaProblem, criteriaSchema, outreachNeedText,
  outreachPersonSchema, outreachPersonText, parseBriefCriteria, rankProfiles, type MbcCriteria, type MbcRevealed, type ScoredProfile,
} from '@/lib/mbc-search/rules'
import {
  answersSchema, briefForAi, briefWithAnswers, criteriaForAi, parseQuestionsAnswer, parseRefinement, refineMessageSchema, type MbcQuestion,
} from '@/lib/mbc-search/conversation'
import { SAVED_SEARCHES_MAX, searchIdSchema, searchNameSchema, type MbcSearchEntry } from '@/lib/mbc-search/history'
import { deleteMbcSearch, isMbcHistoryConfigured, recordMbcSearch, setMbcSearchPinned } from '@/lib/mbc-search/history-store'
import { isMbcRevealStoreConfigured, saveReveals, storedReveals, vivierTargetsOf } from '@/lib/mbc-search/reveal-store'
import { SAVED_PEOPLE_MAX, searchRowSchema, type MbcSavedPerson } from '@/lib/mbc-search/saved'
import { countSavedPeople, deleteSavedPerson, isMbcSavedStoreConfigured, saveSavedPerson, savedPerson } from '@/lib/mbc-search/saved-store'

// Actions de MBC Search (/recruiter/mbc-search, ADR 0018). Chacune vérifie elle-même le recruteur : une Server Action
// est un point d'entrée public. Les pages de résultats ne sont pas enregistrées : seuls sont écrits les places de quota,
// l'historique des recherches du recruteur (critères, brief, nombre de résultats), les profils complets payés par
// l'organisation (gardés 90 jours pour ne pas les payer deux fois) et les personnes que le recruteur enregistre (gardées
// jusqu'à ce qu'il les retire).

const SESSION_EXPIRED = 'Session expirée : rechargez la page et reconnectez-vous.'

/**
 * Recruteur de la session, abonnement actif et adresse vérifiée, puis une place sur les quotas du jour (organisation,
 * puis toutes). Une demande qui échoue ensuite compte quand même (l'IA a pu être facturée, Apollo limite le débit).
 */
async function searchSlot(): Promise<{ error: string } | null> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  const tenantId = user.tenantId
  try {
    const denial = mbcSearchDenial({ tenantId, subscriptionStatus: await tenantSubscriptionStatus(tenantId), emailVerified: user.emailVerification })
    if (denial) return { error: denial }
    const now = new Date()
    const own = await takeDailySlotId('mbcSearchOrg', tenantId, now, MBC_SEARCH_DAILY_LIMITS.perOrganisation)
    if (!own) return { error: MBC_SEARCH_QUOTA_MESSAGE.organisation }
    if (!(await takeDailySlotId('mbcSearchAll', 'platform', now, MBC_SEARCH_DAILY_LIMITS.allOrganisations))) {
      console.warn('[mbc-search] plafond quotidien atteint pour toutes les organisations')
      // La place de l'organisation n'a pas servi : rendue, pour ne pas compter un refus de la plateforme contre elle.
      await releaseDailySlot(own)
      return { error: MBC_SEARCH_QUOTA_MESSAGE.platform }
    }
    return null
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
  const refused = await searchSlot()
  if (refused) return refused
  let text: string
  try {
    text = await briefQuestionsText(parsed.data)
  } catch (err) {
    console.error('[mbc-search] questions sur le brief impossibles', err instanceof Error ? err.name : 'inconnu')
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
  const refused = await searchSlot()
  if (refused) return refused
  let text: string
  try {
    text = await briefToCriteriaText(briefWithAnswers(parsed.data, replies.data))
  } catch (err) {
    console.error('[mbc-search] analyse du brief impossible', err instanceof Error ? err.name : 'inconnu')
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
  const refused = await searchSlot()
  if (refused) return refused
  const { brief, criteria, message } = parsed.data
  let text: string
  try {
    text = await refineCriteriaText({ brief: briefForAi(brief), criteria: criteriaForAi(criteria), message })
  } catch (err) {
    console.error('[mbc-search] ajustement des critères impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'L\'IA n\'a pas pu ajuster la recherche : réessayez, ou modifiez les critères vous-même.' }
  }
  const res = parseRefinement(text, criteria)
  if (!res) return { error: 'L\'IA n\'a pas compris comment ajuster la recherche : reformulez, ou modifiez les critères vous-même.' }
  return res
}

const pageSchema = z.number().int().min(1).max(MAX_PAGE)

const historyBriefSchema = z.string().max(CRITERIA_LIMITS.brief)

/**
 * « Rechercher » : profils d'Apollo pour ces critères, classés avec les raisons du score. La première page est notée
 * dans l'historique du recruteur (`entry`) ; un historique indisponible n'empêche pas la recherche (`historyError`).
 */
export async function searchMbcProfiles(criteria: unknown, page: unknown = 1, brief: unknown = ''): Promise<{
  profiles?: ScoredProfile[]
  total?: number
  entry?: MbcSearchEntry
  historyError?: string
  /** Profils de la page déjà révélés par l'organisation : affichés sans nouveau crédit. */
  revealed?: MbcRevealed[]
  /** Personnes de la page déjà dans un vivier du recruteur : « general » ou l'offre. */
  inVivier?: Record<string, string[]>
  error?: string
}> {
  const c = criteriaSchema.safeParse(criteria)
  const p = pageSchema.safeParse(page)
  const b = historyBriefSchema.safeParse(brief)
  if (!c.success || !p.success || !b.success) return { error: 'Critères invalides : rechargez la page.' }
  const problem = criteriaProblem(c.data)
  if (problem) return { error: problem }
  const user = await getCurrentUser()
  const refused = await searchSlot()
  if (refused || !user?.tenantId) return refused ?? { error: SESSION_EXPIRED }
  let found: { total: number; profiles: ScoredProfile[]; revealed?: MbcRevealed[]; inVivier?: Record<string, string[]> }
  try {
    const { total, profiles } = await searchApolloPeople(c.data, p.data)
    found = { total, profiles: rankProfiles(profiles, c.data, new Date()) }
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
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
  if (p.data !== 1 || !isMbcHistoryConfigured()) return found
  try {
    const entry = await recordMbcSearch({ userId: user.userId, tenantId: user.tenantId, brief: b.data.trim(), criteria: c.data, total: found.total, now: new Date() })
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
    const denial = mbcSearchDenial({ tenantId, subscriptionStatus: await tenantSubscriptionStatus(tenantId), emailVerified: user.emailVerified })
    if (denial) return { error: denial }
    try {
      known = await storedReveals(tenantId, unique, now)
      wanted = unique.filter(id => !known.some(k => k.id === id))
    } catch (err) {
      // Illisible : on révèle comme avant (crédit dépensé), plutôt que de bloquer le recruteur.
      console.error('[mbc-search] profils déjà révélés illisibles', err instanceof Error ? err.message : String(err))
    }
    if (wanted.length === 0) return { profiles: known, charged: 0 }
    for (let i = 0; i < wanted.length; i++) {
      const own = await takeDailySlotId('mbcRevealOrg', tenantId, now, MBC_REVEAL_DAILY_LIMITS.perOrganisation)
      if (!own) {
        await Promise.all(taken.map(releaseDailySlot))
        return { error: MBC_REVEAL_QUOTA_MESSAGE.organisation }
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

const outreachSchema = z.object({
  brief: z.string().max(CRITERIA_LIMITS.brief),
  criteria: criteriaSchema,
  person: outreachPersonSchema,
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
  const user = await getCurrentUser()
  const refused = await searchSlot()
  if (refused || !user) return refused ?? { error: SESSION_EXPIRED }
  try {
    const recruiter = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Le recruteur'
    const message = cleanOutreachDraft(await outreachDraftText({ need, recruiter, person: outreachPersonText(parsed.data.person) }))
    if (!message) return { error: 'L\'IA n\'a pas rédigé de message : réessayez.' }
    return { message }
  } catch (err) {
    console.error('[mbc-search] rédaction de l\'approche impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'L\'IA n\'a pas pu rédiger le message : réessayez dans quelques instants.' }
  }
}
