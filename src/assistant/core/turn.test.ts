import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { handoffToSupport, loadLatest, runTurn } from './turn'
import type { AssistantHost, AssistantUser, ChatMessage, QuotaCheck } from './types'

interface Saved { userId: string; conversationId: string; question: string; answer: string; provider: string }

/** Site fictif : conversations en mémoire, modèle et quotas simulés. */
function fakeHost(opts: { user?: AssistantUser | null; quota?: QuotaCheck; answer?: string | Error; saved?: Saved[]; appendFails?: boolean } = {}) {
  const saved: Saved[] = opts.saved ?? []
  const calls = { complete: [] as { system: string; messages: ChatMessage[] }[], handoff: [] as string[], quota: 0 }
  let next = 0
  const messagesOf = (userId: string, conversationId: string) =>
    saved.filter(s => s.userId === userId && s.conversationId === conversationId)
      .flatMap(s => [{ role: 'user' as const, content: s.question }, { role: 'assistant' as const, content: s.answer }])
  const host: AssistantHost = {
    siteName: 'Site test',
    getUser: async () => (opts.user === undefined ? { id: 'u1', role: 'candidate' } : opts.user),
    store: {
      newId: () => `conv${++next}`,
      list: async (userId, conversationId, maxTurns) => messagesOf(userId, conversationId).slice(-maxTurns * 2),
      latest: async (userId, maxTurns) => {
        const last = saved.filter(s => s.userId === userId).at(-1)
        return last ? { conversationId: last.conversationId, messages: messagesOf(userId, last.conversationId).slice(-maxTurns * 2) } : null
      },
      append: async (user, conversationId, question, answer, provider) => {
        if (opts.appendFails) throw new Error('Appwrite indisponible')
        saved.push({ userId: user.id, conversationId, question, answer, provider })
      },
      purgeBefore: async () => 0,
      deleteForUser: async () => undefined,
    },
    takeQuota: async () => { calls.quota++; return opts.quota ?? 'ok' },
    complete: async (system, messages) => {
      calls.complete.push({ system, messages })
      if (opts.answer instanceof Error) throw opts.answer
      return { text: opts.answer ?? 'Réponse.', provider: 'fake' }
    },
    knowledge: user => `Aide pour ${user.role}`,
    handoff: async (_user, transcript) => { calls.handoff.push(transcript); return { ok: true, url: '/support/t1' } },
  }
  return { host, saved, calls }
}

const NOW = new Date('2026-10-22T10:00:00Z')

