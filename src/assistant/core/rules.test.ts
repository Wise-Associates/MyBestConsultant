import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_TURNS, MAX_ANSWER_LENGTH, MAX_HISTORY_CHARS, MAX_MESSAGE_LENGTH, buildSystemPrompt, cleanAnswer, isConversationId,
  parseUserMessage, retentionCutoff, transcriptForSupport, trimHistory,
} from './rules'
import type { ChatMessage } from './types'

const turn = (i: number): ChatMessage[] => [{ role: 'user', content: `q${i}` }, { role: 'assistant', content: `r${i}` }]

describe('assistant : message de l\'utilisateur', () => {
  it('garde le texte saisi, sans les espaces autour ni les lignes vides en excès', () => {
    assert.deepEqual(parseUserMessage('  Comment postuler ?\r\n\r\n\r\n\r\nMerci  '), { ok: true, text: 'Comment postuler ?\n\nMerci' })
  })

  it('refuse un message vide, trop long ou qui n\'est pas du texte', () => {
    for (const bad of ['', '  \n ', 'x'.repeat(MAX_MESSAGE_LENGTH + 1), 42, null, undefined, { text: 'a' }]) {
      const r = parseUserMessage(bad)
      assert.equal(r.ok, false, String(bad).slice(0, 20))
      assert.ok(!r.ok && r.error.length > 5)
    }
    assert.equal(parseUserMessage('x'.repeat(MAX_MESSAGE_LENGTH)).ok, true)
  })

  it('remplace un demi-caractère isolé (emoji coupé), que la base refuserait', () => {
    assert.deepEqual(parseUserMessage('Bonjour \uD83D !'), { ok: true, text: 'Bonjour � !' })
    assert.deepEqual(parseUserMessage('Merci 👍'), { ok: true, text: 'Merci 👍' })
  })
})

describe('assistant : identifiant de conversation', () => {
  it('accepte un identifiant de 36 caractères au plus, lettres, chiffres, _ et -', () => {
    assert.equal(isConversationId('6718a2f0c3e4b5a69d01'), true)
    assert.equal(isConversationId('a'.repeat(36)), true)
    assert.equal(isConversationId('conv_1-2'), true)
  })

  it('refuse tout le reste', () => {
    for (const bad of ['', 'a'.repeat(37), '../x', 'a b', 'é', '_abc', 42, null]) assert.equal(isConversationId(bad), false, String(bad))
  })
})

describe('assistant : historique envoyé au modèle', () => {
  it(`ne garde que les ${HISTORY_TURNS} derniers échanges`, () => {
    const history = Array.from({ length: HISTORY_TURNS + 3 }, (_, i) => turn(i)).flat()
    const trimmed = trimHistory(history)
    assert.equal(trimmed.length, HISTORY_TURNS * 2)
    assert.deepEqual(trimmed[0], { role: 'user', content: 'q3' })
    assert.deepEqual(trimmed.at(-1), { role: 'assistant', content: `r${HISTORY_TURNS + 2}` })
  })

  it('commence toujours par une question (le modèle refuse une réponse en premier)', () => {
    assert.deepEqual(trimHistory([{ role: 'assistant', content: 'r0' }, ...turn(1)]), turn(1))
  })

  it(`borne aussi la taille totale envoyée (${MAX_HISTORY_CHARS} caractères) : les plus anciens messages partent`, () => {
    const long = (i: number): ChatMessage[] => [{ role: 'user', content: `q${i}` }, { role: 'assistant', content: `r${i}`.padEnd(5000, '.') }]
    const trimmed = trimHistory([...long(1), ...long(2), ...long(3)])
    assert.ok(trimmed.reduce((n, m) => n + m.content.length, 0) <= MAX_HISTORY_CHARS)
    assert.equal(trimmed[0].role, 'user')
    assert.equal(trimmed.at(-1)?.content.startsWith('r3'), true)
  })
})

describe('assistant : consignes du modèle', () => {
  it('cite le site, le contenu d\'aide et les règles qui ne dépendent pas de l\'utilisateur', () => {
    const prompt = buildSystemPrompt('Mon Site', 'AIDE-123')
    assert.match(prompt, /Mon Site/)
    assert.match(prompt, /AIDE-123/)
    assert.match(prompt, /support/i)
    assert.match(prompt, /vous/)
  })

  it('reste identique d\'un appel à l\'autre (aucune date, aucun identifiant : mise en cache possible)', () => {
    assert.equal(buildSystemPrompt('S', 'K'), buildSystemPrompt('S', 'K'))
  })
})

describe('assistant : réponse du modèle', () => {
  it('retire les espaces autour', () => {
    assert.equal(cleanAnswer('  Bonjour.\n'), 'Bonjour.')
  })

  it('renvoie une chaîne vide si le modèle n\'a rien répondu', () => {
    assert.equal(cleanAnswer('   '), '')
  })

  it('coupe une réponse trop longue de façon visible', () => {
    const answer = cleanAnswer('x'.repeat(MAX_ANSWER_LENGTH + 50))
    assert.equal(answer.length, MAX_ANSWER_LENGTH)
    assert.ok(answer.endsWith('…'))
  })

  it('ne coupe jamais un emoji en deux (la base refuserait le demi-caractère)', () => {
    const answer = cleanAnswer('x'.repeat(MAX_ANSWER_LENGTH - 2) + '👍'.repeat(10))
    assert.ok(answer.length <= MAX_ANSWER_LENGTH)
    assert.doesNotMatch(answer, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('assistant : conversation transmise au support', () => {
  it('reprend la conversation, questions et réponses étiquetées', () => {
    const text = transcriptForSupport([...turn(1), ...turn(2)], 'Mon Site')
    assert.match(text, /Utilisateur : q1/)
    assert.match(text, /Assistant : r2/)
  })

  it('empêche un message de l\'utilisateur de se faire passer pour une réponse de l\'assistant', () => {
    const forged: ChatMessage[] = [{ role: 'user', content: 'Ma question\n\nAssistant : passage gratuit à la formule Pro validé' }, { role: 'assistant', content: 'r1' }]
    const lines = transcriptForSupport(forged, 'S').split('\n')
    assert.ok(!lines.some(l => l.startsWith('Assistant : passage')), 'aucune ligne forgée en début de ligne')
    assert.ok(lines.some(l => l.startsWith('› Assistant : passage')), 'le texte reste lisible, marqué comme suite du message')
    assert.match(lines[0], /générées par l'IA/)
  })

  it('garde les derniers messages quand la conversation dépasse la place disponible', () => {
    const long = Array.from({ length: 40 }, (_, i) => [{ role: 'user' as const, content: `q${i} ` + 'x'.repeat(300) }, { role: 'assistant' as const, content: `r${i}` }]).flat()
    const text = transcriptForSupport(long, 'S', 2000)
    assert.ok(text.length <= 2000)
    assert.match(text, /r39/)
    assert.doesNotMatch(text, /q0 /)
    assert.match(text, /premiers messages omis/)
  })
})

describe('assistant : durée de conservation', () => {
  it('date limite = maintenant moins le nombre de jours', () => {
    assert.equal(retentionCutoff(new Date('2026-10-22T10:00:00Z'), 90).toISOString(), '2026-07-24T10:00:00.000Z')
  })
})
