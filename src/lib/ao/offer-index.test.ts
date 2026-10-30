import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_AO_FILTERS, type AoFilters } from './filters'
import { indexDocumentOf, indexFilterQueries, senderOf } from './offer-index'
import type { AoOffer } from './types'

const offer = (over: Partial<AoOffer> = {}): AoOffer => ({
  $id: 'o1', createdAt: '2026-10-10T08:00:00.000Z', fingerprint: 'f', emailId: 'e1', status: 'to_review', jobId: null, sourceCount: 1,
  title: 'Développeur React', companyName: 'Client Fictif', location: 'Lyon', contractType: 'freelance', remote: 'hybrid', salary: 550,
  skills: ['React', 'Node.js'], description: 'Mission longue.', duration: '', startDate: '', experience: '',
  ...over,
})

/** Requêtes Appwrite lisibles : { méthode, attribut, valeurs }. */
const queriesOf = (tenantId: string, over: Partial<AoFilters> = {}) =>
  indexFilterQueries(tenantId, { ...EMPTY_AO_FILTERS, ...over }).map(q => JSON.parse(q) as { method: string; attribute: string; values: unknown[] })

describe('index de la liste des offres AO', () => {
  it('limite toujours la liste à l\'organisation de l\'appelant, en premier', () => {
    assert.deepEqual(queriesOf('org-a'), [{ method: 'equal', attribute: 'tenantId', values: ['org-a'] }])
    const withFilters = queriesOf('org-a', { q: 'react', status: 'published' })
    assert.deepEqual(withFilters[0], { method: 'equal', attribute: 'tenantId', values: ['org-a'] })
    assert.equal(withFilters.filter(q => q.attribute === 'tenantId').length, 1)
  })

  it('traduit chaque filtre en requête, sans requête pour un champ vide', () => {
    const queries = queriesOf('admin', {
      q: '  data  ', status: 'to_review', contractType: 'cdi', remote: 'remote', city: 'Paris', skill: 'java', sender: 'esn',
      salaryMin: 400, salaryMax: 700, from: '2026-10-01', to: '2026-10-31',
    })
    assert.deepEqual(queries.slice(1), [
      { method: 'equal', attribute: 'status', values: ['to_review'] },
      { method: 'equal', attribute: 'contractType', values: ['cdi'] },
      { method: 'equal', attribute: 'remote', values: ['remote'] },
      { method: 'contains', attribute: 'search', values: ['data'] },
      { method: 'contains', attribute: 'city', values: ['Paris'] },
      { method: 'contains', attribute: 'skills', values: ['java'] },
      { method: 'contains', attribute: 'sender', values: ['esn'] },
      { method: 'greaterThanEqual', attribute: 'salary', values: [400] },
      { method: 'lessThanEqual', attribute: 'salary', values: [700] },
      { method: 'greaterThanEqual', attribute: 'receivedAt', values: ['2026-10-01T00:00:00.000Z'] },
      // « au 31/10 » inclus : jusqu'au 1er novembre à minuit exclu (changement de mois compris).
      { method: 'lessThan', attribute: 'receivedAt', values: ['2026-11-01T00:00:00.000Z'] },
    ])
    assert.deepEqual(queriesOf('admin', { q: '   ', city: '' }).length, 1)
  })

  it('reprend dans la ligne d\'index ce que filtre la page : statut, contrat, montant, ville, compétences, expéditeur, texte', () => {
    const doc = indexDocumentOf(offer(), {
      tenantId: 'admin', receivedAt: '2026-10-12T09:00:00.000Z', subject: 'AO React Lyon', sender: { name: 'Claire Martin', address: 'claire@client-fictif.fr' },
    })
    assert.deepEqual({ ...doc, search: undefined }, {
      tenantId: 'admin', status: 'to_review', contractType: 'freelance', remote: 'hybrid', salary: 550, receivedAt: '2026-10-12T09:00:00.000Z',
      sourceCount: 1, city: 'Lyon', skills: 'React | Node.js', sender: 'Claire Martin claire@client-fictif.fr', search: undefined,
    })
    for (const text of ['Développeur React', 'Client Fictif', 'AO React Lyon', 'Node.js', 'Mission longue.']) assert.ok(doc.search.includes(text), text)
  })

  it('borne les champs à la taille de leurs attributs et date l\'offre à sa création sans e-mail connu', () => {
    const doc = indexDocumentOf(offer({ description: 'x'.repeat(30_000), skills: Array.from({ length: 10 }, (_, i) => `compétence-${i}-${'y'.repeat(120)}`) }),
      { tenantId: 'admin', receivedAt: '', subject: '', sender: { name: '', address: '' } })
    assert.equal(doc.search.length, 25_000)
    assert.equal(doc.skills.length, 1000)
    assert.equal(doc.receivedAt, '2026-10-10T08:00:00.000Z')
  })

  it('prend l\'expéditeur du message d\'origine d\'un e-mail transféré, sinon celui de l\'e-mail', () => {
    assert.deepEqual(senderOf({ origin: 'Claire Martin <claire@client-fictif.fr>', fromName: 'Marc', fromAddress: 'marc@wise-associates.fr' }),
      { name: 'Claire Martin', address: 'claire@client-fictif.fr' })
    assert.deepEqual(senderOf({ origin: '', fromName: 'Marc', fromAddress: 'marc@wise-associates.fr' }), { name: 'Marc', address: 'marc@wise-associates.fr' })
  })
})
