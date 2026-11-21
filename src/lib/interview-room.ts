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
  return 6 * questionCount(questionsJson) + 20
}

/**
 * Transcriptions de réponses orales par jour pour une session de l'entretien vocal (/v2, ADR 0035), comptées à part des
 * appels ci-dessus : 4 par question (la réponse et celle à la relance, chacune pouvant être réécoutée une fois après un
 * bruit transcrit pour rien) et 10 de marge.
 */
export function roomTranscriptionCap(questionsJson: unknown): number {
  return 4 * questionCount(questionsJson) + 10
}

/**
 * Transcriptions de l'entretien vocal par jour, par organisation et pour toutes : à part du quota d'IA des recruteurs
 * (interviewAi), qu'un candidat ne doit pas pouvoir épuiser. 300 = 15 entretiens complets de 10 questions par jour.
 */
export const TRANSCRIPTION_DAILY_LIMITS = { organisation: 300, allOrganisations: 3000 } as const

/**
 * Phrases lues à voix haute par jour pour une session de l'entretien vocal (/v2, ADR 0052), comptées à part des appels
 * ci-dessus : 5 par question (la question, sa relance, deux relances orales après un silence, une voix préparée à
 * l'avance redemandée après un échec) et 10 de marge (mot de la fin, réponse à la question de clôture).
 */
export function roomSpeechCap(questionsJson: unknown): number {
  return 5 * questionCount(questionsJson) + 10
}

/**
 * Voix de l'entretien vocal par jour, par organisation et pour toutes (ADR 0052) : un service payant au caractère,
 * appelé par une route publique ; 600 = environ 25 entretiens de 10 questions par jour.
 */
export const SPEECH_DAILY_LIMITS = { organisation: 600, allOrganisations: 6000 } as const

const MAX_QUESTIONS = 30

/** Texte de chaque question de la session ('' pour une question abîmée), 30 au plus ; [] si illisibles. */
export function questionTexts(questionsJson: unknown): string[] {
  const parsed = parseQuestions(questionsJson)
  return parsed.slice(0, MAX_QUESTIONS).map(q => {
    const text = (q as { text?: unknown } | null)?.text
    return typeof text === 'string' ? text : ''
  })
}

function questionCount(questionsJson: unknown): number {
  // Questions illisibles : la marge seule.
  return Math.min(parseQuestions(questionsJson).length, MAX_QUESTIONS)
}

function parseQuestions(questionsJson: unknown): unknown[] {
  try {
    const parsed: unknown = JSON.parse(typeof questionsJson === 'string' ? questionsJson : '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Lien de l'entretien envoyé au candidat : la salle vocale /v2 (demande du 2026-11-21 : toute nouvelle invitation y mène),
 * au format choisi à la création ; sans format connu, vidéo, comme la salle /v2. Chemin seulement : l'origine du site est
 * ajoutée par l'appelant (e-mail : NEXT_PUBLIC_APP_URL ; écran : window.location.origin).
 */
export function interviewPath(sessionId: string, mediaMode?: 'audio' | 'video'): string {
  return `/interview/${encodeURIComponent(sessionId)}/v2?mode=${mediaMode === 'audio' ? 'audio' : 'video'}`
}
