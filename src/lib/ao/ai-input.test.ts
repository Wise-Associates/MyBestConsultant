import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanedAo, hiddenNamesOf, publicationAiRequest } from './ai-input'
import type { AoEmail, AoOfferFields } from './types'

// Données fictives : client, intermédiaire et personnes inventés.
const offer: AoOfferFields = {
  title: 'Développeur Java (H/F) - Banque Exemple', companyName: 'Banque Exemple SA (BEX)', location: 'Paris - siège BEX', contractType: 'mission',
  remote: 'hybrid', salary: 600, skills: ['Java', 'Outil BEX'], duration: '6 mois', startDate: 'ASAP', experience: '5 ans chez Banque Exemple',
  description: 'Pour BEX, contactez Marie Dupont au 06 12 34 56 78 ou marie.dupont@banque-exemple.test.\n### Profil\n- 5 ans',
}
const email: Pick<AoEmail, 'fromName' | 'fromAddress' | 'origin' | 'citedClients'> = {
  fromName: 'Martin, Jean', fromAddress: 'jean.martin@intermediaire-exemple.test',
  origin: 'Marie Dupont <marie.dupont@banque-exemple.test>', citedClients: ['Groupe Assurance Fictive'],
}

describe('hiddenNamesOf', () => {
  it('client de l’offre et clients cités, expéditeurs (deux ordres du nom) et interlocuteur', () => {
    const hidden = hiddenNamesOf({
      companyName: offer.companyName, email, contact: { name: 'Paul Contact', role: 'Acheteur', email: 'paul@banque-exemple.test', phone: '' }, ownDomains: [],
    })
    assert.deepEqual(hidden.clients, ['Banque Exemple SA (BEX)', 'Groupe Assurance Fictive'])
    const names = hidden.names.map(n => n.join(' '))
    for (const name of ['banque exemple', 'bex', 'groupe assurance fictive', 'martin jean', 'jean martin', 'marie dupont', 'paul contact']) {
      assert.ok(names.includes(name), name)
    }
    assert.deepEqual(hidden.people.map(n => n.join(' ')).sort(), ['jean martin', 'marie dupont', 'martin jean', 'paul contact'])
  })

  it('domaines de l’organisation jamais masqués', () => {
    const own = hiddenNamesOf({ companyName: '', email, contact: null, ownDomains: ['intermediaire-exemple.test'] })
    const other = hiddenNamesOf({ companyName: '', email, contact: null, ownDomains: [] })
    assert.ok(other.names.some(n => n.join(' ').includes('intermediaire')))
    assert.ok(!own.names.some(n => n.join(' ').includes('intermediaire')))
  })

  it('e-mail introuvable : le client de l’offre seul', () => {
    const hidden = hiddenNamesOf({ companyName: 'Banque Exemple', email: undefined, contact: undefined, ownDomains: [] })
    assert.deepEqual(hidden, { clients: ['Banque Exemple'], names: [['banque', 'exemple']], people: [] })
  })
})

describe('cleanedAo et publicationAiRequest', () => {
  const { clients, names } = hiddenNamesOf({ companyName: offer.companyName, email, contact: null, ownDomains: [] })

  it('critères : intitulé, description, compétences, lieu et expérience aux noms remplacés, coordonnées retirées', () => {
    const cleaned = cleanedAo(offer, names)
    assert.equal(cleaned.title, 'Développeur Java (H/F) - le client')
    assert.equal(cleaned.location, 'Paris - siège le client')
    assert.deepEqual(cleaned.skills, ['Java', 'Outil le client'])
    assert.equal(cleaned.experience, '5 ans chez le client')
    assert.ok(!/Dupont|06 12|@/.test(cleaned.description))
  })

  it('version publiée : intitulé, lieu et description nettoyés, le reste tel que reçu, clients à ne jamais citer', () => {
    const request = publicationAiRequest(offer, clients, names)
    const lines = request.split('\n')
    assert.deepEqual(lines.slice(0, 8), [
      'Intitulé : Développeur Java (H/F) - le client',
      'Lieu : Paris - siège le client',
      'Durée : 6 mois',
      'Démarrage : ASAP',
      'Expérience : 5 ans chez Banque Exemple',
      'Compétences : Java, Outil BEX',
      'Clients à ne jamais citer, ni eux ni leurs sigles : Banque Exemple SA (BEX), Groupe Assurance Fictive',
      'Description :',
    ])
    assert.ok(!/Dupont|06 12|@/.test(request))
  })
})
