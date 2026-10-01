'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { getStripe, PLAN_PRICE_CENTS, ensurePlanProduct, type PaidPlanId } from '@/lib/stripe'

/**
 * Crée (ou récupère) l'abonnement Stripe du recruteur connecté pour le plan choisi, et renvoie le
 * `clientSecret` nécessaire pour afficher le formulaire de carte bancaire (Stripe Elements) côté client.
 * L'abonnement reste "incomplete" tant que le paiement n'est pas confirmé par le webhook Stripe
 * (voir /api/stripe/webhook) — c'est lui, pas cette action, qui active réellement le plan du tenant.
 */
export async function startSubscriptionCheckout(planId: PaidPlanId): Promise<{ clientSecret?: string; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Connectez-vous avec un compte recruteur pour vous abonner.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Paiement non configuré (clé Stripe manquante).' }

  const { databases } = createAdminClient()
  const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId)
  const stripe = getStripe()

  try {
    // Un seul client Stripe par tenant — réutilisé pour les abonnements suivants (changement de formule, etc.).
    let customerId = tenant.stripeCustomerId as string | undefined
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: tenant.name as string,
        metadata: { tenantId: user.tenantId },
      })
      customerId = customer.id
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId, { stripeCustomerId: customerId })
    }

    const productId = await ensurePlanProduct(planId)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{
        price_data: {
          currency: 'eur',
          product: productId,
          unit_amount: PLAN_PRICE_CENTS[planId],
          recurring: { interval: 'month' },
        },
      }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.confirmation_secret'],
      metadata: { tenantId: user.tenantId, planId },
    })

    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId, { stripeSubscriptionId: subscription.id })

    // Depuis la montée de version de l'API Stripe, le client_secret à confirmer côté client n'est
    // plus sous latest_invoice.payment_intent mais sous latest_invoice.confirmation_secret.
    const invoice = typeof subscription.latest_invoice === 'string' ? null : subscription.latest_invoice
    const clientSecret = invoice?.confirmation_secret?.client_secret
    if (!clientSecret) return { error: 'Impossible de préparer le paiement (réponse Stripe inattendue).' }
    return { clientSecret }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Erreur Stripe.' }
  }
}
