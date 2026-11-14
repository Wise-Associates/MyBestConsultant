import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TURN_RULES, feedLevel, startTurn, transitionPhrase, type TurnEvent, type TurnState } from './voice-turn'

const QUIET = 0.002
const VOICE = 0.08
/** Voix normale après le contrôle automatique du gain, la plus exposée à être prise pour du bruit de fond. */
const NORMAL_VOICE = 0.035
const STEP = 50

/** Fait passer des niveaux réguliers (un tous les `step` ms) et renvoie le premier évènement qui termine l'écoute. */
function run(state: TurnState, from: number, durationMs: number, level: number, step = STEP): { state: TurnState; event: TurnEvent; at: number; started: boolean } {
  let current = state
  let started = false
  for (let t = from + step; t <= from + durationMs; t += step) {
    const s = feedLevel(current, level, t)
    current = s.state
    if (s.event === 'speech-start') started = true
    else if (s.event) return { state: current, event: s.event, at: t, started }
  }
  return { state: current, event: null, at: from + durationMs, started }
}

describe('détection de la fin d\'une réponse orale', () => {
  it('termine la réponse après un silence suivant la parole', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 1000, QUIET))
    ;({ state: s } = run(s, 1000, 3000, VOICE))
    assert.equal(s.speaking, true)
    const end = run(s, 4000, 5000, QUIET)
    assert.equal(end.event, 'end-of-answer')
    assert.ok(end.at - 4000 >= TURN_RULES.endSilenceMs && end.at - 4000 < TURN_RULES.endSilenceMs + 2 * STEP)
  })

  it('ne coupe pas une courte pause au milieu d\'une phrase', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 500, QUIET))
    ;({ state: s } = run(s, 500, 2000, VOICE))
    const pause = run(s, 2500, TURN_RULES.endSilenceMs - 300, QUIET)
    assert.equal(pause.event, null)
    const resumed = run(pause.state, pause.at, 2000, VOICE)
    assert.equal(resumed.event, null)
    assert.equal(resumed.state.speaking, true)
  })

  it('signale une absence de réponse quand rien n\'est entendu', () => {
    const r = run(startTurn(0), 0, TURN_RULES.noAnswerMs + 1000, QUIET)
    assert.equal(r.event, 'no-answer')
    assert.ok(r.at >= TURN_RULES.noAnswerMs)
  })

  it('ignore un bruit bref (toux, clic) et continue d\'écouter', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 1000, QUIET))
    ;({ state: s } = run(s, 1000, 400, VOICE))
    const after = run(s, 1400, TURN_RULES.endSilenceMs + 500, QUIET)
    assert.equal(after.event, null)
    assert.equal(after.state.speaking, false)
  })

  it('détecte encore une vraie réponse après un bruit bref, et l\'absence de réponse compte depuis le début de l\'écoute', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 1000, QUIET))
    ;({ state: s } = run(s, 1000, 400, VOICE))
    ;({ state: s } = run(s, 1400, 3000, QUIET))
    const answer = run(s, 4400, 2000, VOICE)
    assert.equal(answer.started, true)
    assert.equal(run(answer.state, 6400, 3000, QUIET).event, 'end-of-answer')
    const silent = run(s, 4400, TURN_RULES.noAnswerMs, QUIET)
    assert.equal(silent.event, 'no-answer')
    assert.ok(silent.at >= TURN_RULES.noAnswerMs && silent.at < TURN_RULES.noAnswerMs + 2 * STEP)
  })

  it('reconnaît la parole après exactement 250 ms au-dessus du seuil, et repart de zéro après un échantillon calme', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 500, QUIET))
    s = feedLevel(s, VOICE, 550).state
    s = feedLevel(s, VOICE, 700).state
    s = feedLevel(s, QUIET, 750).state
    assert.equal(s.aboveSince, null)
    s = feedLevel(s, VOICE, 800).state
    assert.equal(feedLevel(s, VOICE, 800 + TURN_RULES.speechStartMs - 1).event, null)
    assert.equal(feedLevel(s, VOICE, 800 + TURN_RULES.speechStartMs).event, 'speech-start')
  })

  it('coupe une réponse trop longue', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 500, QUIET))
    const r = run(s, 500, TURN_RULES.maxAnswerMs + 1000, VOICE)
    assert.equal(r.event, 'max-length')
    assert.ok(r.at >= TURN_RULES.maxAnswerMs)
  })

  it('adapte le seuil au bruit de fond, sans le monter au-dessus d\'une voix normale', () => {
    const noisy = 0.015
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, TURN_RULES.calibrationMs + 100, noisy))
    assert.ok(s.threshold > TURN_RULES.minThreshold)
    assert.ok(s.threshold <= TURN_RULES.maxThreshold && TURN_RULES.maxThreshold < NORMAL_VOICE)
    assert.equal(run(s, TURN_RULES.calibrationMs + 100, TURN_RULES.noAnswerMs, noisy).event, 'no-answer')
    assert.equal(run(s, TURN_RULES.calibrationMs + 100, 1000, NORMAL_VOICE).started, true)
  })

  it('entend un candidat qui répond dès la fin de la question, à niveau normal', () => {
    // Bruit de fond déjà connu (écran de test du micro, écoutes précédentes) : la voix ne peut pas être prise pour lui.
    const known = run(startTurn(0, 0.003), 0, 2000, NORMAL_VOICE)
    assert.equal(known.started, true)
    assert.equal(run(known.state, 2000, 3000, QUIET).event, 'end-of-answer')
    // Sans bruit de fond connu non plus : le seuil plafonné reste sous une voix normale.
    const unknown = run(startTurn(0), 0, 2000, NORMAL_VOICE)
    assert.equal(unknown.started, true)
  })

  it('envoie quand même à la transcription une voix faible restée sous le seuil, plutôt que de la perdre', () => {
    const quietVoice = 0.02
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 500, 0.01)) // bruit de fond élevé : seuil au plafond
    assert.ok(quietVoice < s.threshold)
    ;({ state: s } = run(s, 500, 3000, quietVoice))
    const r = run(s, 3500, TURN_RULES.noAnswerMs, 0.01)
    assert.equal(r.event, 'end-of-answer')
  })

  it('ne compte pas l\'écart entre deux mesures espacées (onglet en arrière-plan) comme du temps de parole', () => {
    let s = startTurn(0)
    ;({ state: s } = run(s, 0, 500, QUIET))
    ;({ state: s } = run(s, 500, 300, VOICE))
    assert.equal(s.speaking, true)
    const before = s.speechMs
    s = feedLevel(s, VOICE, 1800).state
    assert.ok(s.speechMs - before <= TURN_RULES.maxStepMs)
  })
})

describe('transitions entre les questions', () => {
  it('varie la phrase d\'enchaînement et la garde courte', () => {
    const phrases = new Set([1, 2, 3, 4].map(transitionPhrase))
    assert.ok(phrases.size > 1)
    for (const p of phrases) assert.ok(p.length > 0 && p.length < 60)
  })
})
