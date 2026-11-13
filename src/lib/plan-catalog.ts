import { PLAN_PRICE_CENTS, type PaidPlanId } from './plans'

// Formules présentées sur la page publique /abonnement (maquettes du 2026-11-13, bureau et mobile) et sur la page
// « Abonnement » de l'espace recruteur : textes des cartes, tableau de comparaison, questions fréquentes. Les prix viennent
// de plans.ts (ceux que Stripe facture, TTC), jamais écrits ici.

export interface PlanCard {
  /** `essai` : la formule de départ (enregistrée `free`), présentée sur la page publique seulement. */
  id: 'essai' | PaidPlanId
  name: string
  tagline: string
  /** Prix (« 99 € », « Gratuit ») et unité à côté (« / mois »). */
  priceLabel: string
  unit: string
  /** Ligne sous le prix (« Sans engagement », « pendant 6 mois »). */
  note: string
  /** Bouton de la page publique (visiteur). */
  cta: string
  /** Carte mise en avant (« Le plus choisi »). */
  highlight: boolean
  /** Phrase avant la liste (« Tout Essentiel, et : »). */
  featuresIntro?: string
  features: string[]
}

const euros = (planId: PaidPlanId) => `${PLAN_PRICE_CENTS[planId] / 100} €`

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'essai',
    name: 'Essai',
    tagline: 'Découvrez la plateforme sans risque',
    priceLabel: 'Gratuit',
    unit: '',
    note: 'pendant 6 mois',
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
    unit: '/ mois',
    note: 'Sans engagement',
    cta: 'Choisir Essentiel',
    highlight: true,
    features: [
      'Jusqu’à 3 annonces actives simultanément',
      'Matching automatique des candidats par IA',
      'Screening CV par intelligence artificielle',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Le recrutement piloté par l’IA, de bout en bout',
    priceLabel: euros('pro'),
    unit: '/ mois',
    note: 'Sans engagement',
    cta: 'Choisir Pro',
    highlight: false,
    featuresIntro: 'Tout Essentiel, et :',
    features: [
      'Jusqu’à 5 annonces actives simultanément',
      'Recrutement complet piloté par IA : screening et entretien virtuel',
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
  note: 'Facturation mensuelle ou annuelle',
  features: [
    'Utilisateurs, annonces actives et quotas d’IA adaptés à votre activité',
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

// ── Comparer les formules ────────────────────────────────────────────────────

/** Case du tableau : comprise, non comprise, ou un texte (« 3 », « Au choix »). */
export type ComparisonCell = true | false | string

export const COMPARISON_COLUMNS = [
  { id: 'essai', name: 'Essai', sub: 'Gratuit, 6 mois', highlight: false },
  { id: 'essentiel', name: 'Essentiel', sub: `${euros('essentiel')} / mois`, highlight: true },
  { id: 'pro', name: 'Pro', sub: `${euros('pro')} / mois`, highlight: false },
  { id: 'custom', name: 'Sur mesure', sub: 'Sur devis', highlight: false },
] as const

/** Une ligne par fonction, une case par colonne (dans l'ordre de COMPARISON_COLUMNS). */
export const COMPARISON_ROWS: { label: string; cells: [ComparisonCell, ComparisonCell, ComparisonCell, ComparisonCell] }[] = [
  // Essai « Sans limite » : décision du 2026-11-13, comme aujourd'hui (aucune limite d'annonces sur les formules standard).
  { label: 'Annonces actives simultanément', cells: ['Sans limite', '3', '5', 'Selon vos besoins'] },
  { label: 'Matching automatique des candidats par IA', cells: [true, true, true, 'Au choix'] },
  { label: 'Screening CV par IA', cells: [true, true, true, 'Au choix'] },
  { label: 'Entretien virtuel par IA', cells: [true, false, true, 'Au choix'] },
  { label: 'Sélection automatique des meilleurs profils', cells: [true, false, true, 'Au choix'] },
  { label: 'Facturation', cells: ['Gratuit pendant 6 mois', 'Mensuelle', 'Mensuelle', 'Mensuelle ou annuelle'] },
  { label: 'Moyen de paiement', cells: ['Aucune carte bancaire', 'Carte bancaire', 'Carte bancaire', 'Carte ou virement'] },
]

// ── Questions fréquentes ─────────────────────────────────────────────────────

export const PRICING_FAQ: { question: string; answer: string }[] = [
  {
    question: 'Une carte bancaire est-elle demandée pour l’essai ?',
    answer: 'Non. L’essai de 6 mois ne demande aucune carte bancaire.',
  },
  {
    // Décision du 2026-11-13 : la fin de l'essai n'est pas gérée par la plateforme ; l'équipe contacte l'organisation.
    question: 'Que se passe-t-il à la fin des 6 mois d’essai ?',
    answer: 'Avant la fin de l’essai, nous vous contactons pour choisir la formule qui vous convient. Vos annonces, vos candidats et vos données restent les vôtres.',
  },
  {
    question: 'Puis-je résilier à tout moment ?',
    answer: 'Oui. Toutes les formules sont sans engagement : vous résiliez depuis « Gérer mon abonnement ».',
  },
  {
    // Changement de formule : sur l'abonnement en cours, prorata sur la facture suivante (billing.ts, ADR 0034).
    question: 'Puis-je changer de formule en cours de mois ?',
    answer: 'Oui, depuis « Gérer mon abonnement ». Le changement s’applique tout de suite ; la différence est calculée au prorata et figure sur votre prochaine facture.',
  },
  {
    question: 'Quels moyens de paiement acceptez-vous ?',
    answer: 'La carte bancaire pour Essentiel et Pro, avec un paiement sécurisé par Stripe. Pour une formule sur mesure, la carte ou le virement sur facture.',
  },
  {
    question: 'Que comprend la formule Sur mesure ?',
    answer: 'Le nombre d’utilisateurs, d’annonces actives et les quotas d’IA sont fixés avec vous selon votre activité, ainsi que les fonctions dont votre organisation a besoin.',
  },
]

/** Mention des prix (décision du 2026-11-13 : prix TTC). */
export const PRICES_NOTE = 'Prix indiqués toutes taxes comprises (TTC)'
