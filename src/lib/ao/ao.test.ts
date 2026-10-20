import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseOffersJson, TruncatedAnswerError } from './parse'
import { cityKey, offerFingerprint, titleKey } from './fingerprint'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, scrubContacts, toPublicOffer } from './anonymize'
import { handledUidsOf, nextCheckpoint, planRead, type Checkpoint } from './checkpoint'
import { readAttachments } from './extractors/chain'
import { zipFitsWithin } from './extractors/office'
import { RetryLater, SkipAttachment, formatOf, type Attachment, type AttachmentExtractor } from './extractors/types'
import { visionBlockFor } from './extractors/vision'
import { batchByLength, nextStepFor } from './repo'
import { AO_EXCEL_HEADERS, buildAoWorkbook } from './excel'
import { EMPTY_AO_FILTERS, filterAoOffers, filtersFromSearchParams, filtersToSearchParams, type AoFilters, type AoOfferRow } from './filters'
import { descriptionForPublication } from '../description-sections'
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

  it('met en forme la description à publier après l\'anonymisation, sans réintroduire de contact', () => {
    const description = 'Contexte : refonte du SI de BNP Paribas pour les équipes de gestion des comptes.\n**Contact :** Marie Dupont\n\nMissions principales :\n- Développer les API ;'
    const text = descriptionForPublication(toPublicOffer(offer({ description }), namesToHide('BNP Paribas')).description)
    assert.doesNotMatch(text, /Marie|BNP/)
    assert.match(text, /^### Contexte\nRefonte du SI de Client confidentiel/)
    assert.match(text, /### Missions principales\n- Développer les API\n\nDurée de la mission : 6 mois renouvelables\n\nDémarrage : 01\/09\/2026\n\nExpérience requise : 5 ans minimum$/)
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

  it('vérifie la taille réelle d\'une archive Office, sans croire les tailles qu\'elle annonce', () => {
    // Classeur réécrit avec compression (SheetJS n'en met pas par défaut).
    const book = XLSX.read(buildAoWorkbook([offer()]), { type: 'buffer' })
    const xlsx = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer
    assert.equal(zipFitsWithin(xlsx, 1_000_000), true)
    assert.equal(zipFitsWithin(xlsx, 1_000), false)
    // Archive qui ment : on réécrit à 1 octet chaque taille décompressée du répertoire central.
    const lying = Buffer.from(xlsx)
    for (let i = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
      lying.writeUInt32LE(1, i + 24)
    }
    assert.equal(zipFitsWithin(lying, 1_000), false)
    assert.equal(zipFitsWithin(Buffer.from('pas une archive'), 1_000_000), false)
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

describe('point de reprise de la boîte', () => {
  const now = new Date('2026-10-19T12:00:00Z')
  const cp = (over: Partial<Checkpoint> = {}): Checkpoint => ({ uidValidity: '7', lastUid: 100, reconciledAt: '2026-10-19T06:00:00Z', ...over })

  it('lit seulement le courrier nouveau entre deux rattrapages', () => {
    assert.deepEqual(planRead(cp(), '7', now), { mode: 'incremental', afterUid: 100 })
  })

  it('rattrape 7 jours au premier passage, après 24 h, ou si la boîte a été reconstruite', () => {
    for (const plan of [planRead(null, '7', now), planRead(cp({ reconciledAt: '2026-10-18T11:00:00Z' }), '7', now), planRead(cp(), '8', now), planRead(cp({ reconciledAt: null }), '7', now)]) {
      assert.equal(plan.mode, 'reconcile')
      if (plan.mode === 'reconcile') assert.equal(plan.since.toISOString(), '2026-10-12T12:00:00.000Z')
    }
  })

  it('n\'avance jamais au-delà du premier message laissé pour plus tard', () => {
    const plan = { mode: 'incremental' as const, afterUid: 100 }
    assert.equal(nextCheckpoint(cp(), '7', plan, [101, 102, 105], new Set([101, 102, 105]), 106, now).lastUid, 105)
    assert.equal(nextCheckpoint(cp(), '7', plan, [101, 102, 105], new Set([101, 105]), 106, now).lastUid, 101)
    assert.equal(nextCheckpoint(cp(), '7', plan, [], new Set(), 101, now).lastUid, 100)
  })

  it('ne date le rattrapage que s\'il est allé au bout, et repart de zéro sur une nouvelle boîte', () => {
    const plan = { mode: 'reconcile' as const, since: new Date('2026-10-12T12:00:00Z') }
    assert.equal(nextCheckpoint(cp(), '7', plan, [90, 95], new Set([90, 95]), 101, now).reconciledAt, now.toISOString())
    assert.equal(nextCheckpoint(cp(), '7', plan, [90, 95], new Set([90]), 101, now).reconciledAt, null)
    assert.deepEqual(nextCheckpoint(cp(), '8', plan, [3, 4], new Set([3, 4]), 5, now), { uidValidity: '8', lastUid: 4, reconciledAt: now.toISOString() })
  })

  it('compte ensemble deux copies d\'un même message, sans bloquer le point de reprise', () => {
    const candidates = [{ uid: 101, messageId: '<a@x>' }, { uid: 102, messageId: '<a@x>' }, { uid: 103, messageId: '<b@x>' }]
    const handled = handledUidsOf(candidates, new Set(['<a@x>', '<b@x>']))
    const next = nextCheckpoint(cp(), '7', { mode: 'incremental', afterUid: 100 }, candidates.map(c => c.uid), handled, 104, now)
    assert.equal(next.lastUid, 103)
  })

  it('après un premier rattrapage sans courrier récent, ne relit pas tout l\'historique de la boîte', () => {
    const plan = { mode: 'reconcile' as const, since: new Date('2026-10-12T12:00:00Z') }
    const first = nextCheckpoint(null, '7', plan, [], new Set(), 4513, now)
    assert.equal(first.lastUid, 4512)
    assert.deepEqual(planRead(first, '7', new Date(now.getTime() + 60_000)), { mode: 'incremental', afterUid: 4512 })
  })
})

describe('chaîne de lecture des pièces jointes', () => {
  const file = (filename: string): Attachment => ({ filename, contentType: '', content: Buffer.from('x') })
  const ctx = () => ({ deadline: Date.now() + 60_000, canDefer: true, reserveVisionCall: async () => true })
  const extractor = (name: string, exts: string[], read: AttachmentExtractor['read']): AttachmentExtractor =>
    ({ name, canRead: f => exts.some(e => f.filename.endsWith(e)), read })

  it('passe à l\'extracteur suivant quand le premier ne rend rien (PDF scanné)', async () => {
    const text = extractor('texte', ['.pdf'], async () => '')
    const vision = extractor('vision', ['.pdf', '.png'], async () => 'Développeur Java — Paris')
    const { parts, skipped } = await readAttachments([file('ao.pdf'), file('photo.png'), file('a.zip')], ctx(), [text, vision])
    assert.deepEqual(parts.map(p => [p.filename, p.via]), [['ao.pdf', 'vision'], ['photo.png', 'vision']])
    assert.deepEqual(skipped, ['a.zip (format non lu)'])
  })

  it('garde la raison de l\'abandon et continue malgré un fichier qui fait planter un lecteur', async () => {
    const broken = extractor('texte', ['.docx'], async () => { throw new Error('zip corrompu') })
    const refused = extractor('vision', ['.png'], async () => { throw new SkipAttachment('image de plus de 5 Mo') })
    const ok = extractor('texte', ['.txt'], async () => 'Mission data')
    const { parts, skipped } = await readAttachments([file('a.docx'), file('b.png'), file('c.txt')], ctx(), [broken, refused, ok])
    assert.deepEqual(skipped, ['a.docx (illisible)', 'b.png (image de plus de 5 Mo)'])
    assert.deepEqual(parts.map(p => p.filename), ['c.txt'])
  })

  it('fait remonter un échec passager pour que tout l\'e-mail soit repris', async () => {
    const busy = extractor('vision', ['.png'], async () => { throw new RetryLater('saturé') })
    await assert.rejects(readAttachments([file('photo.png')], ctx(), [busy]), RetryLater)
  })

  it('reconnaît le format par le type MIME quand le nom n\'a pas d\'extension', () => {
    assert.equal(formatOf({ filename: 'piece-jointe', contentType: 'application/pdf' }), 'pdf')
    assert.equal(formatOf({ filename: 'scan', contentType: 'image/JPEG; name=scan' }), 'jpg')
    assert.equal(formatOf({ filename: 'offre.docx', contentType: 'application/octet-stream' }), 'docx')
    assert.equal(formatOf({ filename: 'x', contentType: '' }), '')
  })

  it('prépare le bon bloc pour Claude selon le format', () => {
    assert.equal(visionBlockFor(file('ao.PDF'))?.type, 'document')
    const image = visionBlockFor(file('scan.jpg'))
    assert.ok(image?.type === 'image' && image.source.type === 'base64' && image.source.media_type === 'image/jpeg')
    assert.equal(visionBlockFor(file('ao.docx')), null)
  })
})

