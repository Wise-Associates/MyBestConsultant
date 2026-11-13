// Formules de MyBestConsultant et droits qu'elles donnent à une organisation (ADR 0034, demande du 2026-11-13). Une
// seule liste, lue par les pages d'abonnement, l'admin, le webhook Stripe et chaque contrôle côté serveur (invitations,
// offres actives, fonctions réservées, quotas du jour). Règles pures, testées dans plans.test.ts ; aucun import, pour
// pouvoir être lues partout (serveur et navigateur).

/** Formules enregistrées dans `tenants.plan`. `free` : formule de départ de toute organisation (auth.ts). */
export type PlanId = 'free' | 'essentiel' | 'pro' | 'custom'
/** Formules payées par carte depuis la page des formules (prix fixes ci-dessous). */
export type PaidPlanId = 'essentiel' | 'pro'

/** Prix mensuels en centimes (EUR) des formules payées par carte ; la page des formules affiche les mêmes. */
export const PLAN_PRICE_CENTS: Record<PaidPlanId, number> = { essentiel: 9900, pro: 19900 }

// `gold` et `max` : anciennes formules de l'admin (/admin/subscriptions), encore lisibles sur des organisations.
const PLAN_LABEL: Record<string, string> = {
  free: 'Gratuite', essentiel: 'Essentiel', pro: 'Pro', custom: 'Sur mesure', gold: 'Gold', max: 'Max',
}

/** Nom affiché d'une formule (sa valeur brute si elle est inconnue). */
export function planLabel(plan: string): string {
  return PLAN_LABEL[plan] ?? plan
}

/** Fonctions réservées qu'une formule ouvre ou non. */
export const FEATURES = ['mbcSearch', 'aiInterviews', 'aoSourcing', 'cvExport'] as const
export type Feature = (typeof FEATURES)[number]

export const FEATURE_LABEL: Record<Feature, string> = {
  mbcSearch: 'MBC Search',
  aiInterviews: 'Entretiens IA et screening des CV',
  aoSourcing: 'Appels d\'offres',
  cvExport: 'Export « Format ESN »',
}

const NOT_INCLUDED: Record<Feature, string> = {
  mbcSearch: 'MBC Search n\'est pas compris',
  aiInterviews: 'Les entretiens IA et le screening des CV ne sont pas compris',
  aoSourcing: 'Le suivi des appels d\'offres n\'est pas compris',
  cvExport: 'L\'export « Format ESN » n\'est pas compris',
}

/** Quotas du jour (UTC) d'une organisation ; les plafonds pour toutes les organisations restent dans chaque module. */
export const DAILY_QUOTAS = ['mbcSearch', 'mbcReveal', 'cvExport', 'aoSourcing', 'aoRewrite', 'aoRetry', 'vivierMatching', 'interviewAi'] as const
export type DailyQuota = (typeof DAILY_QUOTAS)[number]

/** Nom affiché de chaque quota du jour (offre sur mesure : page Abonnement, admin). */
export const DAILY_QUOTA_LABEL: Record<DailyQuota, string> = {
  mbcSearch: 'Recherches MBC Search',
  mbcReveal: 'Profils complets MBC Search',
  cvExport: 'Exports « Format ESN »',
  aoSourcing: 'Recherches de candidats sur un AO',
  aoRewrite: 'Rédactions d\'AO par l\'IA',
  aoRetry: 'Relances d\'e-mails AO',
  vivierMatching: 'CV du vivier comparés aux offres',
  interviewAi: 'Analyses IA (entretiens et screening)',
}

export interface Entitlements {
  /** Comptes de l'organisation, invitations en attente et comptes désactivés compris. */
  maxUsers: number
  /** Offres publiées et non expirées en même temps ; null : sans limite. */
  maxActiveJobs: number | null
  features: Record<Feature, boolean>
  dailyQuotas: Record<DailyQuota, number>
}

/**
 * Quotas du jour des formules standard. Ce sont les valeurs qu'avaient toutes les organisations avant les offres sur
 * mesure ; les modules les reprennent comme `perOrganisation` (mbc-search/access.ts, cv-export/access.ts, ao/…).
 * `interviewAi` (appels à l'IA des entretiens et du screening manuel, interview-rules.ts) n'existait pas : ajouté par la
 * revue de sécurité du 2026-11-13, assez large pour un usage normal (une centaine de CV et une dizaine d'entretiens).
 */