describe('assistant : envoi d\'un message', () => {
  it('répond, crée la conversation et enregistre la question avec sa réponse', async () => {
    const { host, saved, calls } = fakeHost()
    const r = await runTurn(host, { conversationId: null, text: ' Comment postuler ? ' }, NOW)
    assert.deepEqual(r, { ok: true, conversationId: 'conv1', answer: 'Réponse.', saved: true })
    assert.deepEqual(saved, [{ userId: 'u1', conversationId: 'conv1', question: 'Comment postuler ?', answer: 'Réponse.', provider: 'fake' }])
    assert.match(calls.complete[0].system, /Aide pour candidate/)
    assert.deepEqual(calls.complete[0].messages, [{ role: 'user', content: 'Comment postuler ?' }])
  })

  it('envoie l\'historique de la conversation au modèle', async () => {
    const { host, calls } = fakeHost({ saved: [{ userId: 'u1', conversationId: 'c9', question: 'q1', answer: 'r1', provider: 'fake' }] })
    const r = await runTurn(host, { conversationId: 'c9', text: 'q2' }, NOW)
    assert.equal(r.ok, true)
    assert.deepEqual(calls.complete[0].messages.map(m => m.content), ['q1', 'r1', 'q2'])
  })

  it('refuse un visiteur sans droit à l\'assistant, sans appeler le modèle ni compter de quota', async () => {
    const { host, calls } = fakeHost({ user: null })
    const r = await runTurn(host, { conversationId: null, text: 'Bonjour' }, NOW)
    assert.equal(r.ok === false && r.code, 'unauthorized')
    assert.equal(calls.complete.length + calls.quota, 0)
  })

  it('traite la conversation d\'un autre utilisateur comme introuvable', async () => {
    const { host, saved, calls } = fakeHost({ saved: [{ userId: 'u2', conversationId: 'c9', question: 'secret', answer: 'r', provider: 'fake' }] })
    const r = await runTurn(host, { conversationId: 'c9', text: 'Et alors ?' }, NOW)
    assert.equal(r.ok === false && r.code, 'not_found')
    assert.equal(calls.complete.length + calls.quota, 0)
    assert.equal(saved.length, 1)
  })

  it('refuse une saisie invalide sans compter de quota', async () => {
    for (const input of [{ conversationId: null, text: '' }, { conversationId: '../x', text: 'a' }, { text: 'a' }, 'texte', null]) {
      const { host, calls } = fakeHost()
      const r = await runTurn(host, input, NOW)
      assert.equal(r.ok === false && r.code, 'invalid', JSON.stringify(input))
      assert.equal(calls.quota, 0)
    }
  })

  it('refuse au-delà du quota du jour, sans appeler le modèle, en disant quelle limite est atteinte', async () => {
    const user = fakeHost({ quota: 'user-limit' })
    const r = await runTurn(user.host, { conversationId: null, text: 'Bonjour' }, NOW)
    assert.equal(r.ok === false && r.code, 'quota')
    assert.ok(r.ok === false && /Vous avez atteint/.test(r.error))
    assert.equal(user.calls.complete.length, 0)

    const site = fakeHost({ quota: 'site-limit' })
    const s = await runTurn(site.host, { conversationId: null, text: 'Bonjour' }, NOW)
    assert.equal(s.ok === false && s.code, 'quota')
    assert.ok(s.ok === false && /L’assistant a atteint/.test(s.error), 'pas « vous avez atteint » quand c’est la limite du site')
    assert.equal(site.calls.complete.length, 0)
  })

  it('modèle en échec : erreur explicite, rien d\'enregistré', async () => {
    const { host, saved } = fakeHost({ answer: new Error('LLM API error 529: overloaded') })
    const r = await runTurn(host, { conversationId: null, text: 'Bonjour' }, NOW)
    assert.equal(r.ok === false && r.code, 'unavailable')
    assert.ok(r.ok === false && /réessayez/i.test(r.error))
    assert.equal(saved.length, 0)
  })

  it('modèle sans réponse (refus, texte vide) : invite à reformuler plutôt qu\'à réessayer plus tard', async () => {
    const { host, saved } = fakeHost({ answer: '   ' })
    const r = await runTurn(host, { conversationId: null, text: 'Bonjour' }, NOW)
    assert.equal(r.ok === false && r.code, 'unavailable')
    assert.ok(r.ok === false && /reformulez/i.test(r.error))
    assert.equal(saved.length, 0)
  })

  it('enregistrement impossible après la réponse : la réponse (déjà facturée) est affichée, marquée non enregistrée', async () => {
    const created = fakeHost({ appendFails: true })
    assert.deepEqual(await runTurn(created.host, { conversationId: null, text: 'Bonjour' }, NOW),
      { ok: true, conversationId: null, answer: 'Réponse.', saved: false }, 'nouvelle conversation : aucun identifiant, elle n’existe pas en base')

    const existing = fakeHost({ appendFails: true, saved: [{ userId: 'u1', conversationId: 'c9', question: 'q1', answer: 'r1', provider: 'fake' }] })
    assert.deepEqual(await runTurn(existing.host, { conversationId: 'c9', text: 'q2' }, NOW),
      { ok: true, conversationId: 'c9', answer: 'Réponse.', saved: false })
  })
})

describe('assistant : reprise de la dernière conversation', () => {
  it('renvoie la dernière conversation de l\'utilisateur, jamais celle d\'un autre', async () => {
    const { host } = fakeHost({ saved: [
      { userId: 'u1', conversationId: 'c1', question: 'q1', answer: 'r1', provider: 'fake' },
      { userId: 'u2', conversationId: 'c2', question: 'q2', answer: 'r2', provider: 'fake' },
    ] })
    assert.deepEqual(await loadLatest(host), { ok: true, conversation: { conversationId: 'c1', messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'r1' }] } })
  })

  it('aucune conversation : null ; visiteur sans droit : refusé', async () => {
    assert.deepEqual(await loadLatest(fakeHost().host), { ok: true, conversation: null })
    const r = await loadLatest(fakeHost({ user: null }).host)
    assert.equal(r.ok === false && r.code, 'unauthorized')
  })
})

describe('assistant : transmission au support', () => {
  it('transmet la conversation de l\'utilisateur', async () => {
    const { host, calls } = fakeHost({ saved: [{ userId: 'u1', conversationId: 'c1', question: 'Ma question', answer: 'Ma réponse', provider: 'fake' }] })
    assert.deepEqual(await handoffToSupport(host, 'c1'), { ok: true, url: '/support/t1' })
    assert.match(calls.handoff[0], /Utilisateur : Ma question/)
  })

  it('refuse la conversation d\'un autre, un identifiant invalide ou un visiteur sans droit', async () => {
    const saved = [{ userId: 'u2', conversationId: 'c1', question: 'q', answer: 'r', provider: 'fake' }]
    const other = fakeHost({ saved })
    assert.equal((await handoffToSupport(other.host, 'c1')).ok, false)
    assert.equal(other.calls.handoff.length, 0)
    assert.equal((await handoffToSupport(fakeHost().host, '../x')).ok, false)
    assert.equal((await handoffToSupport(fakeHost({ user: null }).host, 'c1')).ok, false)
  })
})
