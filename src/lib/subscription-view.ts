// Abonnement de l'organisation tel que la page « Abonnement » de l'espace recruteur le montre (demande du 2026-11-13,
// ADR 0033). Lit les champs de `tenants` écrits par le webhook Stripe et par l'admin (/admin/subscriptions), qui
// n'emploient pas les mêmes noms de formule. Règles pures, testées dans subscription-view.test.ts.

export type SubscriptionTone = 'ok' | 'warn' | 'error' | 'muted'

export interface SubscriptionView {
  planLabel: string
  statusLabel: string
  tone: SubscriptionTone
  /** Fonctions réservées aux abonnés (IA, MBC Search, sourcing des AO) ouvertes : abonnement actif ou en essai. */
  entitled: boolean
  /** « 199 € / mois », ou null sans montant connu. */
  amountText: string | null
  /**
   * Abonnement payé par carte chez Stripe (portail de facturation utile) ; sinon réglé avec l'équipe. Le client Stripe
   * est créé dès l'ouverture du paiement, avant tout règlement : seule une formule de Stripe (écrite par le webhook
   * après un paiement réussi) le confirme.
   */
  billedByStripe: boolean
}

// Formules de la page /abonnement (Stripe) et de l'admin.
const STRIPE_PLANS = new Set(['essentiel', 'pro'])
const PLAN_LABELS: Record<string, string> = { essentiel: 'Essentiel', pro: 'Pro', free: 'Gratuite', gold: 'Gold', max: 'Max' }

const STATUS: Record<string, { label: string; tone: SubscriptionTone }> = {
  active: { label: 'Actif', tone: 'ok' },
  trialing: { label: 'Période d’essai', tone: 'ok' },
  past_due: { label: 'Paiement en retard', tone: 'warn' },
  suspended: { label: 'Suspendu', tone: 'error' },
  cancelled: { label: 'Résilié', tone: 'error' },
  refunded: { label: 'Remboursé', tone: 'muted' },
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function subscriptionView(tenant: Record<string, unknown>): SubscriptionView {
  const plan = text(tenant.plan)
  const status = text(tenant.subscriptionStatus)
  const amount = typeof tenant.subscriptionAmount === 'number' && tenant.subscriptionAmount > 0 ? tenant.subscriptionAmount : null
  const period = text(tenant.subscriptionPeriod) === 'annual' ? 'an' : 'mois'
  const known = STATUS[status]
  return {
    planLabel: plan ? PLAN_LABELS[plan] ?? plan : 'Aucune formule',
    statusLabel: known?.label ?? (status || 'Aucun abonnement'),
    tone: known?.tone ?? 'muted',
    entitled: status === 'active' || status === 'trialing',
    amountText: amount === null ? null : `${amount.toLocaleString('fr-FR')} € / ${period}`,
    billedByStripe: text(tenant.stripeCustomerId) !== '' && STRIPE_PLANS.has(plan),
  }
}
