'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/appwrite/auth'
import { createAdminClient } from '@/lib/appwrite/client'
import { DB_ID, COLLECTIONS } from '@/lib/appwrite/config'
import type Stripe from 'stripe'
import { checkoutStep, isAdminHold, isOpenSubscription } from '@/lib/billing'
import { acceptDenial, acceptedDocument } from '@/lib/plan-offers'
import { isPlanOffersConfigured, loadOffer, writeOffer } from '@/lib/plan-offers-store'
import { ensurePlanProduct, errorForLog, getStripe } from '@/lib/stripe'
import {
  ensureStripeCustomer, firstPaymentSecret, openCustomSubscription, recordedSubscription, replaceUnpaidSubscription,
} from '@/lib/stripe-subscription'
import { canManageTeam, roleOf, teamActionDenial } from '@/lib/team-roles'

// Portail de facturation Stripe de l'organisation (/recruiter/abonnement, ADR 0033) : factures, moyen de paiement,
// résiliation. Réservé au propriétaire ; le client Stripe est celui de l'organisation de la session, jamais un
// identifiant venu du navigateur, et l'adresse de retour est fixe.

const PORTAL_TIMEOUT_MS = 15_000

export async function openBillingPortalAction(): Promise<{ url?: string; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  let tenant: Record<string, unknown>
  try {
    const { databases } = createAdminClient()
    tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, user.tenantId) as unknown as Record<string, unknown>
  } catch (err) {
    console.error('[abonnement] organisation illisible', err instanceof Error ? err.message : String(err))
    return { error: 'Abonnement illisible pour le moment : réessayez dans quelques instants.' }
  }
  const denied = teamActionDenial(roleOf(user.userId, tenant), 'billing')
  if (denied) return { error: denied }
  const customer = typeof tenant.stripeCustomerId === 'string' ? tenant.stripeCustomerId : ''
  if (!customer) return { error: 'Aucun paiement par carte pour votre organisation : contactez le support pour votre facturation.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Paiement non configuré sur la plateforme : contactez le support.' }
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mybestconsultant.fr'
  try {
    const session = await getStripe().billingPortal.sessions.create(
      { customer, return_url: `${origin}/recruiter/abonnement` },
      { timeout: PORTAL_TIMEOUT_MS },
    )
    // Adresse de Stripe seulement : le navigateur y est envoyé tel quel.
    if (!session.url.startsWith('https://')) throw new Error('adresse du portail inattendue')
    return { url: session.url }
  } catch (err) {
    // Type d'erreur seulement : le message de Stripe peut citer l'identifiant du client.
    console.error('[abonnement] portail de facturation impossible', err instanceof Error ? err.name : 'inconnu')
    return { error: 'Portail de facturation indisponible pour le moment : réessayez, ou contactez le support.' }
  }
}

/**
 * Acceptation de l'offre sur mesure de l'organisation (ADR 0034, étape 2) par le propriétaire ou un administrateur. Les
 * conditions et le prix sont lus sur l'offre enregistrée par l'admin, jamais dans la demande.
 * - Sur facture : l'abonnement Stripe est ouvert (ou changé) avec une facture envoyée par Stripe ; l'accès s'ouvre tout
 *   de suite (décision du 2026-11-13), une facture impayée à l'échéance le ferme (abonnement « en retard »).
 * - Par carte : `clientSecret` pour le formulaire de carte ; l'accès s'ouvre au paiement, confirmé par le webhook. Un
 *   abonnement déjà payé par carte change de prix sans nouveau paiement (`activated`), si Stripe accepte le paiement.
 * L'offre est réécrite en entier avec les conditions facturées, qui a accepté et quand ; elle est alors figée.
 */
