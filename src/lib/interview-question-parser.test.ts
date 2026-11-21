import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IMPORT_LIMITS, parseInterviewQuestions } from './interview-question-parser'

const texts = (input: string) => parseInterviewQuestions(input).questions.map(q => q.text)

describe('questions d\'entretien lues dans un fichier (découpage intelligent, ADR 0054)', () => {
  it('lit les éléments numérotés et à puces, avec la catégorie de leur titre', () => {
    const result = parseInterviewQuestions([
      'Questions techniques',
      '1. Comment structurez-vous',
      '   une API REST ?',
      '2) Expliquez le cache HTTP.',
      'Page 2',
      'Motivation',
      '- Pourquoi ce poste ?',
    ].join('\n'))
    assert.deepEqual(result.questions, [
      { text: 'Comment structurez-vous une API REST ?', category: 'technical' },
      { text: 'Expliquez le cache HTTP.', category: 'technical' },
      { text: 'Pourquoi ce poste ?', category: 'motivation' },
    ])
    assert.equal(result.truncated, false)
  })

  it('prend chaque ligne terminée par « ? », même sans numéro', () => {
    assert.deepEqual(texts('Quel est votre parcours ?\nQuelle est votre disponibilité ?'), [
      'Quel est votre parcours ?', 'Quelle est votre disponibilité ?',
    ])
  })

  it('rejoint une question sans numéro écrite sur deux lignes', () => {
    assert.deepEqual(texts('Pouvez-vous décrire votre dernier projet\net votre rôle dans l\'équipe ?'), [
      'Pouvez-vous décrire votre dernier projet et votre rôle dans l\'équipe ?',
    ])
  })

  it('ignore le texte d\'introduction et les numéros de page', () => {
    assert.deepEqual(texts([
      'Grille d\'entretien — poste de développeur.',
      'Merci de poser les questions dans l\'ordre.',
      '1. Présentez-vous en quelques mots.',
      '3/5',
      '- 4 -',
      'Page 12',
      '2. Quel projet vous a le plus appris ?',
    ].join('\n')), ['Présentez-vous en quelques mots.', 'Quel projet vous a le plus appris ?'])
  })

  it('distingue un titre numéroté d\'une question qui contient un mot de catégorie', () => {
    const result = parseInterviewQuestions([
      '1. Questions comportementales',
      '2. Décrivez une situation difficile.',
      '3. Partie 3 : motivation',
      '4. Qu\'attendez-vous de ce poste ?',
    ].join('\n'))
    assert.deepEqual(result.questions, [
      { text: 'Décrivez une situation difficile.', category: 'behavioral' },
      { text: 'Qu\'attendez-vous de ce poste ?', category: 'motivation' },
    ])
  })

  it('reconnaît les marqueurs courants', () => {
    assert.deepEqual(texts([
      'Q1 : Quel langage préférez-vous ?',
      'Question 2 - Comment testez-vous votre code ?',
      '(3) Comment documentez-vous une API ?',
      'a) Comment gérez-vous un conflit ?',
      '• Quel est votre meilleur souvenir de projet ?',
      '* Comment priorisez-vous vos tâches ?',
      '– Que faites-vous en veille technique ?',
    ].join('\n')), [
      'Quel langage préférez-vous ?', 'Comment testez-vous votre code ?', 'Comment documentez-vous une API ?',
      'Comment gérez-vous un conflit ?', 'Quel est votre meilleur souvenir de projet ?', 'Comment priorisez-vous vos tâches ?',
      'Que faites-vous en veille technique ?',
    ])
  })

  it('lit les titres Markdown et les titres suivis de deux-points', () => {
    const result = parseInterviewQuestions('## Introduction\nQui êtes-vous ?\nPour finir :\nAvez-vous des questions ?')
    assert.deepEqual(result.questions, [
      { text: 'Qui êtes-vous ?', category: 'intro' },
      { text: 'Avez-vous des questions ?', category: 'closing' },
    ])
  })

  it('range une question sans titre dans « Technique »', () => {
    assert.deepEqual(parseInterviewQuestions('Quel framework maîtrisez-vous ?').questions, [{ text: 'Quel framework maîtrisez-vous ?', category: 'technical' }])
  })

  it('accepte les fins de ligne Windows et les espaces insécables', () => {
    assert.deepEqual(texts('1. Quel est votre rôle ?\r\n2. Quelle est votre méthode ?\r\n'), ['Quel est votre rôle ?', 'Quelle est votre méthode ?'])
  })

  it('retire les doublons et les éléments trop courts ou trop longs', () => {
    assert.deepEqual(texts([
      '1. Pourquoi ce poste ?', '2. pourquoi ce poste ?', '3. Oui ?', `4. ${'x'.repeat(IMPORT_LIMITS.maxChars + 1)} ?`, '5. Quel est votre préavis ?',
    ].join('\n')), ['Pourquoi ce poste ?', 'Quel est votre préavis ?'])
  })

  it('garde 30 questions au plus et le signale', () => {
    const many = Array.from({ length: 40 }, (_, i) => `${i + 1}. Question numéro ${i + 1} ?`).join('\n')
    const result = parseInterviewQuestions(many)
    assert.equal(result.questions.length, IMPORT_LIMITS.maxQuestions)
    assert.equal(result.truncated, true)
  })

  it('ne trouve rien dans un texte sans question', () => {
    assert.deepEqual(parseInterviewQuestions('').questions, [])
    assert.deepEqual(parseInterviewQuestions('Ceci est un compte rendu.\nIl ne contient aucune question.').questions, [])
  })

  it('lit un fichier hostile en temps linéaire (revue de sécurité du 2026-11-21 : 7,6 s pour 60 000 caractères)', () => {
    const started = performance.now()
    parseInterviewQuestions('a\n'.repeat(30_000))
    parseInterviewQuestions(`1. ${'mot '.repeat(15_000)}`)
    parseInterviewQuestions(`1. Début\n${'suite\n'.repeat(10_000)}`)
    assert.ok(performance.now() - started < 1000, `trop lent : ${Math.round(performance.now() - started)} ms`)
  })
})

