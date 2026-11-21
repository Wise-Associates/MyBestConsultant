// Entretien vocal sans clic (/interview/<session>/v2, ADR 0035) : le navigateur mesure le niveau du micro pendant que le
// candidat répond et décide seul quand sa réponse est finie, pour que l'entretien enchaîne sans bouton. Règles pures,
// l'heure est passée en paramètre (performance.now() dans la page) ; testées dans voice-turn.test.ts.
//
// Le niveau est la valeur efficace (RMS, 0 à 1) d'un échantillon du micro. Avec le contrôle automatique du gain et la
// réduction de bruit du navigateur (getUserMedia), une pièce calme reste vers 0,005 ; une voix normale dépasse 0,03.

export const TURN_RULES = {
  /** Bruit de fond mesuré au début de chaque écoute (son niveau le plus bas), s'il est plus bas que celui déjà connu. */
  calibrationMs: 400,
  /**
   * Seuil de parole : 3 fois le bruit de fond, entre ces deux bornes. Plafond bas : un candidat qui répond dès la fin de
   * la question fait mesurer sa propre voix comme bruit de fond, le seuil ne doit pas pouvoir monter au-dessus d'elle.
   */
  noiseFactor: 3,
  minThreshold: 0.01,
  maxThreshold: 0.025,
  /**
   * Voix faible, sous le seuil : au moins ce niveau et 1,5 fois le bruit de fond (un bruit constant n'est pas une voix).
   * Comptée à part pour ne pas perdre une réponse (voir noAnswerMs).
   */
  quietSpeechLevel: 0.015,
  quietSpeechFactor: 1.5,
  /** Au-dessus du seuil pendant ce temps : le candidat parle. */
  speechStartMs: 250,
  /** Parole cumulée en dessous de laquelle une écoute « finie » n'était qu'un bruit (toux, clic) : on continue d'écouter. */
  minSpeechMs: 600,
  /** Silence après la parole qui termine la réponse (une pause de réflexion plus courte ne la coupe pas). */
  endSilenceMs: 2000,
  /**
   * Rien entendu pendant ce temps : la page relance le candidat, puis passe à la suite. Si une voix faible a été entendue
   * assez longtemps, la réponse part quand même à la transcription (fin de réponse) : un texte vide ne coûte qu'une relance.
   */
  noAnswerMs: 20_000,
  /** Réponse coupée après ce temps de parole (le fichier envoyé à la transcription reste petit). */
  maxAnswerMs: 180_000,
  /** Écart maximal compté entre deux mesures : un onglet en arrière-plan n'en fait qu'une par seconde. */
  maxStepMs: 200,
} as const

export interface TurnState {
  startedAt: number
  lastAt: number
  /** Bruit de fond : le niveau le plus bas connu ; null tant qu'aucun n'est connu. */
  floor: number | null
  threshold: number
  /** Début de la série d'échantillons au-dessus du seuil en cours, avant que la parole ne soit reconnue. */
  aboveSince: number | null
  speaking: boolean
  speechStartedAt: number | null
  speechMs: number
  lastLoudAt: number | null
  /** Temps cumulé au niveau d'une voix faible ou plus, même sous le seuil. */
  quietSpeechMs: number
}

/** `speech-start` : informatif (affichage) ; les trois autres terminent l'écoute. */
export type TurnEvent = 'speech-start' | 'end-of-answer' | 'no-answer' | 'max-length' | null

function thresholdFor(floor: number): number {
  return Math.min(TURN_RULES.maxThreshold, Math.max(TURN_RULES.minThreshold, floor * TURN_RULES.noiseFactor))
}

/** `knownFloor` : bruit de fond déjà mesuré (écran de test du micro, écoutes précédentes), le plus bas. */
export function startTurn(now: number, knownFloor: number | null = null): TurnState {
  return {
    startedAt: now, lastAt: now, floor: knownFloor, threshold: knownFloor === null ? TURN_RULES.minThreshold : thresholdFor(knownFloor),
    aboveSince: null, speaking: false, speechStartedAt: null, speechMs: 0, lastLoudAt: null, quietSpeechMs: 0,
  }
}

