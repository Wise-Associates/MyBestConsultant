'use server'

import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { tenantSubscriptionStatus } from '@/lib/ao/offer-actions'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { ApolloSearchError, briefToCriteriaText, outreachDraftText, revealApolloPeople, searchApolloPeople } from '@/lib/mbc-search/apollo'
import {
  MBC_REVEAL_DAILY_LIMITS, MBC_REVEAL_QUOTA_MESSAGE, MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial,
} from '@/lib/mbc-search/access'
import {
  APOLLO_PERSON_ID, CRITERIA_LIMITS, MAX_PAGE, REVEAL_BATCH, cleanOutreachDraft, criteriaProblem, criteriaSchema, outreachNeedText,
  outreachPersonSchema, outreachPersonText, parseBriefCriteria, rankProfiles, type MbcCriteria, type MbcRevealed, type ScoredProfile,
} from '@/lib/mbc-search/rules'
import { SAVED_SEARCHES_MAX, searchIdSchema, searchNameSchema, type MbcSearchEntry } from '@/lib/mbc-search/history'
import { deleteMbcSearch, isMbcHistoryConfigured, recordMbcSearch, setMbcSearchPinned } from '@/lib/mbc-search/history-store'

// Actions de MBC Search (/recruiter/mbc-search, ADR 0018). Chacune vérifie elle-même le recruteur : une Server Action
// est un point d'entrée public. Les résultats ne sont pas enregistrés (ni profils révélés, ni coordonnées) : seuls sont
// écrits les places de quota et l'historique des recherches du recruteur (critères, brief, nombre de résultats).

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

/** « Analyser le brief » : l'IA propose des critères, que le recruteur relit et corrige avant de chercher. */
export async function analyseMbcBrief(brief: unknown): Promise<{ criteria?: MbcCriteria; error?: string }> {
  const parsed = briefSchema.safeParse(brief)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Brief invalide.' }
  const refused = await searchSlot()
  if (refused) return refused
  let text: string
  try {
    text = await briefToCriteriaText(parsed.data)
  } catch (err) {
    console.error('[mbc-search] analyse du brief impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'L\'IA n\'a pas pu lire le brief : réessayez, ou renseignez les critères vous-même.' }
  }
  const criteria = parseBriefCriteria(text)
  if (!criteria) return { error: 'L\'IA n\'a pas trouvé d\'intitulé ni de compétence dans ce brief : précisez-le, ou renseignez les critères vous-même.' }
  return { criteria }
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
  let found: { total: number; profiles: ScoredProfile[] }
  try {
    const { total, profiles } = await searchApolloPeople(c.data, p.data)
    found = { total, profiles: rankProfiles(profiles, c.data, new Date()) }
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
    console.error('[mbc-search] recherche impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Recherche impossible pour le moment : réessayez dans quelques instants.' }
  }
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
 * d'Apollo (un crédit par personne trouvée). Mêmes conditions que la recherche, et une place par profil demandé sur
 * les quotas du jour des profils révélés (organisation, puis toutes) ; un profil non trouvé compte quand même.
 */
export async function revealMbcProfiles(ids: unknown): Promise<{ profiles?: MbcRevealed[]; error?: string }> {
  const parsed = revealSchema.safeParse(ids)
  if (!parsed.success) return { error: 'Profils invalides : rechargez la page.' }
  const unique = [...new Set(parsed.data)]
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: SESSION_EXPIRED }
  const tenantId = user.tenantId
  const taken: string[] = []
  try {
    const denial = mbcSearchDenial({ tenantId, subscriptionStatus: await tenantSubscriptionStatus(tenantId), emailVerified: user.emailVerification })
    if (denial) return { error: denial }
    const now = new Date()
    for (let i = 0; i < unique.length; i++) {
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
  try {
    return { profiles: await revealApolloPeople(unique) }
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
    console.error('[mbc-search] enrichissement impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Profils indisponibles pour le moment : réessayez dans quelques instants.' }
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
