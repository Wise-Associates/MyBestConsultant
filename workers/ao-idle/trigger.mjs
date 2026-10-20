// Déclencheur : transforme les signaux du veilleur (nouveau message, connexion, contrôle périodique) en
// appels de synchronisation, jamais deux à la fois.
// - Regroupement : une rafale de messages donne un seul appel, DEBOUNCE_MS après la première demande.
// - Demande pendant un appel : un nouvel appel suit, car le passage en cours a pu lister la boîte avant
//   l'arrivée du message.
// - Synchronisation déjà en cours ailleurs (bouton admin, cron : `skipped`) : nouvel essai après BUSY_RETRY_MS,
//   car ce passage-là a pu commencer avant l'arrivée du message.
// - Courrier restant (`remaining > 0` : limite de nombre ou de temps du passage) : suite après BACKLOG_RETRY_MS.
// - Échec (site injoignable, erreur 5xx…) : nouvel essai après 1, 2 puis 5 min ; les demandes reçues
//   entre-temps attendent cet essai, pour ne pas solliciter sans cesse un site en panne.
// Pur : le temps et les minuteries sont fournis par l'appelant (tests dans worker.test.mjs).

export const DEBOUNCE_MS = 5_000
export const BUSY_RETRY_MS = 60_000
export const BACKLOG_RETRY_MS = 30_000
export const ERROR_RETRY_MS = [60_000, 120_000, 300_000]

/**
 * @param {object} deps
 * @param {() => Promise<{ skipped: boolean, remaining: number }>} deps.call  un passage de synchronisation
 * @param {(fn: () => void, ms: number) => () => void} deps.schedule  exécute `fn` après `ms`, renvoie l'annulation
 * @param {() => number} deps.now  horloge en millisecondes
 * @param {(line: string) => void} deps.logError
 */
export function createSyncTrigger({ call, schedule, now, logError }) {
  /** Prochain appel prévu. */
  let planned = null
  let running = false
  let requestedWhileRunning = false
  let failures = 0
  let stopped = false

  /** Prévoit un appel dans `ms`, sauf si un appel est déjà prévu plus tôt. */
  function planIn(ms) {
    if (stopped) return
    const at = now() + ms
    if (planned && planned.at <= at) return
    planned?.cancel()
    planned = { at, cancel: schedule(() => { planned = null; void run() }, ms) }
  }

  async function run() {
    if (stopped) return
    running = true
    requestedWhileRunning = false
    let report
    try {
      report = await call()
    } catch (err) {
      const wait = ERROR_RETRY_MS[Math.min(failures, ERROR_RETRY_MS.length - 1)]
      failures += 1
      logError(`synchronisation échouée : ${err instanceof Error ? err.message : String(err)} — nouvel essai dans ${wait / 60_000} min`)
      planIn(wait)
      return
    } finally {
      running = false
    }
    failures = 0
    if (report.skipped) planIn(BUSY_RETRY_MS)
    if (report.remaining > 0) planIn(BACKLOG_RETRY_MS)
    if (requestedWhileRunning) planIn(DEBOUNCE_MS)
  }

  return {
    /** Demande une synchronisation (nouveau message, connexion, contrôle périodique). */
    request() {
      if (stopped) return
      if (running) { requestedWhileRunning = true; return }
      if (failures > 0 && planned) return
      planIn(DEBOUNCE_MS)
    },
    /** Annule l'appel prévu ; un appel en cours se termine côté site, sous son propre verrou. */
    stop() {
      stopped = true
      planned?.cancel()
      planned = null
    },
  }
}
