import { NextRequest, NextResponse } from 'next/server'
import { Query, type Models } from 'node-appwrite'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { isOpenSubscription, tenantPatchFor, type BillingEvent, type SubscriptionSnapshot } from '@/lib/billing'
import { getStripe, stripeStatusOf } from '@/lib/stripe'

// Source de vérité du statut d'abonnement : c'est ce webhook, pas le navigateur du recruteur, qui
// active (ou coupe) réellement le plan — on ne fait jamais confiance à une simple confirmation client.
// Règles appliquées (abonnement en cours de l'organisation seulement, premier paiement refusé sans effet…) :
// src/lib/billing.ts (ADR 0034). Évènements à envoyer, dans le tableau de bord Stripe (Développeurs → Webhooks) :
// invoice.payment_succeeded, invoice.payment_failed, invoice.overdue, customer.subscription.updated,
// customer.subscription.deleted. Chaque écriture pose des valeurs absolues : un évènement rejoué ne change rien.

const EVENTS: Partial<Record<string, BillingEvent>> = {
  'invoice.payment_succeeded': 'payment_succeeded',
  'invoice.payment_failed': 'payment_failed',
  'invoice.overdue': 'invoice_overdue',
  'customer.subscription.updated': 'subscription_updated',
  'customer.subscription.deleted': 'subscription_deleted',
}

// Depuis la montée de version de l'API Stripe, la facture référence son abonnement via
// `invoice.parent.subscription_details.subscription` (l'ancien `invoice.subscription` n'existe plus).
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

function snapshotOf(sub: Stripe.Subscription): SubscriptionSnapshot {
  const price = sub.items.data[0]?.price
  const interval = price?.recurring?.interval
  return {
    id: sub.id,
    status: sub.status,
    planId: sub.metadata?.planId || null,
    interval: interval === 'month' ? 'month' : interval === 'year' ? 'year' : null,
    unitAmountCents: typeof price?.unit_amount === 'number' ? price.unit_amount : null,
  }
}

const text = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Organisation de l'abonnement : `metadata.tenantId` posé à la création, sinon celle qui l'a enregistré ; null si aucune. */
async function findTenant(sub: Stripe.Subscription): Promise<Models.Document | null> {
  const { databases } = createAdminClient()
  const tenantId = sub.metadata?.tenantId
  if (tenantId) {
    try {
      return await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null
      throw err
    }
  }
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('stripeSubscriptionId', sub.id), Query.limit(1)])
  return res.documents[0] ?? null
}

/** Relit un objet chez Stripe ; null s'il n'existe pas (ou plus). */
async function retrieveOrNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    if (stripeStatusOf(err) === 404) return null
    throw err
  }
}

/**
 * Abonnement concerné par l'évènement et facture de l'évènement, relus chez Stripe (les évènements peuvent arriver dans
 * le désordre ou être rejoués : l'état joint à un ancien évènement réécrirait une ancienne formule, ou un retard de
 * paiement déjà réglé) ; abonnement null si aucun (facture hors abonnement, abonnement inconnu).
 */
async function stateOf(event: Stripe.Event): Promise<{ sub: Stripe.Subscription | null; invoicePaid: boolean }> {
  const stripe = getStripe()
  if (!event.type.startsWith('invoice.')) {
    const sub = await retrieveOrNull(() => stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id))
    return { sub, invoicePaid: false }
  }
  const sent = event.data.object as Stripe.Invoice
  const invoice = sent.id ? await retrieveOrNull(() => stripe.invoices.retrieve(sent.id as string)) : null
  const subId = invoiceSubscriptionId(invoice ?? sent)
  const sub = subId ? await retrieveOrNull(() => stripe.subscriptions.retrieve(subId)) : null
  return { sub, invoicePaid: invoice?.status === 'paid' }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook non configuré' }, { status: 500 })

  const sig = req.headers.get('stripe-signature')
  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig ?? '', secret)
  } catch (err) {
    console.warn('[stripe] signature du webhook invalide', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Signature invalide' }, { status: 400 })
  }

  const kind = EVENTS[event.type]
  if (!kind) return NextResponse.json({ received: true })

  try {
    const { sub, invoicePaid } = await stateOf(event)
    if (!sub) return NextResponse.json({ received: true })
    const tenant = await findTenant(sub)
    if (!tenant) {
      console.warn('[stripe] abonnement sans organisation, évènement ignoré', event.type, sub.id)
      return NextResponse.json({ received: true })
    }
    const recordedId = text(tenant.stripeSubscriptionId)
    // Paiement d'un autre abonnement que celui enregistré : celui-ci est-il encore en cours ? (règle d'adoption, billing.ts)
    let recordedOpen: boolean | null = null
    if (recordedId && recordedId !== sub.id && (kind === 'payment_succeeded' || kind === 'subscription_updated')) {
      const recorded = await retrieveOrNull(() => getStripe().subscriptions.retrieve(recordedId))
      recordedOpen = recorded !== null && isOpenSubscription(recorded.status)
    }
    const patch = tenantPatchFor(kind, snapshotOf(sub), {
      stripeSubscriptionId: recordedId,
      subscriptionStartedAt: text(tenant.subscriptionStartedAt),
      subscriptionStatus: text(tenant.subscriptionStatus),
    }, new Date(), { invoicePaid, recordedOpen })
    if (!patch) {
      if (kind === 'payment_succeeded' && recordedId !== sub.id && isOpenSubscription(sub.status)) {
        // Payé mais à côté de l'abonnement en cours de l'organisation : à rembourser ou rattacher à la main.
        console.error('[stripe] paiement d\'un abonnement non enregistré sur l\'organisation', sub.id, tenant.$id, recordedId)
      } else {
        console.info('[stripe] évènement sans effet sur l\'organisation', event.type, sub.id, tenant.$id)
      }
      return NextResponse.json({ received: true })
    }
    await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenant.$id, patch)
  } catch (err) {
    // 500 : Stripe renverra l'évènement (pendant plusieurs jours). Avant le 2026-11-13, l'erreur était avalée et
    // l'évènement perdu (paiement confirmé sans abonnement activé).
    console.error('[stripe] évènement non appliqué, Stripe le renverra', event.type, event.id, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Évènement non appliqué' }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
