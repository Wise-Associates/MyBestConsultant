import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { Query } from 'node-appwrite'
import type Stripe from 'stripe'

// Source de vérité du statut d'abonnement : c'est ce webhook, pas le navigateur du recruteur, qui
// active (ou coupe) réellement le plan — on ne fait jamais confiance à une simple confirmation client.

// Depuis la montée de version de l'API Stripe, la facture référence son abonnement via
// `invoice.parent.subscription_details.subscription` (l'ancien `invoice.subscription` n'existe plus).
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

async function findTenantId(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.tenantId) return sub.metadata.tenantId
  const { databases } = createAdminClient()
  const res = await databases.listDocuments(DB_ID, COLLECTIONS.TENANTS, [Query.equal('stripeSubscriptionId', sub.id), Query.limit(1)])
  return res.documents[0]?.$id ?? null
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook non configuré' }, { status: 500 })
  const stripe = getStripe()

  const sig = req.headers.get('stripe-signature')
  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig ?? '', secret)
  } catch (e) {
    return NextResponse.json({ error: `Signature invalide: ${e instanceof Error ? e.message : ''}` }, { status: 400 })
  }

  const { databases } = createAdminClient()

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = invoiceSubscriptionId(invoice)
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null)
        if (!sub) break
        const tenantId = await findTenantId(sub)
        if (!tenantId) break
        const planId = sub.metadata?.planId ?? null
        await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, {
          plan: planId,
          subscriptionStatus: 'active',
          subscriptionPeriod: 'monthly',
          subscriptionAmount: Math.round((invoice.amount_paid ?? 0) / 100),
          subscriptionStartedAt: new Date().toISOString(),
        })
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = invoiceSubscriptionId(invoice)
        if (!subId) break
        const sub = await stripe.subscriptions.retrieve(subId).catch(() => null)
        if (!sub) break
        const tenantId = await findTenantId(sub)
        if (tenantId) await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { subscriptionStatus: 'past_due' })
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const tenantId = await findTenantId(sub)
        if (tenantId) await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { subscriptionStatus: 'cancelled' })
        break
      }
      default:
        break
    }
  } catch {
    // Best-effort : on répond quand même 200 pour éviter que Stripe ne re-tente indéfiniment un
    // évènement dont le traitement échoue de façon non transitoire (tenant supprimé, etc.).
  }

  return NextResponse.json({ received: true })
}
