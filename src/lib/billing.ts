import { planLabel, type PaidPlanId } from './plans'

// Abonnement Stripe d'une organisation (ADR 0034) : que faire quand elle choisit une formule payante, et ce qu'un
// évènement Stripe change sur l'organisation (`tenants`). Règles pures, testées dans billing.test.ts ; les appels à
// Stripe sont dans src/app/(public)/abonnement/actions.ts et src/app/api/stripe/webhook/route.ts.

/** Abonnement Stripe en cours de l'organisation (`tenants.stripeSubscriptionId`), tel que Stripe le décrit. */
export interface CurrentSubscription { status: string; planId: string | null }

export type CheckoutStep = { step: 'create' } | { step: 'replace' } | { step: 'update' } | { error: string }

/**
 * Au choix d'une formule payante :
 * - `create` : aucun abonnement en cours (jamais, résilié, ou paiement initial jamais fait) ;
 * - `replace` : abonnement ouvert mais jamais payé (formulaire de carte abandonné) — il est annulé, puis remplacé ;
 * - `update` : abonnement en cours — sa formule change (prorata sur la facture suivante), sans second abonnement : avant
 *   le 2026-11-13, chaque choix en créait un nouveau et l'organisation payait les deux.
 */
export function checkoutStep(current: CurrentSubscription | null, wanted: PaidPlanId): CheckoutStep {
  if (!current || current.status === 'canceled' || current.status === 'incomplete_expired') return { step: 'create' }
  if (current.status === 'incomplete') return { step: 'replace' }
  if (current.status === 'past_due' || current.status === 'unpaid' || current.status === 'paused') {
    return { error: 'Un paiement de votre abonnement est en attente : réglez-le (« Factures et moyen de paiement ») avant de changer de formule.' }
  }
  if (current.status !== 'active' && current.status !== 'trialing') {
    return { error: 'État de votre abonnement inattendu : contactez-nous pour changer de formule.' }
  }
  if (current.planId === wanted) return { error: `Votre organisation a déjà la formule ${planLabel(wanted)}.` }
  return { step: 'update' }
}

/** Ce que le webhook lit d'un abonnement Stripe. */
export interface SubscriptionSnapshot {
  id: string
  status: string
  /** `metadata.planId` posé à la création ou au changement de formule ; null s'il manque. */
  planId: string | null
  interval: 'month' | 'year' | null
  unitAmountCents: number | null
}

export type BillingEvent = 'payment_succeeded' | 'payment_failed' | 'invoice_overdue' | 'subscription_deleted' | 'subscription_updated'

/** Abonnement Stripe en vigueur (payé au moins une fois, ou facturé sur facture) : seul un tel abonnement ouvre ou coupe l'accès. */
const IN_FORCE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused'])
/** États Stripe qui ouvrent l'accès (abonnement relu chez Stripe au moment de l'évènement). */
const OPEN = new Set(['active', 'trialing'])

/** Abonnement Stripe en cours (actif ou en essai). */
export function isOpenSubscription(status: string): boolean {
  return OPEN.has(status)
}

/**
 * État posé à la main par l'admin (/admin/subscriptions : « Suspendre », remboursement) : Stripe ne le change jamais
 * (l'abonnement Stripe reste actif) et l'organisation ne peut pas changer de formule ; seul l'admin le lève.
 */
export function isAdminHold(subscriptionStatus: unknown): boolean {
  return subscriptionStatus === 'suspended' || subscriptionStatus === 'refunded'
}

/** Ce que le webhook a relu chez Stripe en plus de l'abonnement de l'évènement. */
export interface EventContext {
  /** Facture de l'évènement payée au moment où il est traité : un « paiement échoué » arrivé en retard n'agit plus. */
  invoicePaid: boolean
  /**
   * Abonnement enregistré sur l'organisation encore en cours chez Stripe ; null s'il n'a pas été relu (aucun, ou c'est
   * celui de l'évènement).
   */
  recordedOpen: boolean | null
}

