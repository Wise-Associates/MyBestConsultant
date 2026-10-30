'use server'

import { z } from 'zod'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { tenantSubscriptionStatus } from '@/lib/ao/offer-actions'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { ApolloSearchError, briefToCriteriaText, searchApolloPeople } from '@/lib/mbc-search/apollo'
import { MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial } from '@/lib/mbc-search/access'
import {
  CRITERIA_LIMITS, MAX_PAGE, criteriaProblem, criteriaSchema, parseBriefCriteria, rankProfiles, type MbcCriteria, type ScoredProfile,
} from '@/lib/mbc-search/rules'

// Actions de MBC Search (/recruiter/mbc-search, ADR 0018). Chacune vérifie elle-même le recruteur : une Server Action
// est un point d'entrée public. Les résultats ne sont pas enregistrés : rien n'est écrit, sauf les places de quota.

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
