import { canUseAoSourcing } from '@/lib/ao/tenancy'
import { STANDARD_DAILY_QUOTAS } from '@/lib/plans'

// Accès à MBC Search (ADR 0018) et quotas du jour. Règles pures, testées dans rules.test.ts.

/** Recherches et analyses de brief par jour (UTC) : par organisation, et pour toutes les organisations ensemble. */
// `perOrganisation` : quota des formules standard (plans.ts) ; une offre sur mesure peut le changer (Entitlements.dailyQuotas).
export const MBC_SEARCH_DAILY_LIMITS = { perOrganisation: STANDARD_DAILY_QUOTAS.mbcSearch, allOrganisations: 600 } as const

export const MBC_SEARCH_QUOTA_MESSAGE = {
  organisation: (limit: number) => `Limite de ${limit} recherches MBC Search par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de recherches MBC Search aujourd\'hui sur la plateforme : réessayez demain.',
} as const

/**
 * Qui peut lancer une recherche : comme « Trouver des candidats » des AO (l'IA et Apollo sont aux frais de la
 * plateforme, l'inscription est libre) : abonnement actif (essai compris) et adresse e-mail vérifiée.
 */
export function mbcSearchDenial(requester: { tenantId: string; subscriptionStatus: string | null | undefined; emailVerified: boolean }): string | null {
  if (!canUseAoSourcing(requester.tenantId, requester.subscriptionStatus)) {
    return 'MBC Search est réservé aux organisations dont l\'abonnement est actif (période d\'essai comprise).'
  }
  if (!requester.emailVerified) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour lancer une recherche.'
  return null
}

/**
 * Profils révélés par jour (UTC) : chaque profil trouvé coûte au moins un crédit Apollo à la plateforme (nom, e-mail
 * professionnel). Par organisation, et pour toutes ensemble.
 */
export const MBC_REVEAL_DAILY_LIMITS = { perOrganisation: STANDARD_DAILY_QUOTAS.mbcReveal, allOrganisations: 1000 } as const

export const MBC_REVEAL_QUOTA_MESSAGE = {
  organisation: (limit: number) => `Limite de ${limit} profils complets par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de profils complets demandés aujourd\'hui sur la plateforme : réessayez demain.',
} as const