const NO_CONTEXT: EventContext = { invoicePaid: false, recordedOpen: null }

function priceFields(sub: SubscriptionSnapshot): Record<string, unknown> {
  return {
    ...(sub.planId ? { plan: sub.planId } : {}),
    subscriptionPeriod: sub.interval === 'year' ? 'annual' : 'monthly',
    ...(sub.unitAmountCents !== null ? { subscriptionAmount: Math.round(sub.unitAmountCents / 100) } : {}),
  }
}

/**
 * Champs de l'organisation à écrire pour un évènement Stripe ; null : rien à écrire.
 * - Un évènement d'un autre abonnement que celui de l'organisation (ancien, remplacé) est ignoré : sinon la résiliation
 *   d'un ancien abonnement coupait le nouveau. Exception : un abonnement en cours (payé) est adopté si l'organisation
 *   n'en a pas d'enregistré (enregistrement échoué) ou si le sien n'est plus en cours (deux paiements ouverts en même
 *   temps, un seul payé).
 * - Un paiement n'ouvre l'accès que si Stripe dit l'abonnement en cours (`sub` relu au moment de l'évènement) : un
 *   « paiement réussi » rejoué après une résiliation ne la défait pas. Un premier paiement refusé ou abandonné ne coupe
 *   pas l'accès en cours ; un « paiement échoué » arrivé après le paiement de la facture non plus.
 * - Un état posé par l'admin (suspendu, remboursé) n'est jamais remplacé (`isAdminHold`).
 */
export function tenantPatchFor(
  event: BillingEvent,
  sub: SubscriptionSnapshot,
  tenant: { stripeSubscriptionId: string | null; subscriptionStartedAt: string | null; subscriptionStatus: string | null },
  now: Date,
  context: EventContext = NO_CONTEXT,
): Record<string, unknown> | null {
  const patch = patchFor(event, sub, tenant, now, context)
  if (!patch || !isAdminHold(tenant.subscriptionStatus)) return patch
  const kept = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'subscriptionStatus'))
  return Object.keys(kept).length > 0 ? kept : null
}

function patchFor(
  event: BillingEvent,
  sub: SubscriptionSnapshot,
  tenant: { stripeSubscriptionId: string | null; subscriptionStartedAt: string | null },
  now: Date,
  context: EventContext,
): Record<string, unknown> | null {
  const current = tenant.stripeSubscriptionId
  const adopts = (event === 'payment_succeeded' || event === 'subscription_updated')
    && OPEN.has(sub.status) && (!current || (current !== sub.id && context.recordedOpen === false))
  if (current !== sub.id && !adopts) return null
  const link = adopts ? { stripeSubscriptionId: sub.id } : {}
  switch (event) {
    case 'payment_succeeded':
      if (!OPEN.has(sub.status)) return null
      return {
        ...link,
        ...priceFields(sub),
        subscriptionStatus: sub.status === 'trialing' ? 'trialing' : 'active',
        // Date de la première souscription : les paiements suivants ne la remplacent plus.
        ...(tenant.subscriptionStartedAt ? {} : { subscriptionStartedAt: now.toISOString() }),
      }
    case 'subscription_updated':
      // Repasse aussi « actif » : un paiement relancé réussi peut avoir été lu quand l'abonnement était encore en retard.
      return OPEN.has(sub.status) ? { ...link, ...priceFields(sub), subscriptionStatus: sub.status === 'trialing' ? 'trialing' : 'active' } : null
    case 'payment_failed':
    case 'invoice_overdue':
      return IN_FORCE.has(sub.status) && !context.invoicePaid ? { subscriptionStatus: 'past_due' } : null
    case 'subscription_deleted':
      // Jamais payé (paiement initial expiré) : l'accès d'avant reste, l'abonnement est seulement détaché.
      return sub.status === 'incomplete_expired' ? { stripeSubscriptionId: null } : { subscriptionStatus: 'cancelled' }
  }
}
