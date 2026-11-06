'use server'

import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { tenantSubscriptionStatus } from '@/lib/ao/offer-actions'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { ApolloSearchError, briefToCriteriaText, revealApolloPeople, searchApolloPeople } from '@/lib/mbc-search/apollo'
import {
  MBC_REVEAL_DAILY_LIMITS, MBC_REVEAL_QUOTA_MESSAGE, MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial,
} from '@/lib/mbc-search/access'
import {
  APOLLO_PERSON_ID, CRITERIA_LIMITS, MAX_PAGE, REVEAL_BATCH, criteriaProblem, criteriaSchema, parseBriefCriteria, rankProfiles,
  type MbcCriteria, type MbcRevealed, type ScoredProfile,
} from '@/lib/mbc-search/rules'

// Actions de MBC Search (/recruiter/mbc-search, ADR 0018). Chacune vérifie elle-même le recruteur : une Server Action
// est un point d'entrée public. Les résultats ne sont pas enregistrés (ni profils révélés, ni coordonnées) : rien n'est
// écrit, sauf les places de quota.

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

/** « Rechercher » : profils d'Apollo pour ces critères, classés avec les raisons du score. */
export async function searchMbcProfiles(criteria: unknown, page: unknown = 1): Promise<{
  profiles?: ScoredProfile[]
  total?: number
  error?: string
}> {
  const c = criteriaSchema.safeParse(criteria)
  const p = pageSchema.safeParse(page)
  if (!c.success || !p.success) return { error: 'Critères invalides : rechargez la page.' }
  const problem = criteriaProblem(c.data)
  if (problem) return { error: problem }
  const refused = await searchSlot()
  if (refused) return refused
  try {
    const { total, profiles } = await searchApolloPeople(c.data, p.data)
    return { total, profiles: rankProfiles(profiles, c.data, new Date()) }
  } catch (err) {
    if (err instanceof ApolloSearchError) return { error: err.message }
    console.error('[mbc-search] recherche impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Recherche impossible pour le moment : réessayez dans quelques instants.' }
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
