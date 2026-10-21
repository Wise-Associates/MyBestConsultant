import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mailboxErrorMessage } from './imap-errors'
import { ImapHostError } from './imap-host'
import { parseMailboxInput, passwordProblem } from './mailbox-input'

describe('formulaire d\'une boîte de réception', () => {
  const valid = { host: ' IMAP.Acme.fr ', username: ' recrutement@acme.fr ', password: 'secret', mailbox: '', ownDomains: ' acme.fr, ACME-group.com ,' }

  it('normalise une saisie valide, quelle que soit l\'adresse de la boîte', () => {
    const r = parseMailboxInput(valid)
    assert.ok(r.success, r.success ? '' : r.error)
    assert.deepEqual(r.data, { label: 'recrutement@acme.fr', host: 'imap.acme.fr', username: 'recrutement@acme.fr', password: 'secret', mailbox: 'INBOX', ownDomains: ['acme.fr', 'acme-group.com'] })
  })

  it('prend le domaine de l\'adresse comme domaine de l\'organisation par défaut', () => {
    const r = parseMailboxInput({ ...valid, ownDomains: '' })
    assert.ok(r.success)
    assert.deepEqual(r.data.ownDomains, ['acme.fr'])
  })

  it('refuse un serveur, un identifiant ou un domaine invalides, avec un message pour l\'utilisateur', () => {
    for (const bad of [{ host: '' }, { username: 'x' }, { ownDomains: 'pas un domaine' }, { mailbox: 'a'.repeat(300) }]) {
      const r = parseMailboxInput({ ...valid, ...bad })
      assert.equal(r.success, false, JSON.stringify(bad))
      assert.ok(!r.success && r.error.length > 5)
    }
  })

  it('exige le mot de passe à la création, et quand le serveur ou l\'identifiant changent', () => {
    const existing = { host: 'imap.acme.fr', username: 'recrutement@acme.fr' }
    assert.match(passwordProblem(null, { ...existing, password: '' }) ?? '', /mot de passe/)
    assert.equal(passwordProblem(existing, { ...existing, password: '' }), null, 'modification sans changer de serveur : mot de passe gardé')
    assert.match(passwordProblem(existing, { host: 'imap.evil.example', username: existing.username, password: '' }) ?? '', /mot de passe/)
    assert.match(passwordProblem(existing, { host: existing.host, username: 'autre@acme.fr', password: '' }) ?? '', /mot de passe/)
    assert.equal(passwordProblem(existing, { host: 'imap.evil.example', username: existing.username, password: 'nouveau' }), null)
  })
})

describe('erreurs de connexion affichées', () => {
  it('traduit les échecs courants en messages utiles, sans détail technique', () => {
    assert.match(mailboxErrorMessage(Object.assign(new Error('Command failed'), { authenticationFailed: true })), /mot de passe refusé/)
    assert.match(mailboxErrorMessage(Object.assign(new Error('Command failed'), { serverResponseCode: 'NONEXISTENT' }), 'Offres'), /Dossier « Offres » introuvable/)
    assert.match(mailboxErrorMessage(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })), /certificat/i)
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'EHOSTUNREACH']) {
      assert.match(mailboxErrorMessage(Object.assign(new Error('x'), { code })), /injoignable/, code)
    }
    assert.equal(mailboxErrorMessage(new ImapHostError('Serveur IMAP introuvable : x.example.')), 'Serveur IMAP introuvable : x.example.')
    assert.match(mailboxErrorMessage(new Error('Unsupported state or unable to authenticate data')), /^Connexion impossible/)
  })
})
