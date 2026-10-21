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
 * Relance demandée par un admin (bouton « Réessayer » de /admin/ao-offers) : tout e-mail en erreur, même
 * abandonné ou enregistré avant une règle plus souple, repart de zéro (un essai et une reprise) à la prochaine
 * synchronisation. null s'il n'est pas en erreur (traité entre-temps, ou en cours dans un passage).
 */
export function manualRetryPatch(email: Pick<AoEmail, 'status'>): Pick<AoEmail, 'attempts'> | null {
  return email.status === 'failed' ? { attempts: 0 } : null
}
