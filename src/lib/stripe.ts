import Stripe from 'stripe'
import type { StripePlanId } from '@/lib/billing'

// Client Stripe côté serveur — jamais importé depuis un composant client. Construit à la demande
// (pas au chargement du module) : sinon, tant que STRIPE_SECRET_KEY n'est pas configurée sur
// l'hébergement, Stripe lève une erreur dès l'import du module et fait planter tout le build.
// 20 s au plus par appel, une nouvelle tentative sur erreur réseau (le SDK y ajoute une clé d'idempotence : rejouer une
// création ne la double pas).
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { timeout: 20_000, maxNetworkRetries: 1 })
  return _stripe
}

export const PLAN_NAME: Record<StripePlanId, string> = {
  essentiel: 'MyBestConsultant — Essentiel',
  pro: 'MyBestConsultant — Pro',
  custom: 'MyBestConsultant — Sur mesure',
}

// ID fixe : un Product Stripe par plan, créé une seule fois puis réutilisé (price_data.product_data
// n'est pas accepté par subscriptions.create — il faut un Product existant, voir Stripe doc).
const PLAN_PRODUCT_ID: Record<StripePlanId, string> = {
  essentiel: 'mbc-plan-essentiel',
  pro: 'mbc-plan-pro',
  custom: 'mbc-plan-custom',
}

/**
 * Pour les journaux : type, code et statut d'une erreur Stripe, jamais son message (il peut citer une adresse e-mail,
 * « Invalid email address: … ») ; le message des autres erreurs.
 */
export function errorForLog(err: unknown): string {
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown } | null
  if (e && typeof e.type === 'string' && e.type.startsWith('Stripe')) {
    return [e.type, typeof e.code === 'string' ? e.code : '', typeof e.statusCode === 'number' ? `(${e.statusCode})` : ''].filter(Boolean).join(' ')
  }
  return err instanceof Error ? err.message : String(err)
}

/** Code HTTP d'une erreur du SDK Stripe (404 : objet introuvable). */
export function stripeStatusOf(err: unknown): number | undefined {
  return (err as { statusCode?: number } | null)?.statusCode
}

export async function ensurePlanProduct(planId: StripePlanId): Promise<string> {
  const stripe = getStripe()
  const id = PLAN_PRODUCT_ID[planId]
  try {
    await stripe.products.retrieve(id)
  } catch (err) {
    // Seul « introuvable » crée le produit ; une panne remonte (avant : toute erreur tentait une création).
    if (stripeStatusOf(err) !== 404) throw err
    await stripe.products.create({ id, name: PLAN_NAME[planId] })
  }
  return id
}
