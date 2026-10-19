import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseOffersJson, TruncatedAnswerError } from './parse'
import { cityKey, offerFingerprint, titleKey } from './fingerprint'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, scrubContacts, toPublicOffer } from './anonymize'
import { zipUncompressedSize } from './extract'
import { batchByLength, nextStepFor } from './repo'
import { AO_EXCEL_HEADERS, buildAoWorkbook } from './excel'
import { EMPTY_AO_FILTERS, filterAoOffers, filtersFromSearchParams, filtersToSearchParams, type AoFilters, type AoOfferRow } from './filters'
import type { AoEmail, AoOfferFields } from './types'

const offer = (over: Partial<AoOfferFields> = {}): AoOfferFields => ({
  title: 'Développeur Fullstack React (H/F)',
  companyName: 'BNP Paribas',
  location: 'Paris 15e (75015)',
  contractType: 'freelance',
  remote: 'hybrid',
  salary: 550,
  skills: ['React', 'Node.js'],
  description: 'Au sein de BNP Paribas, vous développerez de nouvelles fonctionnalités.',
  duration: '6 mois renouvelables',
  startDate: '01/09/2026',
  experience: '5 ans minimum',
  ...over,
})

describe('parseOffersJson', () => {
  it('lit un tableau entouré de texte ou de balises markdown', () => {
    const { offers } = parseOffersJson('Voici :\n```json\n[{"title":"Chef de projet","contractType":"freelance","remote":"remote","salary":"600 €/j","skills":"Java, Spring; Kafka"}]\n```')
    assert.equal(offers.length, 1)
    assert.equal(offers[0].contractType, 'freelance')
    assert.equal(offers[0].remote, 'remote')
    assert.equal(offers[0].salary, 600)
    assert.deepEqual(offers[0].skills, ['Java', 'Spring', 'Kafka'])
  })

  it('écarte les éléments sans titre et compte les rejets', () => {
    const { offers, rejected } = parseOffersJson('[{"title":""},{"companyName":"X"},"texte",{"title":"Data engineer"}]')
    assert.deepEqual(offers.map(o => o.title), ['Data engineer'])
    assert.equal(rejected, 3)
  })

  it('normalise les valeurs inattendues au lieu de les publier telles quelles', () => {
    const { offers } = parseOffersJson('[{"title":"PO","contractType":"CDI temps plein","remote":"100% télétravail","salary":-3,"skills":["a","a","b"]}]')
    assert.equal(offers[0].contractType, 'cdi')
    assert.equal(offers[0].remote, 'remote')
    assert.equal(offers[0].salary, null)
    assert.deepEqual(offers[0].skills, ['a', 'b'])
  })

  it('refuse une réponse sans tableau JSON (l\'e-mail sera réessayé)', () => {
    assert.throws(() => parseOffersJson('Désolé, je ne peux pas.'), /aucun tableau JSON/)
  })
})

describe('offerFingerprint', () => {
  it('identifie la même offre malgré la casse, les accents, « H/F » et l\'ordre des mots', () => {
    const a = offerFingerprint(offer())
    const b = offerFingerprint(offer({ title: 'FULLSTACK developpeur react', companyName: 'BNP PARIBAS SA', location: 'PARIS - La Défense' }))
    assert.equal(a, b)
  })

  it('distingue une autre ville, un autre client ou un autre contrat', () => {
    const base = offerFingerprint(offer())
    assert.notEqual(offerFingerprint(offer({ location: 'Lyon' })), base)
    assert.notEqual(offerFingerprint(offer({ companyName: 'AXA' })), base)
    assert.notEqual(offerFingerprint(offer({ contractType: 'cdi' })), base)
  })

  it('garde les communes composées entières', () => {
    assert.equal(cityKey('Saint-Denis (93)'), 'saint denis')
    assert.equal(cityKey('Paris 8e'), 'paris')
    assert.equal(titleKey('Chef de projet H/F'), 'chef projet')
  })
})

