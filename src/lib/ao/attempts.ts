import type { AoEmail } from './types'

// Règle des essais d'un e-mail AO, partagée par le traitement (sync.ts, repo.ts) et la page admin.
// Pure (ni base ni IMAP) : importable côté client, testée dans ao.test.ts.

/** Essais d'un e-mail en erreur : le premier passage, plus une seule reprise au passage suivant. */
export const MAX_ATTEMPTS = 2

/**
 * Essais comptés après un échec, à partir de ceux déjà comptés pour ce passage.
 * - `final` (message trop volumineux, réponse de l'IA tronquée) : réessayer ne changerait rien, plus de reprise.
 * - `countsAsAttempt` false (manque de temps dans le passage, IA en attente de crédits : `RetryLater`) :
 *   l'e-mail n'y est pour rien, l'essai lui est rendu ; il est repris au passage suivant, sans limite tant que
 *   la cause dure, et garde sa reprise pour une vraie erreur.
 */
export function attemptsAfterFailure(attempts: number, { final, countsAsAttempt }: { final: boolean; countsAsAttempt: boolean }): number {
  if (final) return MAX_ATTEMPTS
  return countsAsAttempt ? attempts : attempts - 1
}

/**
 * Relance demandée depuis le tableau (bouton « Réessayer », admin ou recruteur) : tout e-mail en erreur, même
 * abandonné ou enregistré avant une règle plus souple, repart de zéro (un essai et une reprise), autant de fois qu'on
 * le relance. null s'il n'est pas en erreur (traité entre-temps, ou en cours dans un passage).
 */
export function manualRetryPatch(email: Pick<AoEmail, 'status'>): Pick<AoEmail, 'attempts'> | null {
  return email.status === 'failed' ? { attempts: 0 } : null
}

/**
 * « Réessayer » des recruteurs, par jour (UTC) : par organisation, et pour toutes les organisations ensemble (l'admin
 * n'est pas compté). Chaque relance peut refaire appeler l'IA aux frais de la plateforme et l'inscription est libre :
 * sans plafond, un même e-mail pourrait être refacturé sans fin (ADR 0002). Décision du 2026-10-26 : plus de limite par
 * e-mail, ce plafond quotidien à la place.
 */
export const AO_RETRY_DAILY_LIMITS = { perOrganisation: 30, allOrganisations: 300 } as const

export const RETRY_QUOTA_MESSAGE = {
  organisation: `Limite de ${AO_RETRY_DAILY_LIMITS.perOrganisation} relances d'e-mails par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de relances d\'e-mails aujourd\'hui sur la plateforme : réessayez demain.',
} as const

/**
 * Un e-mail peut-il être reporté au passage suivant faute de temps ? Les e-mails suivants d'une boîte, oui ; le premier
 * seulement si la boîte n'a plus le temps nécessaire (`fullTimeMs`) : avec ce temps, il est traité quoi qu'il arrive,
 * ce qui garantit que la boîte avance ; sans lui, le traiter coûterait ses pièces jointes scannées ou un essai.
 */
export function canDeferEmail(handledInMailbox: number, timeLeftMs: number, fullTimeMs: number): boolean {
  return handledInMailbox > 0 || timeLeftMs < fullTimeMs
}
