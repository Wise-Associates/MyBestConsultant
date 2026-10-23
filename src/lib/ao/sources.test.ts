import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ImapHostError, isPublicAddress, resolveImapHost } from './imap-host'
import { canUseAoSourcing, counterIdFor, lockIdFor, PLATFORM_TENANT_ID } from './tenancy'
import { offerFingerprint } from './fingerprint'
import { originalSender, senderCompany } from './origin'

describe('serveur IMAP d\'une organisation', () => {
  it('n\'accepte que des adresses publiques', () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.10', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:a00:1::1', '::7f00:1', '::ffff:0:7f00:1', '64:ff9b:1::a00:1', 'fec0::1']) {
      assert.equal(isPublicAddress(ip), false, ip)
    }
    for (const ip of ['212.227.17.1', '8.8.8.8', '2a00:1450:4007:80f::200e']) assert.equal(isPublicAddress(ip), true, ip)
    assert.equal(isPublicAddress('imap.ionos.fr'), false, 'un nom n\'est pas une adresse')
  })

  const lookupOf = (...addresses: string[]) => async () => addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))

  it('se connecte à l\'adresse vérifiée, le nom ne servant qu\'au certificat', async () => {
    assert.deepEqual(await resolveImapHost(' IMAP.ionos.fr. ', lookupOf('212.227.17.1')), { address: '212.227.17.1', servername: 'imap.ionos.fr' })
  })

  it('refuse une adresse IP écrite, un nom invalide, ou un nom dont une seule adresse est interne', async () => {
    await assert.rejects(resolveImapHost('212.227.17.1', lookupOf('212.227.17.1')), ImapHostError)
    await assert.rejects(resolveImapHost('localhost', lookupOf('127.0.0.1')), ImapHostError)
    await assert.rejects(resolveImapHost('imap.example.com:143', lookupOf('8.8.8.8')), ImapHostError)
    await assert.rejects(resolveImapHost('rebind.example.com', lookupOf('8.8.8.8', '10.0.0.5')), /adresses publiques/)
    await assert.rejects(resolveImapHost('nulle-part.example.com', async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) }), /introuvable/)
  })

  it('abandonne une résolution DNS qui ne répond pas', async () => {
    const never = () => new Promise<never>(() => undefined)
    await assert.rejects(resolveImapHost('lent.example.com', never, 50), /ne répond pas/)
  })
})

describe('organisations', () => {
  it('ouvre la lecture des boîtes à un abonnement actif ou en essai, et toujours à la plateforme', () => {
    assert.equal(canUseAoSourcing(PLATFORM_TENANT_ID, null), true)
    assert.equal(canUseAoSourcing('t1', 'active'), true)
    assert.equal(canUseAoSourcing('t1', 'trialing'), true)
    for (const status of ['past_due', 'suspended', 'cancelled', 'refunded', '', null]) assert.equal(canUseAoSourcing('t1', status), false, String(status))
  })

  it('donne à chaque organisation son verrou et ses compteurs, en identifiants Appwrite valides', () => {
    const day = new Date('2026-10-21T23:30:00Z')
    const long = 'x'.repeat(36)
    for (const id of [
      lockIdFor('t1'), lockIdFor(long), counterIdFor('vision', long, day), counterIdFor('tables', 't1', day), counterIdFor('mailboxTests', 't1', day),
      `${counterIdFor('mailboxTestsAll', 'plateforme', day)}_499`, `${counterIdFor('assistantUser', long, day)}_29`, `${counterIdFor('assistantAll', 'platform', day)}_999`,
    ]) {
      assert.match(id, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/, id)
    }
    const prefixes = (['vision', 'tables', 'mailboxTests', 'mailboxTarget', 'mailboxTestsAll', 'assistantUser', 'assistantAll'] as const).map(c => counterIdFor(c, 't1', day)[0])
    assert.equal(new Set(prefixes).size, prefixes.length, 'un préfixe par compteur')
    assert.notEqual(lockIdFor('t1'), lockIdFor('t2'))
    assert.notEqual(counterIdFor('vision', 't1', day), counterIdFor('vision', 't2', day))
    assert.notEqual(counterIdFor('vision', 't1', day), counterIdFor('vision', 't1', new Date('2026-10-22T00:30:00Z')))
  })

  it('ne rapproche jamais les offres de deux organisations, et garde les empreintes existantes de la plateforme', () => {
    const offer = { title: 'Développeur React', companyName: 'BNP Paribas', location: 'Paris', contractType: 'freelance' as const }
    // Empreinte calculée avant les organisations (valeur figée) : elle ne doit pas changer.
    assert.equal(offerFingerprint(offer, PLATFORM_TENANT_ID), offerFingerprint(offer))
    assert.notEqual(offerFingerprint(offer, 't1'), offerFingerprint(offer, 't2'))
    assert.notEqual(offerFingerprint(offer, 't1'), offerFingerprint(offer, PLATFORM_TENANT_ID))
  })
})

describe('règle « expéditeur d\'origine » propre à chaque organisation', () => {
  const acme = { name: 'Acme Conseil', ownDomains: ['acme.io'] }

  it('écarte les adresses de l\'organisation qui lit la boîte, et seulement elles', () => {
    const forwarded = { fromName: 'Jean Martin', fromAddress: 'j.martin@acme.io', text: 'Pour info\n\nDe : Achats <achats@client-exemple.fr>\nObjet : AO' }
    assert.equal(originalSender(forwarded, acme.ownDomains)?.address, 'achats@client-exemple.fr')
    // Pour une autre organisation, Acme est un expéditeur comme un autre.
    assert.equal(originalSender({ ...forwarded, text: 'AO Java à Lyon' }, ['wise-associates.fr'])?.address, 'j.martin@acme.io')
    assert.equal(originalSender({ ...forwarded, text: 'AO Java à Lyon' }, acme.ownDomains), null)
  })

  it('ne retient jamais le nom de l\'organisation comme client', () => {
    const origin = { name: '', address: 'achats@client-exemple.fr' }
    assert.equal(senderCompany(origin, ['ACME Conseil SAS', 'Acme Conseil'], acme), 'Client Exemple')
  })
})