describe('anonymisation', () => {
  it('retire e-mails (même déguisés), téléphones, liens et lignes de contact', () => {
    const out = scrubContacts(
      'Mission chez nous.\nContact : Marie Dupont\nTél. : 06 12 34 56 78\nÉcrire à marie.dupont@esn.fr, jean [at] esn [dot] fr ou +33 1 23 45 67 89\nDétails : https://esn.fr/ao/42',
      [],
    )
    assert.doesNotMatch(out, /Marie|06 12|@|\[at\]|jean|\+33|https?:/)
    assert.match(out, /Mission chez nous\./)
  })

  it('masque le client quelles que soient la casse, les accents, la forme juridique ou le sigle', () => {
    const names = namesToHide('Société Générale SA (SG)')
    const out = scrubContacts('SOCIETE GENERALE recrute ; la Société-Générale et SG cherchent. Le SGBD reste.', names, 'Grand compte – Banque')
    assert.equal(out, 'Grand compte – Banque recrute ; la Grand compte – Banque et Grand compte – Banque cherchent. Le SGBD reste.')
  })

  it('masque aussi l\'expéditeur (nom de deux mots ou plus, domaine) mais pas une messagerie publique', () => {
    const names = namesToHide('', { name: 'Marie Dupont', address: 'marie@esn-conseil.fr' })
    assert.equal(scrubContacts('Envoyé par Marie Dupont pour ESN Conseil.', names, 'X'), 'Envoyé par X pour X.')
    assert.deepEqual(namesToHide('', { name: 'Recrutement', address: 'ao.client@gmail.com' }), [])
  })

  it('détecte un libellé qui révèle le client', () => {
    const names = namesToHide('BNP Paribas')
    assert.equal(revealsName('Groupe bnp-paribas', names), true)
    assert.equal(revealsName('Grand compte – Banque', names), false)
  })

  it('produit la version publique : titre, description, ville et compétences nettoyés', () => {
    const pub = toPublicOffer(
      offer({ title: 'Dev React BNP Paribas', location: 'Siège BNP Paribas, Paris', skills: ['React', 'Outils BNP Paribas'] }),
      namesToHide('BNP Paribas'),
    )
    assert.equal(pub.companyName, DEFAULT_CLIENT_LABEL)
    for (const text of [pub.title, pub.description, pub.location, ...pub.skills]) assert.doesNotMatch(text, /BNP/i)
    assert.deepEqual(pub.skills, ['React'])
    assert.match(pub.description, /Durée de la mission : 6 mois renouvelables/)
    assert.match(pub.description, /Démarrage : 01\/09\/2026/)
    assert.match(pub.description, /Expérience requise : 5 ans minimum/)
  })
})

describe('robustesse de la lecture', () => {
  it('retire les chevrons des champs courts (titre, ville…) renvoyés par l\'IA', () => {
    const { offers } = parseOffersJson('[{"title":"Dev <b>React</b>","location":"Paris </script><script>x()</script>"}]')
    assert.doesNotMatch(offers[0].title + offers[0].location, /[<>]/)
  })

  it('reconnaît une réponse IA coupée (inutile de la redemander)', () => {
    assert.throws(() => parseOffersJson('[{"title":"A","skills":["x"]},{"title":"B","descr'), TruncatedAnswerError)
    assert.doesNotThrow(() => parseOffersJson('[{"title":"Data engineer"}] Voilà les offres.'))
  })

  it('découpe les Message-ID en requêtes de moins de 4096 caractères', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `<CAF${'x'.repeat(60)}${i}@mail.gmail.com>`)
    const batches = batchByLength(ids)
    assert.deepEqual(batches.flat(), ids)
    for (const batch of batches) assert.ok(JSON.stringify(batch).length < 4096)
  })

  it('réessaie 3 fois au plus, et reprend un traitement interrompu', () => {
    const now = new Date('2026-10-19T12:00:00Z')
    const email = (status: AoEmail['status'], attempts: number, minutesAgo: number): AoEmail => ({
      $id: 'e', messageId: 'm', uid: 1, fromAddress: '', fromName: '', subject: '', receivedAt: '', attachments: [],
      status, error: '', offerCount: 0, duplicateCount: 0, attempts, updatedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    })
    assert.equal(nextStepFor(email('processed', 1, 60), now), 'skip')
    assert.equal(nextStepFor(email('failed', 2, 1), now), 'retry')
    assert.equal(nextStepFor(email('failed', 3, 1), now), 'skip')
    assert.equal(nextStepFor(email('processing', 1, 5), now), 'skip') // en cours dans un autre passage
    assert.equal(nextStepFor(email('processing', 1, 30), now), 'retry') // interrompu
    assert.equal(nextStepFor(email('processing', 3, 30), now), 'abandon')
  })

  it('mesure la taille décompressée d\'une archive Office sans la décompresser', () => {
    // Classeur réécrit avec compression (SheetJS n'en met pas par défaut) : taille réelle > taille du fichier.
    const book = XLSX.read(buildAoWorkbook([offer()]), { type: 'buffer' })
    const xlsx = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
    const size = zipUncompressedSize(xlsx)
    assert.ok(size > xlsx.length && size < 1_000_000, `taille lue : ${size}`)
    assert.equal(zipUncompressedSize(Buffer.from('pas une archive')), Infinity)
  })
})

