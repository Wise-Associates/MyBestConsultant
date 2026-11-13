import 'server-only'
import type Stripe from 'stripe'
import type { Models } from 'node-appwrite'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getStripe, stripeStatusOf } from '@/lib/stripe'
import type { UserProfile } from '@/types'

// Client et abonnement Stripe d'une organisation, partagés par le choix d'une formule (/abonnement) et l'acceptation
// d'une offre sur mesure (/recruiter/abonnement). Règles de choix : src/lib/billing.ts (ADR 0034).

/**
 * Client Stripe de l'organisation, créé au premier paiement puis réutilisé. Clé d'idempotence : deux demandes
 * simultanées (deux onglets) reçoivent le même client au lieu d'en créer deux.
 */
export async function ensureStripeCustomer(tenant: Models.Document, user: UserProfile): Promise<string> {
  if (typeof tenant.stripeCustomerId === 'string' && tenant.stripeCustomerId) return tenant.stripeCustomerId
  const customer = await getStripe().customers.create(
    { email: user.email, name: String(tenant.name ?? ''), metadata: { tenantId: tenant.$id } },
    { idempotencyKey: `mbc-customer-${tenant.$id}` },
  )
  await createAdminClient().databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenant.$id, { stripeCustomerId: customer.id })
  return customer.id
}

/** Abonnement Stripe enregistré sur l'organisation ; null s'il n'y en a pas ou si Stripe ne le connaît pas (supprimé). */
export async function recordedSubscription(tenant: Models.Document): Promise<Stripe.Subscription | null> {
  const id = typeof tenant.stripeSubscriptionId === 'string' && tenant.stripeSubscriptionId ? tenant.stripeSubscriptionId : null
  if (!id) return null
  try {
    return await getStripe().subscriptions.retrieve(id)
  } catch (err) {
    if (stripeStatusOf(err) !== 404) throw err
    return null
  }
}

/**
 * Abonnement de l'offre sur mesure déjà en cours chez Stripe pour ce client et cette organisation, même s'il n'a pas été
 * enregistré (écriture échouée après sa création) : jamais un second abonnement pour la même offre.
 */
export async function openCustomSubscription(customerId: string, tenantId: string): Promise<Stripe.Subscription | null> {
  const { data } = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
  return data.find(s => s.metadata?.tenantId === tenantId && s.metadata?.planId === 'custom' && (s.status === 'active' || s.status === 'trialing')) ?? null
}

/**
 * Annule un abonnement jamais payé avant de le remplacer. Détaché de l'organisation d'abord : l'évènement « abonnement
 * supprimé » de l'ancien ne la touche plus (billing.ts) ; rattaché de nouveau si l'annulation échoue.
 */
export async function replaceUnpaidSubscription(tenantId: string, sub: Stripe.Subscription): Promise<void> {
  const { databases } = createAdminClient()
  await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: null })
  try {
    await getStripe().subscriptions.cancel(sub.id)
  } catch (err) {
    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: sub.id })
    throw err
  }
}

/** `client_secret` du premier paiement par carte d'un abonnement créé avec `expand: ['latest_invoice.confirmation_secret']`. */
export function firstPaymentSecret(sub: Stripe.Subscription): string {
  // Depuis la montée de version de l'API Stripe, le client_secret à confirmer côté client n'est plus sous
  // latest_invoice.payment_intent mais sous latest_invoice.confirmation_secret.
  const invoice = typeof sub.latest_invoice === 'string' ? null : sub.latest_invoice
  const secret = invoice?.confirmation_secret?.client_secret
  if (!secret) throw new Error(`abonnement ${sub.id} sans client_secret`)
  return secret
}
