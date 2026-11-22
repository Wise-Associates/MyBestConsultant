import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPostRequest, imageUrlProblem, readCreatePost, readLinkedInChannel, responseError } from './buffer'

describe('imageUrlProblem', () => {
  it('accepte l’affiche d’un site public en https', () => {
    assert.equal(imageUrlProblem('https://www.mybestconsultant.fr/api/social/poster/abc.png'), null)
    assert.equal(imageUrlProblem('https://abc-123.trycloudflare.com/api/social/poster/abc.png'), null)
  })

  it('refuse une affiche que Buffer ne peut pas télécharger (poste local, http, réseau privé)', () => {
    for (const url of [
      'http://localhost:3000/api/social/poster/abc.png', 'https://localhost:3000/api/social/poster/abc.png',
      'http://www.mybestconsultant.fr/api/social/poster/abc.png', 'https://127.0.0.1/api/social/poster/abc.png',
      'https://192.168.1.20/api/social/poster/abc.png', 'https://10.0.0.5/x.png', 'https://[::1]/x.png', 'pas une adresse',
    ]) assert.notEqual(imageUrlProblem(url), null, url)
  })

  it('dit quoi faire en local', () => {
    assert.match(imageUrlProblem('http://localhost:3000/api/social/poster/abc.png') ?? '', /http:\/\/localhost:3000.*tunnel https/)
  })
})

describe('createPostRequest', () => {
  it('publie tout de suite le texte et l’affiche sur le canal, comme le module Buffer de Make', () => {
    const text = 'Ligne 1 "citée"\nLigne 2'
    const r = createPostRequest('6ae306822f1f5ed6480bb31f', text, 'https://mybestconsultant.fr/api/social/poster/abc.png')
    assert.match(r.query, /createPost\(input: \$input\)/)
    assert.deepEqual(r.variables.input, {
      channelId: '6ae306822f1f5ed6480bb31f', text, schedulingType: 'automatic', mode: 'shareNow',
      assets: [{ image: { url: 'https://mybestconsultant.fr/api/social/poster/abc.png' } }],
    })
    // Texte transmis tel quel : JSON.stringify protège guillemets et retours à la ligne (Make avait besoin de « escaped »).
    assert.equal(JSON.parse(JSON.stringify(r)).variables.input.text, text)
  })
})

describe('readCreatePost', () => {
  it('renvoie l’identifiant du post créé', () => {
    assert.deepEqual(readCreatePost(200, { data: { createPost: { post: { id: 'p1' } } } }), { ok: true, value: 'p1' })
  })

  it('renvoie le message d’une erreur typée de la mutation', () => {
    const r = readCreatePost(200, { data: { createPost: { message: 'Failed to create post: Failed to fetch image dimensions: Not Found' } } })
    assert.deepEqual(r, { ok: false, error: 'Buffer : Failed to create post: Failed to fetch image dimensions: Not Found' })
  })

  it('reconnaît une clé refusée, par le code HTTP ou par le corps', () => {
    for (const r of [readCreatePost(401, null), readCreatePost(200, { data: null, errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] })]) {
      assert.equal(r.ok, false)
      assert.match(r.ok ? '' : r.error, /BUFFER_API_KEY/)
    }
  })

  it('reconnaît le quota dépassé', () => {
    const r = readCreatePost(429, { errors: [{ message: 'Too many requests from this client. Please try again later.', extensions: { code: 'RATE_LIMIT_EXCEEDED', window: '15m' } }] })
    assert.equal(r.ok, false)
    assert.match(r.ok ? '' : r.error, /Limite de requêtes/)
  })

  it('remonte une autre erreur GraphQL avec son message', () => {
    assert.deepEqual(readCreatePost(200, { data: null, errors: [{ message: 'Channel not found', extensions: { code: 'NOT_FOUND' } }] }), { ok: false, error: 'Buffer : Channel not found' })
  })

  it('ne prend jamais une réponse illisible ou une erreur HTTP pour un succès', () => {
    assert.equal(readCreatePost(200, null).ok, false)
    assert.equal(readCreatePost(200, { data: { createPost: null } }).ok, false)
    assert.equal(readCreatePost(200, { data: { createPost: { post: { id: '' } } } }).ok, false)
    assert.deepEqual(readCreatePost(502, { data: { createPost: { post: { id: 'p1' } } } }), { ok: false, error: 'Buffer a répondu par une erreur (HTTP 502).' })
  })

  it('borne la longueur du message de Buffer', () => {
    const r = readCreatePost(200, { data: { createPost: { message: 'x'.repeat(1000) } } })
    assert.ok(!r.ok && r.error.length <= 200)
  })
})

describe('readLinkedInChannel', () => {
  it('accepte un canal LinkedIn et renvoie son nom', () => {
    assert.deepEqual(readLinkedInChannel(200, { data: { channel: { id: 'c1', name: 'Wise Associates', service: 'linkedin' } } }), { ok: true, value: 'Wise Associates' })
  })

  it('refuse un canal d’un autre réseau', () => {
    const r = readLinkedInChannel(200, { data: { channel: { id: 'c1', name: 'wise', service: 'instagram' } } })
    assert.equal(r.ok, false)
    assert.match(r.ok ? '' : r.error, /pas un canal LinkedIn \(instagram\)/)
  })

  it('refuse un canal absent', () => {
    assert.equal(readLinkedInChannel(200, { data: { channel: null } }).ok, false)
    assert.equal(readLinkedInChannel(200, { data: null, errors: [{ message: 'Not found', extensions: { code: 'NOT_FOUND' } }] }).ok, false)
  })
})

describe('responseError', () => {
  it('ne signale rien pour une réponse 200 sans erreurs', () => {
    assert.equal(responseError(200, { data: { channel: { id: 'c1' } } }), null)
  })
})