export const STANDARD_DAILY_QUOTAS: Readonly<Record<DailyQuota, number>> = {
  mbcSearch: 60, mbcReveal: 100, cvExport: 20, aoSourcing: 20, aoRewrite: 30, aoRetry: 30, vivierMatching: 200, interviewAi: 500,
}

/**
 * Droits des formules standard (gratuite, Essentiel, Pro, anciennes formules de l'admin). Décision du 2026-11-13 :
 * ils restent ceux d'avant (aucune organisation ne perd d'accès) ; seule une offre sur mesure les change. Appliquer
 * la page des formules (3 ou 5 offres actives…) se fera ici.
 */
export const STANDARD_ENTITLEMENTS: Readonly<Entitlements> = {
  maxUsers: 15,
  maxActiveJobs: null,
  features: { mbcSearch: true, aiInterviews: true, aoSourcing: true, cvExport: true },
  dailyQuotas: STANDARD_DAILY_QUOTAS,
}

/** Droits les plus bas de `a` et de `b`, limite par limite (null : sans limite) ; une fonction est ouverte si les deux l'ouvrent. */
export function lowerOf(a: Entitlements, b: Entitlements): Entitlements {
  const lowerLimit = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.min(x, y))
  return {
    maxUsers: Math.min(a.maxUsers, b.maxUsers),
    maxActiveJobs: lowerLimit(a.maxActiveJobs, b.maxActiveJobs),
    features: Object.fromEntries(FEATURES.map(f => [f, a.features[f] && b.features[f]])) as Record<Feature, boolean>,
    dailyQuotas: Object.fromEntries(DAILY_QUOTAS.map(q => [q, Math.min(a.dailyQuotas[q], b.dailyQuotas[q])])) as Record<DailyQuota, number>,
  }
}

/** États d'abonnement payé (essai compris). */
const PAYING = new Set(['active', 'trialing'])

/**
 * Droits en vigueur pour une organisation. `customTerms` : conditions de son offre sur mesure acceptée ; elles ne
 * s'appliquent qu'à la formule « custom ». Sans elles (offre retirée), droits standard. Formule « custom » qui n'est
 * plus payée (retard, résiliation, suspension) : les plus bas de l'offre et des droits standard — ni les conditions
 * négociées sans les payer, ni plus de droits que l'offre n'en donnait (revue de sécurité du 2026-11-13).
 */
export function entitlementsOf(tenant: { plan?: unknown; subscriptionStatus?: unknown }, customTerms?: Entitlements | null): Entitlements {
  if (tenant.plan !== 'custom' || !customTerms) return STANDARD_ENTITLEMENTS
  return PAYING.has(String(tenant.subscriptionStatus)) ? customTerms : lowerOf(customTerms, STANDARD_ENTITLEMENTS)
}

/** Refus d'une fonction que la formule ne comprend pas ; null si elle la comprend. */
export function featureDenial(entitlements: Entitlements, feature: Feature): string | null {
  return entitlements.features[feature] ? null : `${NOT_INCLUDED[feature]} dans la formule de votre organisation : contactez-nous pour l'ajouter.`
}

/**
 * Refus de publier (ou réactiver) `adding` offres quand la formule limite les offres actives et que `activeJobs + adding`
 * la dépasserait ; null sinon.
 */
export function activeJobsDenial(entitlements: Entitlements, activeJobs: number, adding = 1): string | null {
  const max = entitlements.maxActiveJobs
  if (max === null || activeJobs + adding <= max) return null
  const allowed = `Votre formule permet ${max} ${max > 1 ? 'offres actives' : 'offre active'} à la fois`
  if (adding === 1) return `${allowed} : désactivez-en une pour en publier une autre.`
  return `${allowed} et vous en avez ${activeJobs} : désactivez-en ou importez-en ${Math.max(0, max - activeJobs)} au plus.`
}

/** Refus d'inviter quand l'organisation a déjà le nombre de comptes de sa formule ; null sinon. */
export function usersDenial(entitlements: Entitlements, users: number): string | null {
  return users < entitlements.maxUsers
    ? null
    : `Votre formule permet ${entitlements.maxUsers} utilisateurs (invitations en attente et comptes désactivés compris) : retirez-en un, ou contactez-nous pour en ajouter.`
}
