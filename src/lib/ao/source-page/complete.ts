// Complément des offres incomplètes par leur annonce d'origine, pendant la lecture d'un e-mail (sync.ts, ADR 0031) :
// branche sur les règles de completion.ts la vraie lecture de la page (fetch-page.ts), l'IA (extract.ts) et les quotas
// du jour (state.ts). Activé par AO_SOURCE_PAGES_ENABLED=true. Ne lève jamais.

import { AiUnavailable } from '../extractors/types'
import { extractOffersFromPage } from '../extract'
import { releaseDailySlot, takeDailySlotId } from '../state'
import { PLATFORM_TENANT_ID } from '../tenancy'
import type { ExtractedOffer } from '../types'
import { AFTER_READ_MS, asIs, completeOffers, PAGE_FETCH_MS, PAGE_LLM_MAX_MS, PAGE_LLM_MIN_MS, type CompletionContext, type PageRead, type SourcedOffer } from './completion'
import { fetchSourcePage, type RobotsCache } from './fetch-page'
import { PAGE_READ_DAILY_LIMITS, withPageClientNames } from './rules'

export type { SourcedOffer } from './completion'

/** Lecture des annonces d'origine activée (variable d'environnement : coupée sans changer le code, l'application relancée). */
export function pageReadingEnabled(): boolean {
  return process.env.AO_SOURCE_PAGES_ENABLED === 'true'
}

export interface PageReadContext extends CompletionContext {
  tenantId: string
  /** Organisation qui lit la boîte : jamais retenue comme client, ni masquée. */
  orgName: string
  /** Date de réception de l'e-mail : année des dates écrites sans. */
  receivedAt: Date
  /** robots.txt déjà lus pendant le passage. */
  robots: RobotsCache
}

/** Offres de l'e-mail, dans le même ordre, complétées par leur annonce quand elles sont incomplètes. */
export async function completeFromSourcePages(offers: ExtractedOffer[], ctx: PageReadContext): Promise<SourcedOffer[]> {
  if (!pageReadingEnabled()) return offers.map(asIs)
  return completeOffers(offers, ctx, { takeQuota: () => takeQuota(ctx), readPage: url => readPage(url, ctx) })
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Place sur les quotas du jour (organisation, puis toutes) ; null si elle est prise, sinon la raison du refus. Une
 * lecture qui échoue ensuite compte quand même (comme les autres quotas d'IA : sinon un lien qui échoue à chaque essai
 * ne serait jamais borné) ; une place prise pour rien (quota de la plateforme plein, erreur) est rendue.
 */
async function takeQuota(ctx: PageReadContext): Promise<string | null> {
  let own: string | null = null
  try {
    own = await takeDailySlotId('aoPageOrg', ctx.tenantId, ctx.now, PAGE_READ_DAILY_LIMITS.org)
    if (!own) return `quota du jour atteint (${PAGE_READ_DAILY_LIMITS.org} annonces lues par organisation)`
    // La boîte de la plateforme ne dépend pas du plafond commun : des organisations inscrites librement pourraient
    // sinon l'épuiser chaque jour. Son propre quota suffit à borner son coût.
    if (ctx.tenantId === PLATFORM_TENANT_ID) return null
    if (await takeDailySlotId('aoPageAll', 'platform', ctx.now, PAGE_READ_DAILY_LIMITS.all)) return null
    const slot = own
    own = null
    await releaseDailySlot(slot)
    return `quota du jour atteint (${PAGE_READ_DAILY_LIMITS.all} annonces lues pour toute la plateforme)`
  } catch (err) {
    console.error('AO: quota de lecture des annonces illisible', ctx.tenantId, message(err))
    if (own) await releaseDailySlot(own).catch((releaseErr: unknown) => console.error('AO: place de quota non rendue', own, message(releaseErr)))
    return 'quota du jour illisible'
  }
}

/** Page lue puis confiée à l'IA ; jamais d'exception (la raison est rendue). */
async function readPage(url: string, ctx: PageReadContext): Promise<PageRead> {
  const page = await fetchSourcePage(url, { robots: ctx.robots, timeoutMs: Math.min(PAGE_FETCH_MS, ctx.timeLeft() - PAGE_LLM_MIN_MS - AFTER_READ_MS) })
  if (!page.ok) return page
  const llmWait = Math.min(PAGE_LLM_MAX_MS, ctx.timeLeft() - AFTER_READ_MS)
  if (llmWait < PAGE_LLM_MIN_MS) return { ok: false, reason: 'temps du passage écoulé' }
  try {
    const { offers } = await extractOffersFromPage(page.text, llmWait, ctx.orgName, ctx.receivedAt)
    // Noms du client lus sur la page (client, client final, autres noms) : masqués à la publication s'ils y sont cités.
    return { ok: true, offers: offers.map(o => withPageClientNames(o, page.text, ctx.orgName)), finalUrl: page.finalUrl }
  } catch (err) {
    if (err instanceof AiUnavailable) return { ok: false, reason: `IA indisponible (${err.reason})` }
    console.error('AO: annonce d\'origine non lue par l\'IA', new URL(url).hostname, message(err))
    return { ok: false, reason: 'réponse de l’IA illisible ou trop lente' }
  }
}
