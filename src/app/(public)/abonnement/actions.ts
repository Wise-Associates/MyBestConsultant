'use server'

import type Stripe from 'stripe'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { checkoutStep, isAdminHold } from '@/lib/billing'
import { PLAN_PRICE_CENTS, type PaidPlanId } from '@/lib/plans'
import { ensurePlanProduct, getStripe, stripeStatusOf } from '@/lib/stripe'
import { canManageTeam, roleOf } from '@/lib/team-roles'

const PAID_PLANS = new Set<string>(['essentiel', 'pro'])
const UNAVAILABLE = 'Paiement impossible à préparer pour le moment : réessayez dans quelques instants.'

/**
 * Formule payante choisie par le propriétaire ou un administrateur de l'organisation (ADR 0033, 0034), selon son
 * abonnement Stripe en cours (règles : src/lib/billing.ts) :
 * - aucun : un abonnement est ouvert et `clientSecret` sert au formulaire de carte (Stripe Elements). Il ne devient
 *   « actif » qu'au paiement, confirmé par le webhook Stripe (/api/stripe/webhook), jamais par le navigateur ;
 * - ouvert mais jamais payé : il est annulé puis remplacé ;
 * - en cours : sa formule change (`changed`), au prorata sur la facture suivante, sans second abonnement.
 */
export async function startSubscriptionCheckout(planId: unknown): Promise<{ clientSecret?: string; changed?: boolean; error?: string }> {
  if (typeof planId !== 'string' || !PAID_PLANS.has(planId)) return { error: 'Formule inconnue.' }
  const wanted = planId as PaidPlanId
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Connectez-vous avec un compte recruteur pour vous abonner.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Paiement non configuré (clé Stripe manquante).' }
  const tenantId = user.tenantId

  try {
    const { databases } = createAdminClient()
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    // Choisir la formule de l'organisation : propriétaire et administrateurs (ADR 0033), comme la page « Abonnement ».
    if (!canManageTeam(roleOf(user.userId, tenant as unknown as Record<string, unknown>))) {
      return { error: 'Seuls le propriétaire et les administrateurs de votre organisation peuvent choisir une formule.' }
    }
    // Suspendue ou remboursée par l'admin : un changement de formule (évènement Stripe) ne doit pas la rouvrir.
    if (isAdminHold(tenant.subscriptionStatus)) {
      return { error: 'L’abonnement de votre organisation est suspendu : contactez-nous pour le rétablir.' }
    }
    const stripe = getStripe()

    // Un seul client Stripe par organisation, réutilisé pour les abonnements suivants. Clé d'idempotence : deux demandes
    // simultanées (deux onglets) reçoivent le même client au lieu d'en créer deux.
    let customerId = typeof tenant.stripeCustomerId === 'string' && tenant.stripeCustomerId ? tenant.stripeCustomerId : ''
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email, name: tenant.name as string, metadata: { tenantId } },
        { idempotencyKey: `mbc-customer-${tenantId}` },
      )
      customerId = customer.id
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeCustomerId: customerId })
    }

    const currentId = typeof tenant.stripeSubscriptionId === 'string' && tenant.stripeSubscriptionId ? tenant.stripeSubscriptionId : null
    let current: Stripe.Subscription | null = null
    if (currentId) {
      try {
        current = await stripe.subscriptions.retrieve(currentId)
      } catch (err) {
        // Abonnement inconnu de Stripe (supprimé, autre compte Stripe) : comme s'il n'y en avait pas.
        if (stripeStatusOf(err) !== 404) throw err
      }
    }
    const step = checkoutStep(current && { status: current.status, planId: current.metadata?.planId || null }, wanted)
    if ('error' in step) return { error: step.error }

    const price = {
      currency: 'eur',
      product: await ensurePlanProduct(wanted),
      unit_amount: PLAN_PRICE_CENTS[wanted],
      recurring: { interval: 'month' as const },
    }
    const metadata = { tenantId, planId: wanted }

    if (step.step === 'update' && current) {
      const item = current.items.data[0]
      if (!item) throw new Error(`abonnement ${current.id} sans ligne de prix`)
      await stripe.subscriptions.update(current.id, { items: [{ id: item.id, price_data: price }], proration_behavior: 'create_prorations', metadata })
      // Stripe a accepté le changement : la formule affichée change tout de suite. Si cette écriture échoue, le changement
      // est fait quand même, et le webhook (customer.subscription.updated) écrit les mêmes valeurs.
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { plan: wanted, subscriptionAmount: Math.round(PLAN_PRICE_CENTS[wanted] / 100) })
        .catch(err => console.error('[abonnement] formule changée chez Stripe, organisation pas encore à jour', tenantId, err instanceof Error ? err.message : String(err)))
      return { changed: true }
    }

    if (step.step === 'replace' && current) {
      // Détaché avant l'annulation : l'évènement « abonnement supprimé » de l'ancien ne touche plus l'organisation (billing.ts).
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: null })
      try {
        await stripe.subscriptions.cancel(current.id)
      } catch (err) {
        // Pas annulé : l'organisation le retrouve, pour qu'un paiement de cet abonnement l'active encore.
        await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: current.id })
        throw err
      }
    }

    // Clé d'idempotence (organisation, formule, abonnement remplacé, minute) : deux demandes simultanées (deux onglets,
    // double rendu) ouvrent le même abonnement au lieu de deux dont un seul serait payé ; la minute évite que Stripe
    // rende, dans les 24 h où il garde la clé, un abonnement ouvert plus tôt et expiré depuis.
    const minute = Math.floor(Date.now() / 60_000)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price_data: price }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.confirmation_secret'],
      metadata,
    }, { idempotencyKey: `mbc-subscription-${tenantId}-${wanted}-${currentId ?? 'none'}-${minute}` })

    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: subscription.id })

    // Depuis la montée de version de l'API Stripe, le client_secret à confirmer côté client n'est
    // plus sous latest_invoice.payment_intent mais sous latest_invoice.confirmation_secret.
    const invoice = typeof subscription.latest_invoice === 'string' ? null : subscription.latest_invoice
    const clientSecret = invoice?.confirmation_secret?.client_secret
    if (!clientSecret) throw new Error(`abonnement ${subscription.id} sans client_secret`)
    return { clientSecret }
  } catch (err) {
    // Détail dans les journaux (sans données personnelles), message générique au navigateur.
    console.error('[abonnement] paiement non préparé', tenantId, err instanceof Error ? err.message : String(err))
    return { error: UNAVAILABLE }
  }
}