describe('filtres', () => {
  const row = (over: Partial<AoOfferRow> = {}): AoOfferRow => ({
    ...offer(), $id: 'o1', createdAt: '2026-10-10T08:00:00.000Z', fingerprint: 'f', emailId: 'e1', status: 'to_review',
    jobId: null, sourceCount: 1, senderAddress: 'ao@esn.fr', senderName: 'ESN Conseil', subject: 'AO React', receivedAt: '2026-10-10T08:00:00.000Z',
    ...over,
  })
  const rows = [row(), row({ $id: 'o2', location: 'Lyon', contractType: 'cdi', salary: 55000, status: 'published', receivedAt: '2026-10-15T08:00:00.000Z' })]

  it('combine les critères (ville sans accents, contrat, statut, montant, dates)', () => {
    const f = (over: Partial<AoFilters>) => filterAoOffers(rows, { ...EMPTY_AO_FILTERS, ...over }).map(r => r.$id)
    assert.deepEqual(f({ city: 'LYON' }), ['o2'])
    assert.deepEqual(f({ contractType: 'freelance' }), ['o1'])
    assert.deepEqual(f({ status: 'published' }), ['o2'])
    assert.deepEqual(f({ salaryMin: 600 }), ['o2'])
    assert.deepEqual(f({ from: '2026-10-11' }), ['o2'])
    assert.deepEqual(f({ to: '2026-10-10' }), ['o1'])
    assert.deepEqual(f({ q: 'developpeur', sender: 'esn conseil' }), ['o1', 'o2'])
    assert.deepEqual(f({ skill: 'node' }), ['o1', 'o2'])
  })

  it('fait l\'aller-retour avec l\'URL d\'export et ignore les valeurs invalides', () => {
    const f: AoFilters = { ...EMPTY_AO_FILTERS, q: 'java', status: 'to_review', contractType: 'freelance', salaryMin: 400, from: '2026-10-01' }
    assert.deepEqual(filtersFromSearchParams(filtersToSearchParams(f)), f)
    const bad = filtersFromSearchParams(new URLSearchParams('status=hacked&contract=x&min=-5&from=2026/10/01'))
    assert.deepEqual(bad, EMPTY_AO_FILTERS)
  })
})

describe('export Excel', () => {
  it('reprend exactement les colonnes du modèle d\'import et écrit les cellules en texte', () => {
    const buffer = buildAoWorkbook([offer({ description: '=HYPERLINK("http://x")' })])
    const book = XLSX.read(buffer, { type: 'buffer' })
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets['AO Offers'], { header: 1 })
    assert.deepEqual(rows[0], [...AO_EXCEL_HEADERS])
    assert.equal(rows[1][0], 'Développeur Fullstack React (H/F)')
    assert.equal(rows[1][5], 550)
    assert.equal(book.Sheets['AO Offers'].H2.f, undefined) // pas de formule
  })
})
