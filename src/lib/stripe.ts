import Stripe from 'stripe'

// Client Stripe côté serveur — jamais importé depuis un composant client. Construit à la demande
// (pas au chargement du module) : sinon, tant que STRIPE_SECRET_KEY n'est pas configurée sur
// l'hébergement, Stripe lève une erreur dès l'import du module et fait planter tout le build.
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')
  return _stripe
}

export type PaidPlanId = 'essentiel' | 'pro'

// Montants en centimes (EUR) — doivent rester cohérents avec l'affichage de /abonnement.
export const PLAN_PRICE_CENTS: Record<PaidPlanId, number> = {
  essentiel: 9900,
  pro: 19900,
}

export const PLAN_NAME: Record<PaidPlanId, string> = {
  essentiel: 'MyBestConsultant — Essentiel',
  pro: 'MyBestConsultant — Pro',
}

// ID fixe : un Product Stripe par plan, créé une seule fois puis réutilisé (price_data.product_data
// n'est pas accepté par subscriptions.create — il faut un Product existant, voir Stripe doc).
const PLAN_PRODUCT_ID: Record<PaidPlanId, string> = {
  essentiel: 'mbc-plan-essentiel',
  pro: 'mbc-plan-pro',
}

export async function ensurePlanProduct(planId: PaidPlanId): Promise<string> {
  const stripe = getStripe()
  const id = PLAN_PRODUCT_ID[planId]
  try {
    await stripe.products.retrieve(id)
  } catch {
    await stripe.products.create({ id, name: PLAN_NAME[planId] })
  }
  return id
}
