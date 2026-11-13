import { PLAN_PRICE_CENTS, type PaidPlanId } from './plans'

// Formules présentées sur la page publique /abonnement et sur la page « Abonnement » de l'espace recruteur (ADR 0034,
// étape 3) : textes des cartes. Les prix viennent de plans.ts (ceux que Stripe facture), jamais écrits ici.

export interface PlanCard {
  /** `essai` : la formule de départ (enregistrée `free`), présentée sur la page publique seulement. */
  id: 'essai' | PaidPlanId
  name: string
  tagline: string
  priceLabel: string
  period: string
  /** Bouton de la page publique. */
  cta: string
  highlight: boolean
  features: string[]
}

const euros = (planId: PaidPlanId) => `${PLAN_PRICE_CENTS[planId] / 100} €`

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'essai',
    name: 'Essai',
    tagline: 'Découvrez la plateforme sans risque',
    priceLabel: 'Gratuit',
    period: 'pendant 6 mois',
    cta: 'Démarrer mon essai',
    highlight: false,
    features: [
      'Accès complet à la plateforme pendant 6 mois',
      'Sans engagement',
      'Aucune carte bancaire requise',
    ],
  },
  {
    id: 'essentiel',
    name: 'Essentiel',
    tagline: 'Pour recruter efficacement',
    priceLabel: euros('essentiel'),
    period: 'par mois',
    cta: 'Choisir Essentiel',
    highlight: true,
    features: [
      'Jusqu\'à 3 annonces actives simultanément',
      'Matching automatique des candidats par IA',
      'Screening CV par intelligence artificielle',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Le recrutement piloté par l\'IA, de bout en bout',
    priceLabel: euros('pro'),
    period: 'par mois',
    cta: 'Choisir Pro',
    highlight: false,
    features: [
      'Jusqu\'à 5 annonces actives simultanément',
      'Recrutement complet piloté par IA (screening + entretien virtuel)',
      'Sélection automatique des meilleurs profils',
    ],
  },
]

/** Formules payées par carte, dans l'ordre des cartes. */
export const PAID_PLAN_CARDS = PLAN_CARDS.filter((card): card is PlanCard & { id: PaidPlanId } => card.id !== 'essai')

/** Offre sur mesure : préparée par l'équipe (devis), acceptée depuis la page « Abonnement » de l'organisation. */
export const CUSTOM_PLAN_CARD = {
  name: 'Sur mesure',
  tagline: 'Pour les équipes et les volumes importants',
  priceLabel: 'Sur devis',
  period: 'au mois ou à l\'année',
  features: [
    'Utilisateurs, annonces actives et quotas d\'IA adaptés à votre activité',
    'Fonctions choisies pour votre organisation',
    'Paiement par carte ou sur facture (virement)',
  ],
} as const

/** Lien « Demander un devis » : page de contact, sujet prérempli. */
export const QUOTE_REQUEST_HREF = '/contact?sujet=devis'

/** « Essentiel — 99 €/mois » : titre de la fenêtre de paiement par carte. */
export function checkoutLabel(planId: PaidPlanId): string {
  const card = PAID_PLAN_CARDS.find(c => c.id === planId)
  return `${card?.name ?? planId} — ${PLAN_PRICE_CENTS[planId] / 100} €/mois`
}
