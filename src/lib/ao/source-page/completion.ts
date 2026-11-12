// Complément des offres d'un e-mail par leur annonce d'origine (ADR 0031) : quelles offres lire, dans quelles limites,
// et ce qui en est repris. Sans accès réseau, base ni IA (fournis par complete.ts) : testé dans completion.test.ts avec
// des lectures et des quotas simulés. Ne lève jamais : une offre dont l'annonce n'est pas lue reste telle que l'e-mail
// la donne, avec la raison dans sa trace.

import type { ExtractedOffer } from '../types'
import { pageFillOf, type PageFill } from './page-fill'
import { checkPageUrl, fillFromPage, isIncomplete, PAGE_READS_PER_EMAIL, pickPageOffer } from './rules'

/** Lecture de la page (robots.txt, redirections et page comprises). */
export const PAGE_FETCH_MS = 15_000
/** Attente minimale et maximale de l'IA sur la page. */
export const PAGE_LLM_MIN_MS = 20_000
export const PAGE_LLM_MAX_MS = 60_000
/** Temps gardé après les lectures pour enregistrer les offres de l'e-mail. */
export const AFTER_READ_MS = 15_000
/** En dessous, une lecture (page puis IA) n'aurait pas le temps d'aboutir dans le passage : elle n'est pas commencée. */
export const PAGE_READ_MIN_MS = PAGE_FETCH_MS + PAGE_LLM_MIN_MS + AFTER_READ_MS

/**
 * Offre de l'e-mail, éventuellement complétée. `basis` : l'offre telle que l'e-mail la donne, dont est tirée l'empreinte
 * de dédoublonnage (une annonce relue autrement lors d'une reprise ne doit pas créer une seconde offre).
 */
export interface SourcedOffer {
  offer: ExtractedOffer
  basis: ExtractedOffer
  /** Trace de la lecture, enregistrée sur l'offre ; null si son annonce n'était pas à lire. */
  pageFill: PageFill | null
}

/**
 * Offres lues sur la page (noms du client à masquer déjà retenus) et adresse finale après redirections, ou la raison
 * pour laquelle elle n'est pas lue.
 */
export type PageRead = { ok: true; offers: ExtractedOffer[]; finalUrl: string } | { ok: false; reason: string }

export interface CompletionContext {
  now: Date
  timeLeft: () => number
  /** true : offre déjà enregistrée (doublon, ou essai interrompu du même e-mail) : son annonce n'est pas relue. */
  isKnown: (offer: ExtractedOffer) => Promise<boolean>
}

export interface CompletionDeps {
  /** Place sur les quotas du jour ; null si elle est prise, sinon la raison du refus. Ne lève pas. */
  takeQuota: () => Promise<string | null>
  /** Page lue puis confiée à l'IA. Ne lève pas. */
  readPage: (url: string) => Promise<PageRead>
}

export const asIs = (offer: ExtractedOffer): SourcedOffer => ({ offer, basis: offer, pageFill: null })

/** Offres de l'e-mail, dans le même ordre, complétées par leur annonce quand elles sont incomplètes (voir rules.ts). */
export async function completeOffers(offers: ExtractedOffer[], ctx: CompletionContext, deps: CompletionDeps): Promise<SourcedOffer[]> {
  const notRead = (offer: ExtractedOffer, reason: string): SourcedOffer =>
    ({ offer, basis: offer, pageFill: pageFillOf({ at: ctx.now, url: offer.sourceUrl, status: 'not_read', reason }) })

  // Décisions une à une (quotas, limite par e-mail), lectures ensuite en parallèle ; un même lien n'est lu qu'une fois.
  const reads = new Map<string, Promise<PageRead>>()
  const plans: (SourcedOffer | { offer: ExtractedOffer; read: Promise<PageRead> })[] = []
  for (const offer of offers) {
    if (!offer.sourceUrl || !isIncomplete(offer)) { plans.push(asIs(offer)); continue }
    const check = checkPageUrl(offer.sourceUrl)
    if (!check.ok) { plans.push(notRead(offer, check.reason)); continue }
    const url = check.url.href
    const shared = reads.get(url)
    if (shared) { plans.push({ offer, read: shared }); continue }
    let known: boolean
    try {
      known = await ctx.isKnown(offer)
    } catch (err) {
      // Doublons illisibles (base injoignable) : rien n'est lu ni dépensé ; la suite du traitement rencontrera la même erreur.
      console.error('AO: vérification des doublons impossible avant la lecture d\'une annonce', err instanceof Error ? err.message : String(err))
      plans.push(notRead(offer, 'vérification des doublons impossible'))
      continue
    }
    if (known) { plans.push(asIs(offer)); continue }
    if (reads.size >= PAGE_READS_PER_EMAIL) { plans.push(notRead(offer, `${PAGE_READS_PER_EMAIL} annonces au plus sont lues par e-mail`)); continue }
    if (ctx.timeLeft() < PAGE_READ_MIN_MS) { plans.push(notRead(offer, 'temps du passage écoulé')); continue }
    const refused = await deps.takeQuota()
    if (refused) { plans.push(notRead(offer, refused)); continue }
    const read = deps.readPage(url)
    reads.set(url, read)
    plans.push({ offer, read })
  }

  return Promise.all(plans.map(async plan => {
    if (!('read' in plan)) return plan
    const { offer } = plan
    const result = await plan.read
    if (!result.ok) return notRead(offer, result.reason)
    const match = pickPageOffer(offer, result.offers)
    if (!match) {
      const reason = result.offers.length ? 'la page décrit un autre poste' : 'aucune offre sur la page'
      return { offer, basis: offer, pageFill: pageFillOf({ at: ctx.now, url: offer.sourceUrl, finalUrl: result.finalUrl, status: 'unchanged', reason }) }
    }
    const filled = fillFromPage(offer, match)
    const status = filled.fields.length ? 'filled' : 'unchanged'
    // Site d'où viennent vraiment les champs : un raccourcisseur ou une redirection ne doit pas le masquer à la relecture.
    return {
      offer: filled.offer,
      basis: offer,
      pageFill: pageFillOf({ at: ctx.now, url: offer.sourceUrl, finalUrl: result.finalUrl, status, fields: filled.fields, reason: filled.fields.length ? '' : 'rien à compléter' }),
    }
  }))
}
