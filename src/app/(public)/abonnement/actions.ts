'use server'

import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import { checkoutStep, isAdminHold } from '@/lib/billing'
import { PLAN_PRICE_CENTS, type PaidPlanId } from '@/lib/plans'
import { ensurePlanProduct, errorForLog, getStripe } from '@/lib/stripe'
import { ensureStripeCustomer, firstPaymentSecret, recordedSubscription, replaceUnpaidSubscription } from '@/lib/stripe-subscription'
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
    const customerId = await ensureStripeCustomer(tenant, user)
    const current = await recordedSubscription(tenant)
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
      // Offre sur mesure réglée sur facture : passer à une formule payée par carte demande une carte, que Stripe n'a pas.
      if (current.collection_method === 'send_invoice') {
        return { error: 'Votre abonnement est réglé sur facture : contactez-nous pour changer de formule.' }
      }
      const item = current.items.data[0]
      if (!item) throw new Error(`abonnement ${current.id} sans ligne de prix`)
      await stripe.subscriptions.update(current.id, { items: [{ id: item.id, price_data: price }], proration_behavior: 'create_prorations', metadata })
      // Stripe a accepté le changement : la formule affichée change tout de suite. Si cette écriture échoue, le changement
      // est fait quand même, et le webhook (customer.subscription.updated) écrit les mêmes valeurs.
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { plan: wanted, subscriptionPeriod: 'monthly', subscriptionAmount: Math.round(PLAN_PRICE_CENTS[wanted] / 100) })
        .catch(err => console.error('[abonnement] formule changée chez Stripe, organisation pas encore à jour', tenantId, err instanceof Error ? err.message : String(err)))
      return { changed: true }
    }

    if (step.step === 'replace' && current) await replaceUnpaidSubscription(tenantId, current)

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
    }, { idempotencyKey: `mbc-subscription-${tenantId}-${wanted}-${current?.id ?? 'none'}-${minute}` })

    await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, { stripeSubscriptionId: subscription.id })
    return { clientSecret: firstPaymentSecret(subscription) }
  } catch (err) {
    // Détail dans les journaux (sans données personnelles), message générique au navigateur.
    console.error('[abonnement] paiement non préparé', tenantId, errorForLog(err))
    return { error: UNAVAILABLE }
  }
}
