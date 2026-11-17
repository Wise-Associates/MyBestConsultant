// Rafales de MBC Search (revue de sécurité du 2026-11-16, ADR 0037) : le quota du jour (300 par organisation) ne
// limite pas le débit. La page envoie ses requêtes l'une après l'autre, mais un recruteur pourrait appeler les Server
// Actions toutes à la fois : les demandes à Apollo (clé de la plateforme, ~200 par minute) et à l'IA de notation
// seraient refusées pour toutes les organisations. Pur, testé (burst.test.ts) ; l'heure est injectée.

/** Appels permis par recruteur dans une fenêtre glissante : un recruteur pressé en fait une quinzaine par minute. */
export const BURST_LIMIT = { calls: 20, windowMs: 60_000 } as const

/** Au-delà, le journal est vidé plutôt que de grossir sans fin (quelques limites remises à zéro : sans conséquence). */
const MAX_KEYS = 10_000

/**
 * Prend une place pour `key` à `nowMs` si moins de `limit` appels ont eu lieu dans la fenêtre ; `log` garde les heures
 * des appels récents (un par processus serveur : en production, un seul sur le VPS, ADR 0027).
 */
export function takeBurstSlot(log: Map<string, number[]>, key: string, nowMs: number, limit: number = BURST_LIMIT.calls, windowMs: number = BURST_LIMIT.windowMs): boolean {
  if (log.size > MAX_KEYS) log.clear()
  const recent = (log.get(key) ?? []).filter(t => nowMs - t < windowMs)
  if (recent.length >= limit) {
    log.set(key, recent)
    return false
  }
  log.set(key, [...recent, nowMs])
  return true
}
