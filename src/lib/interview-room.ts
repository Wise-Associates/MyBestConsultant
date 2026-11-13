// Salle d'entretien du candidat (/interview/<session>) : le candidat n'a pas de session, l'identifiant de l'entretien
// (reçu dans son invitation) sert de clé. Revue de sécurité du 2026-11-13 : ses actions appelaient l'IA et la synthèse
// vocale sans rien vérifier (une passerelle gratuite vers l'IA de la plateforme) et relançaient l'analyse et les e-mails
// de fin à chaque appel. Règles pures, testées dans interview-room.test.ts ; appliquées par src/lib/interview-room-access.ts.

export const ROOM_LIMITS = { answer: 8000, speech: 2000, report: 500 } as const

/** Délai après la fin de l'entretien pendant lequel l'enregistrement peut encore être joint (envoi d'un fichier lourd). */
export const ROOM_AFTER_COMPLETION_MS = 2 * 3600_000

/**
 * La salle accepte l'action : `live` (IA, voix, progression) seulement pendant l'entretien (en attente ou en cours) ;
 * `after` (joindre l'enregistrement, signaler une panne) aussi dans les 2 h qui suivent la fin.
 */
export function roomAccepts(session: { status?: unknown; completedAt?: unknown }, use: 'live' | 'after', now: Date): boolean {
  if (session.status === 'pending' || session.status === 'in_progress') return true
  if (use === 'live' || (session.status !== 'completed' && session.status !== 'analysed')) return false
  const completedAt = typeof session.completedAt === 'string' ? Date.parse(session.completedAt) : NaN
  return Number.isFinite(completedAt) && now.getTime() - completedAt <= ROOM_AFTER_COMPLETION_MS
}

/**
 * Appels de la salle par jour pour une session (IA, voix, progression, signalements) : 6 par question et 20 de marge,
 * de quoi poser chaque question, sa relance, les lire à voix haute et enregistrer chaque réponse.
 */
export function roomCallCap(questionsJson: unknown): number {
  let count = 0
  try {
    const parsed = JSON.parse(typeof questionsJson === 'string' ? questionsJson : '[]')
    count = Array.isArray(parsed) ? Math.min(parsed.length, 30) : 0
  } catch {
    count = 0 // questions illisibles : la marge seule
  }
  return 6 * count + 20
}