export async function acceptCustomOfferAction(): Promise<{ clientSecret?: string; activated?: boolean; error?: string }> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'recruiter' || !user.tenantId) return { error: 'Session expirée : rechargez la page et reconnectez-vous.' }
  if (!isPlanOffersConfigured()) return { error: 'Offres sur mesure indisponibles pour le moment : contactez le support.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Paiement non configuré sur la plateforme : contactez le support.' }
  const tenantId = user.tenantId
  const SUSPENDED = 'L’abonnement de votre organisation est suspendu : contactez-nous pour le rétablir.'
  try {
    const { databases } = createAdminClient()
    const tenant = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
    if (!canManageTeam(roleOf(user.userId, tenant as unknown as Record<string, unknown>))) {
      return { error: 'Seuls le propriétaire et les administrateurs de votre organisation peuvent accepter une offre.' }
    }
    if (isAdminHold(tenant.subscriptionStatus)) return { error: SUSPENDED }
    const now = new Date()
    const offer = await loadOffer(tenantId)
    const denial = acceptDenial(offer, tenant.plan, now)
    if (denial || !offer) return { error: denial ?? 'Aucune offre sur mesure en cours pour votre organisation.' }

    const stripe = getStripe()
    const customerId = await ensureStripeCustomer(tenant, user)
    const current = await recordedSubscription(tenant)
    const interval = offer.period === 'annual' ? 'year' as const : 'month' as const
    const price = { currency: 'eur', product: await ensurePlanProduct('custom'), unit_amount: offer.priceCents, recurring: { interval } }
    const metadata = { tenantId, planId: 'custom' }
    const billing = offer.paymentMethod === 'invoice'
      ? { collection_method: 'send_invoice' as const, days_until_due: offer.daysUntilDue }
      : { collection_method: 'charge_automatically' as const, payment_behavior: 'error_if_incomplete' as const }

    /**
     * Écritures finales, après une relecture : jamais pendant une suspension posée entre-temps par l'admin. `open` :
     * l'accès s'ouvre tout de suite (facture, ou abonnement déjà payé) ; sinon au paiement par carte (webhook).
     */
    const finish = async (sub: Stripe.Subscription, open: boolean): Promise<{ error: string } | null> => {
      const fresh = await databases.getDocument(DB_ID, COLLECTIONS.TENANTS, tenantId)
      if (isAdminHold(fresh.subscriptionStatus)) {
        console.error('[abonnement] abonnement Stripe ouvert pendant une suspension : à annuler à la main', tenantId, sub.id)
        return { error: SUSPENDED }
      }
      const latest = await loadOffer(tenantId)
      if (latest?.proposedAt !== offer.proposedAt) {
        // Appwrite n'a pas d'écriture conditionnelle : l'acceptation l'emporte, avec les conditions que Stripe facture.
        console.error('[abonnement] offre modifiée par l\'admin pendant l\'acceptation : conditions facturées enregistrées', tenantId)
      }
      await databases.updateDocument(DB_ID, COLLECTIONS.TENANTS, tenantId, open
        ? {
          plan: 'custom',
          subscriptionStatus: 'active',
          subscriptionPeriod: offer.period,
          subscriptionAmount: Math.round(offer.priceCents / 100),
          stripeSubscriptionId: sub.id,
          ...(typeof fresh.subscriptionStartedAt === 'string' && fresh.subscriptionStartedAt ? {} : { subscriptionStartedAt: now.toISOString() }),
        }
        : { stripeSubscriptionId: sub.id })
      await writeOffer(tenantId, acceptedDocument(offer, { acceptedAt: now.toISOString(), acceptedBy: user.userId, stripeSubscriptionId: sub.id }))
      revalidatePath('/recruiter/abonnement')
      return null
    }

    // Abonnement de l'offre déjà en cours chez Stripe (celui enregistré, ou un autre de ce client dont l'enregistrement a
    // échoué) : jamais un second abonnement ; son prix est remis à celui de l'offre s'il diffère, puis les écritures sont
    // refaites.
    const existing = current && current.metadata?.planId === 'custom' && isOpenSubscription(current.status)
      ? current
      : await openCustomSubscription(customerId, tenantId)
    if (existing) {
      const item = existing.items.data[0]
      if (!item) throw new Error(`abonnement ${existing.id} sans ligne de prix`)
      const samePrice = item.price.unit_amount === offer.priceCents && item.price.recurring?.interval === interval
      const sub = samePrice ? existing : await stripe.subscriptions.update(existing.id, {
        items: [{ id: item.id, price_data: price }], proration_behavior: 'create_prorations', metadata, ...billing,
      })
      return (await finish(sub, true)) ?? { activated: true }
    }

    const step = checkoutStep(current && { status: current.status, planId: current.metadata?.planId || null }, 'custom')
    if ('error' in step) return { error: step.error }

    if (step.step === 'update' && current) {
      const item = current.items.data[0]
      if (!item) throw new Error(`abonnement ${current.id} sans ligne de prix`)
      // Carte : `error_if_incomplete`, un paiement refusé laisse l'abonnement tel qu'il était (erreur ci-dessous).
      const updated = await stripe.subscriptions.update(current.id, {
        items: [{ id: item.id, price_data: price }], proration_behavior: 'create_prorations', metadata, ...billing,
      })
      if (!isOpenSubscription(updated.status)) {
        console.error('[abonnement] offre sur mesure : abonnement non en cours après changement', tenantId, updated.id, updated.status)
        return { error: 'Le paiement de l’offre n’a pas abouti : vérifiez votre moyen de paiement (« Factures et moyen de paiement »).' }
      }
      return (await finish(updated, true)) ?? { activated: true }
    }

    if (step.step === 'replace' && current) await replaceUnpaidSubscription(tenantId, current)

    if (offer.paymentMethod === 'invoice') {
      // Clé liée à l'offre : une nouvelle tentative (écriture échouée, deux onglets) rend le même abonnement pendant les
      // 24 h où Stripe garde la clé ; au-delà, openCustomSubscription le retrouve.
      const created = await stripe.subscriptions.create(
        { customer: customerId, items: [{ price_data: price }], metadata, ...billing },
        { idempotencyKey: `mbc-offer-${tenantId}-${Date.parse(offer.proposedAt)}-${current?.id ?? 'none'}` },
      )
      return (await finish(created, true)) ?? { activated: true }
    }

    // Carte : clé à la minute, comme le choix d'une formule (un premier paiement abandonné expire en 23 h, sans frais).
    const created = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price_data: price }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.confirmation_secret'],
      metadata,
      collection_method: 'charge_automatically',
    }, { idempotencyKey: `mbc-subscription-${tenantId}-custom-${current?.id ?? 'none'}-${Math.floor(Date.now() / 60_000)}` })
    const refused = await finish(created, false)
    return refused ?? { clientSecret: firstPaymentSecret(created) }
  } catch (err) {
    // Type d'erreur Stripe seulement (son message peut citer une adresse e-mail), message générique au navigateur.
    console.error('[abonnement] offre sur mesure non acceptée', tenantId, errorForLog(err))
    return { error: 'Acceptation impossible pour le moment : réessayez dans quelques instants.' }
  }
}
