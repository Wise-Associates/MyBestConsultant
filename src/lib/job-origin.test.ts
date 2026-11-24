import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aoOfferIdOfJob, jobOriginView, type AoJobOrigin } from './job-origin'

const email: AoJobOrigin['email'] = {
  origin: 'Claire Martin <claire@client-fictif.fr>',
  fromName: 'Marc Exemple',
  fromAddress: 'marc@wise-associates.fr',
  subject: 'AO Data Engineer — réponse sous 5 jours',
  receivedAt: '2026-11-12T09:30:00.000Z',
  attachments: ['offres.xlsx'],
}
const ao = (over: Partial<AoJobOrigin> = {}): AoJobOrigin =>
  ({ kind: 'ao', offerId: 'off1', channel: 'email', veilleSource: '', mailbox: 'Boîte de Magali', email, ...over })
const factsOf = (view: ReturnType<typeof jobOriginView>) => Object.fromEntries(view.facts.map(f => [f.label, f.value]))

describe('origine d\'une offre (page de détail du recruteur)', () => {
  it('reconnaît une offre publiée depuis un appel d\'offres à son identifiant', () => {
    assert.equal(aoOfferIdOfJob('aooff1'), 'off1')
    assert.equal(aoOfferIdOfJob('6745a1b2c3d4e5f6a7b8'), null)
    assert.equal(aoOfferIdOfJob('ao'), null)
  })

  it('donne la boîte, l\'expéditeur d\'origine, qui l\'a transféré, l\'objet et les fichiers joints d\'un e-mail AO', () => {
    const view = jobOriginView(ao())
    assert.equal(view.source, 'Appel d’offres reçu par e-mail')
    assert.deepEqual(factsOf(view), {
      Boîte: 'Boîte de Magali',
      Expéditeur: 'Claire Martin <claire@client-fictif.fr>',
      'Transféré par': 'Marc Exemple',
      Objet: '« AO Data Engineer — réponse sous 5 jours »',
      'Fichiers joints': 'offres.xlsx',
      'Reçu le': '12 nov. 2026',
    })
    assert.equal(view.aoHref, '/recruiter/parametres/boites-ao/off1')
    assert.equal(view.note, '')
  })

  it('omet ce que l\'e-mail n\'a pas, sans valeur vide', () => {
    const view = jobOriginView(ao({ mailbox: '', email: { ...email, origin: '', subject: '', attachments: [], receivedAt: '' } }))
    assert.deepEqual(factsOf(view), { Expéditeur: 'Marc Exemple <marc@wise-associates.fr>' })
  })

  it('borne la liste des fichiers joints', () => {
    const attachments = Array.from({ length: 8 }, (_, i) => `piece-${i + 1}.pdf`)
    const view = jobOriginView(ao({ email: { ...email, attachments } }))
    assert.equal(factsOf(view)['Fichiers joints'], 'piece-1.pdf, piece-2.pdf, piece-3.pdf, piece-4.pdf, piece-5.pdf et 3 autres')
  })

  it('nomme le site d\'une offre relevée par le scraper ou la veille, sans l\'expéditeur technique', () => {
    const scraper = jobOriginView(ao({ channel: 'scraping', veilleSource: 'partenaire-gc' }))
    assert.equal(scraper.source, 'Scraping · Partenaire GC')
    assert.equal(factsOf(scraper).Expéditeur, undefined)
    assert.equal(factsOf(scraper)['Transféré par'], undefined)
    assert.equal(factsOf(scraper)['Fichiers joints'], 'offres.xlsx')
    assert.equal(jobOriginView(ao({ channel: 'scraping', veilleSource: 'boamp-tous-acheteurs' })).source, 'Scraping · BOAMP')
    assert.equal(jobOriginView(ao({ channel: 'scraping', veilleSource: '' })).source, 'Scraping · site non enregistré')
  })

  it('affiche par son identifiant un site de la veille que les règles ne nomment pas', () => {
    assert.equal(jobOriginView(ao({ channel: 'scraping', veilleSource: 'agence-fictive-carrieres' })).source, 'Scraping · agence-fictive-carrieres')
  })

  it('montre l\'expéditeur sans adresse par son nom, et omet une date de réception illisible', () => {
    const view = jobOriginView(ao({ email: { ...email, origin: '', fromName: 'Marc Exemple', fromAddress: '', receivedAt: 'pas une date' } }))
    assert.equal(factsOf(view).Expéditeur, 'Marc Exemple')
    assert.equal(factsOf(view)['Reçu le'], undefined)
  })

  it('ne présente jamais une origine inconnue comme connue', () => {
    const gone = jobOriginView({ kind: 'ao-unavailable' })
    assert.equal(gone.source, 'Appel d’offres')
    assert.match(gone.note, /n’est plus disponible/)
    assert.equal(gone.aoHref, null)
    assert.match(jobOriginView({ kind: 'unreadable' }).source, /illisible/)
    const created = jobOriginView({ kind: 'platform' })
    assert.equal(created.source, 'Créée sur MyBestConsultant')
    assert.match(created.note, /pas enregistré/)
    assert.deepEqual(jobOriginView({ kind: 'shared' }).facts, [])
  })
})
