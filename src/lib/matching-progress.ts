// Suivi, sur le Matching IA d'une offre, des notations qui tournent sur le serveur après la réponse d'une action
// (`after()`, dans les 300 s de la page) : renotation sur les nouveaux libellés de l'offre, jugement de mes libellés.
// Le navigateur ne sait pas quand elles finissent : il relit la liste et marque les lignes qui les attendent jusqu'à
// l'échéance (BACKGROUND_SCORING_MS, la durée maximale de la requête), ou plus tôt quand il n'en reste plus. Le jugement
// de mes libellés écrit un candidat après l'autre : sans progrès pendant STALL_MS, son passage (40 candidats au plus)
// est fini et les lignes restantes attendent « Noter la suite ». La renotation de la base écrit tous ses scores à la
// fin : seule l'échéance l'arrête. Pur, testé (matching-progress.test.ts) ; l'heure est passée par l'appelant.

/** Durée maximale d'une notation en arrière-plan : `maxDuration` de la page du Matching IA. */
export const BACKGROUND_SCORING_MS = 5 * 60_000
/** Sans ligne notée pendant cette durée, un jugement un candidat après l'autre est fini. */
export const STALL_MS = 60_000
/** Relecture de la liste pendant le suivi. */
export const POLL_MS = 10_000

export interface ScoringWatch {
  /** Fin du suivi (millisecondes depuis 1970). */
  until: number
  /** Lignes en attente au dernier progrès, et son heure. */
  left: number
  at: number
  /** S'arrête aussi sans progrès pendant STALL_MS (jugement un candidat après l'autre). */
  stall: boolean
}

/** Suivi d'une notation lancée à `now` ; le nombre de lignes en attente n'est connu qu'à la première relecture. */
export const startWatch = (now: number, stall: boolean): ScoringWatch =>
  ({ until: now + BACKGROUND_SCORING_MS, left: Number.POSITIVE_INFINITY, at: now, stall })

/** Suivi après une relecture de la liste (`left` : lignes encore en attente) ; null quand il s'arrête. */
export function nextWatch(watch: ScoringWatch | null, left: number, now: number): ScoringWatch | null {
  if (!watch || left === 0 || now >= watch.until) return null
  if (left < watch.left) return { ...watch, left, at: now }
  return watch.stall && now - watch.at >= STALL_MS ? null : watch
}
