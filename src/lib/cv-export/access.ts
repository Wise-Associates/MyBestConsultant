// Qui peut générer un export « Format ESN » depuis la CV Thèque des recruteurs, et y déposer le modèle de son
// organisation (ADR 0010). L'IA est aux frais de la plateforme et l'inscription est libre : génération réservée aux
// organisations abonnées, à l'adresse e-mail vérifiée, dans un quota quotidien. Retélécharger une version enregistrée ne
// coûte rien et reste permis. Règles pures, testées dans access.test.ts.

/** Générations par jour (UTC) : par organisation, et pour toutes les organisations ensemble (l'admin n'est pas compté). */
export const CV_EXPORT_DAILY_LIMITS = { perOrganisation: 20, allOrganisations: 300 } as const

// Même règle que canUseAoSourcing (src/lib/ao/tenancy.ts, décision du 2026-10-21) : tout abonnement actif, essai compris.
const ENTITLED_STATUSES = new Set(['active', 'trialing'])

export interface GenerationRequester {
  tenantId: string | null | undefined
  subscriptionStatus: string | null | undefined
  emailVerified: boolean
}

/** Raison du refus (message pour le recruteur) ; null : génération permise, sous réserve du quota du jour. */
export function generationDenial(requester: GenerationRequester): string | null {
  if (!requester.tenantId) return 'Votre compte n\'est rattaché à aucune organisation : la génération n\'est pas possible.'
  if (!ENTITLED_STATUSES.has(requester.subscriptionStatus ?? '')) {
    return 'La génération par l\'IA est réservée aux organisations dont l\'abonnement est actif (période d\'essai comprise). Les versions déjà enregistrées restent téléchargeables.'
  }
  if (!requester.emailVerified) return 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour générer un export.'
  return null
}

/**
 * Dépôts et aperçus de modèle par jour (UTC) et par organisation : chacun rend le modèle deux fois (français et anglais),
 * jusqu'à environ 2 s pour un modèle aux bornes de render.ts. Tout recruteur de l'organisation peut déposer, à l'adresse
 * e-mail vérifiée (inscription libre).
 */
export const CV_TEMPLATE_DAILY_LIMITS = { uploads: 20, previews: 30 } as const

export const TEMPLATE_MESSAGE = {
  emailNotVerified: 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour déposer le modèle de votre organisation.',
  uploadQuota: `Limite de ${CV_TEMPLATE_DAILY_LIMITS.uploads} dépôts de modèle par jour atteinte pour votre organisation : réessayez demain.`,
  previewQuota: `Limite de ${CV_TEMPLATE_DAILY_LIMITS.previews} aperçus du modèle par jour atteinte pour votre organisation : réessayez demain.`,
} as const

/** Raison du refus de déposer le modèle de l'organisation ; null : permis, sous réserve du quota du jour. */
export function templateUploadDenial(requester: { emailVerified: boolean }): string | null {
  return requester.emailVerified ? null : TEMPLATE_MESSAGE.emailNotVerified
}

export const QUOTA_MESSAGE = {
  organisation: `Limite de ${CV_EXPORT_DAILY_LIMITS.perOrganisation} générations par jour atteinte pour votre organisation : réessayez demain, ou téléchargez une version déjà enregistrée.`,
  platform: 'Trop de générations aujourd\'hui sur la plateforme : réessayez demain, ou téléchargez une version déjà enregistrée.',
} as const
