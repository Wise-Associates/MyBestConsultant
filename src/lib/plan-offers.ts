import { z } from 'zod'
import { DAILY_QUOTAS, FEATURES, STANDARD_DAILY_QUOTAS, type DailyQuota, type Entitlements, type Feature } from './plans'

// Offres sur mesure (ADR 0034, étape 2) : conditions préparées par l'admin pour une organisation (prix, période,
// paiement, utilisateurs, offres actives, fonctions, quotas du jour), acceptées par son propriétaire ou un
// administrateur. Une offre acceptée est figée : ses droits sont ceux de la formule « custom » de l'organisation, et une
// nouvelle négociation ne peut pas les changer en cours de contrat. Règles pures, testées dans plan-offers.test.ts.

export type OfferStatus = 'proposed' | 'accepted' | 'withdrawn'
export type OfferPeriod = 'monthly' | 'annual'
export type OfferPayment = 'card' | 'invoice'

export const OFFER_LIMITS = {
  name: 120, priceCentsMin: 100, priceCentsMax: 10_000_000, usersMax: 500, activeJobsMax: 1000, quotaMax: 10_000, daysUntilDueMax: 90,
  /** Validité d'une proposition : 3 ans au plus. */
  validityDaysMax: 3 * 365,
} as const

/**
 * Délai pendant lequel une offre acceptée par carte attend son paiement : Stripe fait expirer un premier paiement
 * abandonné en 23 h. Pendant ce délai, l'admin ne peut pas la modifier (le paiement en cours paierait d'autres conditions).
 */
export const PAYMENT_PENDING_MS = 24 * 3600_000
const L = OFFER_LIMITS

export interface PlanOffer {
  name: string
  status: OfferStatus
  priceCents: number
  period: OfferPeriod
  paymentMethod: OfferPayment
  /** Délai de paiement d'une facture (jours), pour le paiement par facture. */
  daysUntilDue: number
  terms: Entitlements
  /** Fin de validité d'une offre proposée (ISO) : passée, elle ne peut plus être acceptée. */
  validUntil: string
  proposedAt: string
  acceptedAt: string | null
  /** Compte Auth qui l'a acceptée. */
  acceptedBy: string | null
}

const quotasSchema = z.object(Object.fromEntries(DAILY_QUOTAS.map(q => [q, z.number().int().min(0).max(L.quotaMax)])) as Record<DailyQuota, z.ZodNumber>)

/** Conditions saisies par l'admin ; `validUntil` : date (AAAA-MM-JJ), valable jusqu'à la fin de ce jour (UTC). */
export const offerInputSchema = z.object({
  name: z.string().trim().min(2, 'Nom de l\'offre requis.').max(L.name),
  priceCents: z.number().int().min(L.priceCentsMin, 'Prix d\'au moins 1 €.').max(L.priceCentsMax),
  period: z.enum(['monthly', 'annual']),
  paymentMethod: z.enum(['card', 'invoice']),
  daysUntilDue: z.number().int().min(1).max(L.daysUntilDueMax),
  maxUsers: z.number().int().min(1).max(L.usersMax),
  maxActiveJobs: z.number().int().min(1).max(L.activeJobsMax).nullable(),
  features: z.array(z.enum(FEATURES)).max(FEATURES.length),
  dailyQuotas: quotasSchema,
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de fin de validité invalide.'),
})
export type OfferInput = z.input<typeof offerInputSchema>

/** Champs du document `plan_offers` d'une nouvelle proposition ; erreur lisible si les conditions sont invalides. */
export function offerDocument(raw: unknown, now: Date): { data: Record<string, unknown> } | { error: string } {
  const parsed = offerInputSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Conditions de l\'offre invalides.' }
  const input = parsed.data
  // Une date impossible (31 février) serait lue comme un autre jour : refusée.
  const day = Date.parse(`${input.validUntil}T00:00:00.000Z`)
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== input.validUntil) return { error: 'Date de fin de validité invalide.' }
  const validUntil = `${input.validUntil}T23:59:59.000Z`
  if (Date.parse(validUntil) < now.getTime()) return { error: 'La date de fin de validité doit être aujourd\'hui ou plus tard.' }
  if (day - now.getTime() > L.validityDaysMax * 86_400_000) return { error: 'Validité de 3 ans au plus.' }
  return {
    data: {
      name: input.name,
      status: 'proposed',
      priceCents: input.priceCents,
      period: input.period,
      paymentMethod: input.paymentMethod,
      daysUntilDue: input.daysUntilDue,
      maxUsers: input.maxUsers,
      maxActiveJobs: input.maxActiveJobs,
      features: [...new Set(input.features)],
      quotasJson: JSON.stringify(input.dailyQuotas),
      validUntil,
      proposedAt: now.toISOString(),
      acceptedAt: null,
      acceptedBy: null,
      stripeSubscriptionId: null,
    },
  }
}

const storedSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['proposed', 'accepted', 'withdrawn']),
  priceCents: z.number().int().min(0),
  period: z.enum(['monthly', 'annual']),
  paymentMethod: z.enum(['card', 'invoice']),
  daysUntilDue: z.number().int().min(1),
  maxUsers: z.number().int().min(1),
  maxActiveJobs: z.number().int().min(1).nullable().optional(),
  features: z.array(z.string()).nullable().optional(),
  quotasJson: z.string(),
  validUntil: z.string(),
  proposedAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  acceptedBy: z.string().nullable().optional(),
})

/** Quotas enregistrés : relus sans les bornes de la saisie (une offre acceptée garde les siens si les bornes changent). */
const storedQuotasSchema = z.record(z.string(), z.number().int().min(0))

