import { canUseAoSourcing } from './tenancy'

// Qui peut lancer « Trouver des candidats » / « Recalculer » sur une offre AO depuis l'espace recruteur (décision du
// 2026-10-25) : l'IA lit les CV de la base aux frais de la plateforme et l'inscription est libre, d'où un abonnement
// actif, l'adresse e-mail vérifiée et un quota quotidien. Lire un résultat déjà calculé ne coûte rien et reste permis.
// Règles pures, testées dans sourcing-access.test.ts.

/** Recherches par jour (UTC) : par organisation, et pour toutes les organisations ensemble (l'admin n'est pas compté). */
export const AO_SOURCING_DAILY_LIMITS = { perOrganisation: 20, allOrganisations: 300 } as const

export interface SourcingRequester {
  tenantId: string
  subscriptionStatus: string | null | undefined
  emailVerified: boolean
}

/** Raison du refus (message pour le recruteur) ; null : recherche permise, sous réserve du quota du jour. */
export function sourcingDenial(requester: SourcingRequester): string | null {
  if (!canUseAoSourcing(requester.tenantId, requester.subscriptionStatus)) {
    return 'La recherche de candidats par l\'IA est réservée aux organisations dont l\'abonnement est actif (période d\'essai comprise).'
  }
  if (!requester.emailVerified) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour lancer une recherche de candidats.'
  return null
}

export const SOURCING_QUOTA_MESSAGE = {
  organisation: `Limite de ${AO_SOURCING_DAILY_LIMITS.perOrganisation} recherches de candidats par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de recherches de candidats aujourd\'hui sur la plateforme : réessayez demain.',
} as const