export function feedLevel(state: TurnState, level: number, now: number): { state: TurnState; event: TurnEvent } {
  const s: TurnState = { ...state }
  const dt = Math.min(TURN_RULES.maxStepMs, Math.max(0, now - s.lastAt))
  s.lastAt = now

  // Le minimum et non la moyenne : un candidat qui parle dès le début de l'écoute a des creux entre ses mots, la moyenne
  // prendrait sa voix pour du bruit de fond.
  if (now - s.startedAt <= TURN_RULES.calibrationMs) {
    s.floor = s.floor === null ? level : Math.min(s.floor, level)
    s.threshold = thresholdFor(s.floor)
  }
  const loud = level >= s.threshold
  if (level >= Math.max(TURN_RULES.quietSpeechLevel, (s.floor ?? 0) * TURN_RULES.quietSpeechFactor)) s.quietSpeechMs += dt

  if (!s.speaking) {
    if (loud) {
      s.aboveSince ??= now
      if (now - s.aboveSince >= TURN_RULES.speechStartMs) {
        s.speaking = true
        s.speechStartedAt = s.aboveSince
        s.speechMs = now - s.aboveSince
        s.lastLoudAt = now
        return { state: s, event: 'speech-start' }
      }
    } else {
      s.aboveSince = null
    }
    if (now - s.startedAt < TURN_RULES.noAnswerMs) return { state: s, event: null }
    return { state: s, event: s.quietSpeechMs >= TURN_RULES.minSpeechMs ? 'end-of-answer' : 'no-answer' }
  }

  if (loud) {
    s.speechMs += dt
    s.lastLoudAt = now
  }
  if (s.speechStartedAt !== null && now - s.speechStartedAt >= TURN_RULES.maxAnswerMs) return { state: s, event: 'max-length' }
  if (!loud && s.lastLoudAt !== null && now - s.lastLoudAt >= TURN_RULES.endSilenceMs) {
    if (s.speechMs >= TURN_RULES.minSpeechMs) return { state: s, event: 'end-of-answer' }
    // Trop peu de parole : c'était un bruit, l'écoute continue (le délai sans réponse court toujours depuis le début).
    s.speaking = false
    s.speechStartedAt = null
    s.speechMs = 0
    s.aboveSince = null
    s.lastLoudAt = null
  }
  return { state: s, event: null }
}

const TRANSITIONS = ['Merci.', 'Très bien, merci.', "D'accord, merci pour cette réponse.", 'Merci, passons à la suite.'] as const

/** Phrase dite avant la question suivante (index ≥ 1), variée pour que l'entretien ne sonne pas mécanique. */
export function transitionPhrase(index: number): string {
  return TRANSITIONS[Math.abs(index) % TRANSITIONS.length]
}

/**
 * Phrase dite par Alex pour la question `index` (sur `total`) : présentation de l'entretien avant la première, phrase de
 * transition avant les suivantes. Toujours la même pour une question : sa voix est préparée pendant la question
 * précédente (ADR 0052), et le texte préparé doit être exactement celui qui sera dit.
 */
export function spokenQuestion(index: number, total: number, candidateName: string, questionText: string): string {
  if (index === 0) {
    return `Bonjour ${candidateName}. Je suis Alex, votre recruteur pour ce poste. Je vais vous poser ${total} questions. Répondez simplement à voix haute : je passerai à la suite dès que vous aurez terminé. ${questionText}`
  }
  return `${transitionPhrase(index)} ${questionText}`
}

/**
 * Phrase de fin de l'entretien, préparée pendant la dernière question. L'IA ne répond plus aux questions du candidat
 * pendant l'entretien (ADR 0053) : le recruteur, qui les lit dans la retranscription, y répondra.
 */
export function closingLine(candidateName: string): string {
  return `Merci ${candidateName}, l'entretien est terminé. Vos réponses ont été enregistrées : le recruteur vous recontactera prochainement et répondra à vos questions. Bonne chance !`
}

/** Relance orale quand le candidat n'a rien dit. */
export const REPROMPT_LINE = 'Je ne vous ai pas entendu. Prenez votre temps, et répondez à voix haute quand vous êtes prêt.'

/**
 * Phrase demandée à la voix (ADR 0052, 0053) : le serveur construit lui-même les questions, le mot de la fin et la
 * relance à partir de l'entretien ; aucun texte n'est envoyé. La route de la voix ne lit donc pas n'importe quel texte.
 */
export type SpeechLine = { kind: 'question'; index: number } | { kind: 'closing' } | { kind: 'reprompt' }

/** Texte dit pour `line` ; null pour une question qui n'existe pas ou sans texte. Même calcul dans la page et la route. */
export function lineText(line: SpeechLine, interview: { questions: readonly string[]; candidateName: string }): string | null {
  switch (line.kind) {
    case 'question': {
      const question = interview.questions[line.index]
      if (typeof question !== 'string' || !question.trim()) return null
      return spokenQuestion(line.index, interview.questions.length, interview.candidateName, question)
    }
    case 'closing':
      return closingLine(interview.candidateName)
    case 'reprompt':
      return REPROMPT_LINE
  }
}

// Prénoms des voix françaises masculines courantes des navigateurs (macOS / iOS : Thomas, Jacques, Nicolas ; Windows :
// Paul, Henri, Rémy, Gérard…). La voix d'Alex est masculine : en secours, le navigateur ne doit pas passer à une voix
// féminine (« Google français » de Chrome) entre deux questions.
const MALE_VOICE = /\b(thomas|jacques|nicolas|paul|henri|r[ée]my|g[ée]rard|claude|antoine|daniel|mathieu|olivier|guillaume|alain|fabrice|jean)\b/i

/** Voix française masculine à prendre en secours parmi celles du navigateur, ou -1 (voix française par défaut). */
export function fallbackVoiceIndex(voices: readonly { name: string; lang: string }[]): number {
  return voices.findIndex(v => /^fr([-_]|$)/i.test(v.lang) && MALE_VOICE.test(v.name))
}