/**
 * Offre lue en base ; null si le document est illisible (jamais des droits devinés). Un quota ajouté après
 * l'enregistrement de l'offre (nouvelle entrée de DAILY_QUOTAS) prend la valeur des formules standard : sinon chaque
 * ajout rendait toutes les offres illisibles, et leurs organisations perdaient leurs droits sans que rien ne le dise.
 */
export function offerOf(doc: Record<string, unknown>): PlanOffer | null {
  const parsed = storedSchema.safeParse(doc)
  if (!parsed.success) return null
  let quotas: unknown
  try { quotas = JSON.parse(parsed.data.quotasJson) } catch { return null }
  const stored = storedQuotasSchema.safeParse(quotas)
  if (!stored.success) return null
  const dailyQuotas = Object.fromEntries(DAILY_QUOTAS.map(q => [q, stored.data[q] ?? STANDARD_DAILY_QUOTAS[q]])) as Record<DailyQuota, number>
  const d = parsed.data
  const features = d.features ?? []
  return {
    name: d.name,
    status: d.status,
    priceCents: d.priceCents,
    period: d.period,
    paymentMethod: d.paymentMethod,
    daysUntilDue: d.daysUntilDue,
    terms: {
      maxUsers: d.maxUsers,
      maxActiveJobs: d.maxActiveJobs ?? null,
      features: Object.fromEntries(FEATURES.map(f => [f, features.includes(f)])) as Record<Feature, boolean>,
      dailyQuotas,
    },
    validUntil: d.validUntil,
    proposedAt: d.proposedAt,
    acceptedAt: d.acceptedAt ?? null,
    acceptedBy: d.acceptedBy ?? null,
  }
}

/** Droits de la formule « custom » : ceux d'une offre acceptée seulement. */
export function acceptedTerms(offer: PlanOffer | null): Entitlements | null {
  return offer?.status === 'accepted' ? offer.terms : null
}

export type OfferState = 'proposed' | 'expired' | 'accepted' | 'withdrawn'

/** État affiché : une offre proposée dont la validité est passée est « expirée ». */
export function offerState(offer: PlanOffer, now: Date): OfferState {
  if (offer.status === 'proposed' && Date.parse(offer.validUntil) < now.getTime()) return 'expired'
  return offer.status
}

/**
 * Refus d'accepter l'offre ; null si permis. Une offre proposée et encore valable s'accepte ; une offre acceptée dont le
 * paiement par carte n'a pas abouti (formule de l'organisation pas encore « custom ») peut être payée de nouveau.
 */
export function acceptDenial(offer: PlanOffer | null, tenantPlan: unknown, now: Date): string | null {
  if (!offer || offer.status === 'withdrawn') return 'Aucune offre sur mesure en cours pour votre organisation.'
  if (offer.status === 'accepted' && tenantPlan === 'custom') return 'Votre organisation a déjà cette offre.'
  // Proposée, ou acceptée sans paiement abouti : jamais après sa validité (sinon payable des mois plus tard à l'ancien prix).
  if (Date.parse(offer.validUntil) < now.getTime()) return 'Cette offre a expiré : contactez-nous pour la renouveler.'
  return null
}

/**
 * Refus de modifier ou de retirer l'offre côté admin ; null si permis. Une offre acceptée est figée tant qu'elle est le
 * contrat de l'organisation (formule « custom ») et pendant le délai d'un paiement par carte en cours ; ensuite (paiement
 * abandonné, organisation passée à une autre formule), l'admin peut la remplacer.
 */
export function adminEditDenial(offer: PlanOffer | null, tenantPlan: unknown, now: Date): string | null {
  if (offer?.status !== 'accepted') return null
  if (tenantPlan === 'custom') {
    return 'Offre acceptée, contrat en cours : elle ne peut plus être modifiée. Changez d\'abord la formule de l\'organisation (et son abonnement Stripe).'
  }
  const acceptedAt = offer.acceptedAt ? Date.parse(offer.acceptedAt) : NaN
  if (Number.isFinite(acceptedAt) && now.getTime() - acceptedAt < PAYMENT_PENDING_MS) {
    return 'Offre acceptée il y a moins de 24 h : son paiement par carte est peut-être en cours. Réessayez plus tard.'
  }
  return null
}

/**
 * Document `plan_offers` complet d'une offre acceptée : les conditions lues au début de l'acceptation (celles que Stripe
 * facture), réécrites en entier. Si l'admin a enregistré une autre proposition entre-temps, l'acceptation l'emporte :
 * les droits restent ceux que l'organisation paie (Appwrite n'a pas d'écriture conditionnelle).
 */
export function acceptedDocument(offer: PlanOffer, acceptance: { acceptedAt: string; acceptedBy: string; stripeSubscriptionId: string }): Record<string, unknown> {
  const { terms } = offer
  return {
    name: offer.name,
    status: 'accepted',
    priceCents: offer.priceCents,
    period: offer.period,
    paymentMethod: offer.paymentMethod,
    daysUntilDue: offer.daysUntilDue,
    maxUsers: terms.maxUsers,
    maxActiveJobs: terms.maxActiveJobs,
    features: FEATURES.filter(f => terms.features[f]),
    quotasJson: JSON.stringify(terms.dailyQuotas),
    validUntil: offer.validUntil,
    proposedAt: offer.proposedAt,
    ...acceptance,
  }
}

/** « 1 200 € / mois » ou « 12 000 € / an » (séparateur des milliers français). */
export function offerPriceText(offer: Pick<PlanOffer, 'priceCents' | 'period'>): string {
  const euros = offer.priceCents / 100
  const amount = Number.isInteger(euros) ? euros.toLocaleString('fr-FR') : euros.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${amount} € / ${offer.period === 'annual' ? 'an' : 'mois'}`
}
