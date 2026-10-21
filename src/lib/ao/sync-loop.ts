import type { AoSyncReport } from './sync'

// Bouton « Synchroniser maintenant » : la page enchaîne de petits passages jusqu'à ce que la boîte soit lue, et le
// tableau se met à jour après chacun. Règle pure (testée) : après un passage, continuer, attendre ou s'arrêter.

export type BatchDecision =
  | { action: 'continue' }
  /** Une autre synchronisation (passage planifié) tient la boîte : réessayer un peu plus tard. */
  | { action: 'wait' }
  | { action: 'stop'; reason: 'done' | 'not-configured' | 'ai' | 'mailbox' | 'stalled' }

export function afterBatch(r: Pick<AoSyncReport, 'configured' | 'skipped' | 'mailboxes' | 'failedMailboxes' | 'processed' | 'failed' | 'remaining' | 'aiUnavailable'>): BatchDecision {
  if (!r.configured) return { action: 'stop', reason: 'not-configured' }
  if (r.skipped) return { action: 'wait' }
  // IA indisponible (crédits, clé) ou boîte illisible (mot de passe, serveur) : chaque nouveau passage échouerait pareil.
  if (r.aiUnavailable) return { action: 'stop', reason: 'ai' }
  if (r.failedMailboxes > 0 && r.failedMailboxes === r.mailboxes) return { action: 'stop', reason: 'mailbox' }
  if (r.remaining === 0) return { action: 'stop', reason: 'done' }
  // Des e-mails restent mais aucun n'a été pris : continuer bouclerait sans fin.
  if (r.processed + r.failed === 0) return { action: 'stop', reason: 'stalled' }
  return { action: 'continue' }
}
