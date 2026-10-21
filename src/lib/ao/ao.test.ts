import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseOffersJson, TruncatedAnswerError } from './parse'
import { emailDeadline } from './dates'

const RECEIVED = new Date('2026-10-21T09:00:00Z')
import { cityKey, offerFingerprint, titleKey } from './fingerprint'
import { DEFAULT_CLIENT_LABEL, namesToHide, revealsName, scrubContacts, toPublicOffer } from './anonymize'
import Anthropic from '@anthropic-ai/sdk'
import { LLMChainError, LLMHttpError, LLMNotConfiguredError, LLMUnreachableError } from '@/lib/ai/llm-router'
import { claudeProblem, llmUnavailableReason, openAiProblem } from './ai-failures'
import { handledUidsOf, nextCheckpoint, planRead, processingOrder, type Checkpoint } from './checkpoint'
import { readAttachments } from './extractors/chain'
import { zipFitsWithin } from './extractors/office'
import { AiUnavailable, RetryLater, SkipAttachment, formatOf, type Attachment, type AttachmentExtractor, type ExtractionContext } from './extractors/types'
import { readWithFallback, visionBlockFor, type VisionReader } from './extractors/vision'
import { openAiContentPart, transcribeWithOpenAI } from './extractors/vision-openai'
import { batchByLength, nextStepFor } from './repo'
import { citedClients, companyFromDomain, formatSender, originalSender, parseSender, senderCompany, type Organization, type Sender } from './origin'

const WISE: Organization = { name: 'Wise Associates', ownDomains: ['wise-associates.fr'] }
import { attemptsAfterFailure, canDeferEmail, manualRetryPatch } from './attempts'
import { AO_EXCEL_HEADERS, buildAoWorkbook } from './excel'
import { buildEmailContent } from './extract'
import { MAX_TABLE_ROWS, readTableAttachment, tableOffersOf } from './spreadsheet'
import { EMPTY_AO_FILTERS, filterAoOffers, filtersFromSearchParams, filtersToSearchParams, type AoFilters, type AoOfferRow } from './filters'
import { descriptionForPublication } from '../description-sections'
import type { AoEmail, ExtractedOffer } from './types'

const offer = (over: Partial<ExtractedOffer> = {}): ExtractedOffer => ({
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
  deadline: '30/10/2026',
  endClient: '',
  engagement: 'assistance',
  technologies: ['TypeScript', 'AWS'],
  experience: '5 ans minimum',
  ...over,
})

describe('parseOffersJson', () => {
  it('garde la date limite de réponse à part de la date de démarrage', () => {
    const { offers } = parseOffersJson('[{"title":"Data engineer","startDate":"","deadline":"30/10/2026","endClient":"BNP Paribas"}]', RECEIVED)
    assert.equal(offers[0].deadline, '30/10/2026')
    assert.equal(offers[0].endClient, 'BNP Paribas')
    assert.equal(offers[0].startDate, '')
  })

  it('classe les dates sans libellé de la réponse de l\'IA selon leur jour (lundi : démarrage, vendredi : date limite)', () => {
    const { offers } = parseOffersJson('[{"title":"Chef de projet","otherDates":["30/10/2026","lundi 2 novembre"]},{"title":"PO","startDate":"vendredi 06/11/2026","otherDates":["09/11/2026"]}]', RECEIVED)
    assert.deepEqual(offers.map(o => [o.startDate, o.deadline]), [['lundi 2 novembre', '30/10/2026'], ['vendredi 06/11/2026', '']])
    assert.ok(!('otherDates' in offers[0]), 'la liste brute ne sort pas de la lecture')
  })

  it('garde sur l\'e-mail la date limite la plus proche de ses offres', () => {
    assert.equal(emailDeadline(['', '15/11/2026', '30/10/2026', '2026-11-02'], RECEIVED), '30/10/2026')
    assert.equal(emailDeadline(['fin octobre', '31.10.26'], RECEIVED), '31.10.26')
    assert.equal(emailDeadline(['fin octobre', 'ASAP'], RECEIVED), 'fin octobre')
    assert.equal(emailDeadline(['', '  '], RECEIVED), '')
  })

  it('lit un tableau entouré de texte ou de balises markdown', () => {
    const { offers } = parseOffersJson('Voici :\n```json\n[{"title":"Chef de projet","contractType":"freelance","remote":"remote","salary":"600 €/j","skills":"Java, Spring; Kafka"}]\n```', RECEIVED)
    assert.equal(offers.length, 1)
    assert.equal(offers[0].contractType, 'freelance')
    assert.equal(offers[0].remote, 'remote')
    assert.equal(offers[0].salary, 600)
    assert.deepEqual(offers[0].skills, ['Java', 'Spring', 'Kafka'])
  })

  it('écarte les éléments sans titre et compte les rejets', () => {
    const { offers, rejected } = parseOffersJson('[{"title":""},{"companyName":"X"},"texte",{"title":"Data engineer"}]', RECEIVED)
    assert.deepEqual(offers.map(o => o.title), ['Data engineer'])
    assert.equal(rejected, 3)
  })

  it('normalise les valeurs inattendues au lieu de les publier telles quelles', () => {
    const { offers } = parseOffersJson('[{"title":"PO","contractType":"CDI temps plein","remote":"100% télétravail","salary":-3,"skills":["a","a","b"]}]', RECEIVED)
    assert.equal(offers[0].contractType, 'cdi')
    assert.equal(offers[0].remote, 'remote')
    assert.equal(offers[0].salary, null)
    assert.deepEqual(offers[0].skills, ['a', 'b'])
  })

  it('refuse une réponse sans tableau JSON (l\'e-mail sera réessayé)', () => {
    assert.throws(() => parseOffersJson('Désolé, je ne peux pas.', RECEIVED), /aucun tableau JSON/)
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
    const names = namesToHide(['Société Générale SA (SG)'])
    const out = scrubContacts('SOCIETE GENERALE recrute ; la Société-Générale et SG cherchent. Le SGBD reste.', names, 'Grand compte – Banque')
    assert.equal(out, 'Grand compte – Banque recrute ; la Grand compte – Banque et Grand compte – Banque cherchent. Le SGBD reste.')
  })

  it('masque aussi l\'expéditeur (nom de deux mots ou plus, domaine) mais pas une messagerie publique', () => {
    const names = namesToHide([], [{ name: 'Marie Dupont', address: 'marie@esn-conseil.fr' }])
    assert.equal(scrubContacts('Envoyé par Marie Dupont pour ESN Conseil.', names, 'X'), 'Envoyé par X pour X.')
    assert.deepEqual(namesToHide([], [{ name: 'Recrutement', address: 'ao.client@gmail.com' }]), [])
  })

  it('masque aussi l\'expéditeur d\'origine d\'un e-mail transféré', () => {
    const names = namesToHide([], [{ name: 'Camille Martin', address: 'c.martin@wise-associates.fr' }, { name: 'Dupont, Marie', address: 'marie.dupont@client-exemple.co.uk' }], WISE.ownDomains)
    assert.equal(scrubContacts('Envoyé par Marie Dupont (Dupont, Marie) pour Client Exemple.', names, 'X'), 'Envoyé par X (X) pour X.')
  })

  it('détecte un libellé qui révèle le client', () => {
    const names = namesToHide(['BNP Paribas'])
    assert.equal(revealsName('Groupe bnp-paribas', names), true)
    assert.equal(revealsName('Grand compte – Banque', names), false)
  })

  it('produit la version publique : titre, description, ville et compétences nettoyés', () => {
    const pub = toPublicOffer(
      offer({ title: 'Dev React BNP Paribas', location: 'Siège BNP Paribas, Paris', skills: ['React', 'Outils BNP Paribas'] }),
      namesToHide(['BNP Paribas']),
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
    const text = descriptionForPublication(toPublicOffer(offer({ description }), namesToHide(['BNP Paribas'])).description)
    assert.doesNotMatch(text, /Marie|BNP/)
    assert.match(text, /^### Contexte\nRefonte du SI de Client confidentiel/)
    assert.match(text, /### Missions principales\n- Développer les API\n\nDurée de la mission : 6 mois renouvelables\n\nDémarrage : 01\/09\/2026\n\nExpérience requise : 5 ans minimum$/)
  })
})

describe('robustesse de la lecture', () => {
  it('retire les chevrons des champs courts (titre, ville…) renvoyés par l\'IA', () => {
    const { offers } = parseOffersJson('[{"title":"Dev <b>React</b>","location":"Paris </script><script>x()</script>"}]', RECEIVED)
    assert.doesNotMatch(offers[0].title + offers[0].location, /[<>]/)
  })

  it('reconnaît une réponse IA coupée (inutile de la redemander)', () => {
    assert.throws(() => parseOffersJson('[{"title":"A","skills":["x"]},{"title":"B","descr', RECEIVED), TruncatedAnswerError)
    assert.doesNotThrow(() => parseOffersJson('[{"title":"Data engineer"}] Voilà les offres.', RECEIVED))
  })

  it('découpe les Message-ID en requêtes de moins de 4096 caractères', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `<CAF${'x'.repeat(60)}${i}@mail.gmail.com>`)
    const batches = batchByLength(ids)
    assert.deepEqual(batches.flat(), ids)
    for (const batch of batches) assert.ok(JSON.stringify(batch).length < 4096)
  })

  const now = new Date('2026-10-19T12:00:00Z')
  const email = (status: AoEmail['status'], attempts: number, minutesAgo: number): AoEmail => ({
    $id: 'e', sourceId: 's1', messageId: 'm', uid: 1, fromAddress: '', fromName: '', origin: '', deadline: '', citedClients: [], subject: '', receivedAt: '', attachments: [],
    status, error: '', offerCount: 0, duplicateCount: 0, attempts, updatedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  })

  it('réessaie une seule fois, et reprend un traitement interrompu', () => {
    assert.equal(nextStepFor(email('processed', 1, 60), now), 'skip')
    assert.equal(nextStepFor(email('failed', 1, 1), now), 'retry')
    assert.equal(nextStepFor(email('failed', 2, 1), now), 'skip')
    assert.equal(nextStepFor(email('processing', 1, 5), now), 'skip') // en cours dans un autre passage
    assert.equal(nextStepFor(email('processing', 1, 30), now), 'retry') // interrompu
    assert.equal(nextStepFor(email('processing', 2, 30), now), 'abandon')
  })

  it('une erreur est reprise une seule fois ; une attente de crédits IA, à chaque passage', () => {
    const failed = (attempts: number) => email('failed', attempts, 1)
    const ordinary = { final: false, countsAsAttempt: true }
    const waitingForCredits = { final: false, countsAsAttempt: false }
    // Erreur ordinaire : une reprise au passage suivant, puis abandon.
    let attempts = attemptsAfterFailure(1, ordinary)
    assert.equal(nextStepFor(failed(attempts), now), 'retry')
    attempts = attemptsAfterFailure(attempts + 1, ordinary)
    assert.equal(nextStepFor(failed(attempts), now), 'skip')
    // Crédits épuisés, même sur la reprise : l'e-mail revient à chaque passage, sans user sa reprise.
    attempts = attemptsAfterFailure(1, waitingForCredits)
    for (let pass = 0; pass < 5; pass++) attempts = attemptsAfterFailure(attempts + 1, waitingForCredits)
    assert.equal(nextStepFor(failed(attempts), now), 'retry')
    assert.equal(nextStepFor(failed(attemptsAfterFailure(2, waitingForCredits)), now), 'retry')
    // Erreur définitive (message trop gros, réponse tronquée) : jamais reprise.
    assert.equal(nextStepFor(failed(attemptsAfterFailure(1, { final: true, countsAsAttempt: true })), now), 'skip')
  })

  it('« Réessayer » remet en file un e-mail en erreur, même abandonné, et rien d\'autre', () => {
    // E-mail en erreur avant la règle actuelle (crédits épuisés comptés comme essais) : abandonné.
    const abandoned = email('failed', 3, 60)
    assert.equal(nextStepFor(abandoned, now), 'skip')
    const patch = manualRetryPatch(abandoned)
    assert.deepEqual(patch, { attempts: 0 })
    assert.equal(nextStepFor({ ...abandoned, ...patch }, now), 'retry')
    for (const status of ['processed', 'no_offer', 'processing'] as const) assert.equal(manualRetryPatch(email(status, 1, 60)), null, status)
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

describe('report faute de temps', () => {
  it('traite le premier e-mail d\'une boîte qui a le temps, reporte les autres si besoin', () => {
    assert.equal(canDeferEmail(0, 120_000, 95_000), false, 'premier e-mail, assez de temps : il passe quoi qu\'il arrive')
    assert.equal(canDeferEmail(0, 40_000, 95_000), true, 'premier e-mail d\'une boîte lue en fin de passage : reportable')
    assert.equal(canDeferEmail(3, 200_000, 95_000), true)
  })
})

describe('filtres', () => {
  const row = (over: Partial<AoOfferRow> = {}): AoOfferRow => ({
    ...offer(), $id: 'o1', createdAt: '2026-10-10T08:00:00.000Z', fingerprint: 'f', emailId: 'e1', status: 'to_review',
    jobId: null, sourceCount: 1, senderAddress: 'ao@esn.fr', senderName: 'ESN Conseil', forwardedBy: '', attachments: [], commentCount: 0, subject: 'AO React', receivedAt: '2026-10-10T08:00:00.000Z',
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

  it('lit toute la boîte (365 jours) tant que sa lecture complète n\'est pas terminée, même sur plusieurs passages', () => {
    for (const plan of [planRead(null, '7', now, true), planRead(cp(), '7', now, true), planRead(cp({ reconciledAt: null, lastUid: 40 }), '7', now, true)]) {
      assert.equal(plan.mode, 'reconcile')
      if (plan.mode === 'reconcile') assert.equal(plan.since.toISOString(), '2025-10-19T12:00:00.000Z')
    }
  })

  it('rattrape 7 jours après 24 h, si la boîte a été reconstruite, ou si un rattrapage est resté inachevé', () => {
    for (const plan of [planRead(cp({ reconciledAt: '2026-10-18T11:00:00Z' }), '7', now), planRead(cp(), '8', now), planRead(cp({ reconciledAt: null }), '7', now)]) {
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

  it('traite le courrier nouveau avant les e-mails à réessayer, chaque message une seule fois', () => {
    const envelope = (uid: number, messageId: string) => ({ uid, messageId })
    const order = processingOrder([envelope(105, '<c@x>'), envelope(103, '<b@x>')], [envelope(40, '<a@x>'), envelope(103, '<b@x>'), envelope(12, '<z@x>')])
    assert.deepEqual(order.map(e => e.uid), [103, 105, 12, 40])
  })
})

describe('chaîne de lecture des pièces jointes', () => {
  const file = (filename: string): Attachment => ({ filename, contentType: '', content: Buffer.from('x') })
  const ctx = (): ExtractionContext => ({ deadline: Date.now() + 60_000, canDefer: true, reserveVisionCall: async () => true, releaseVisionCall: async () => {}, pass: { visionUnavailable: null } })
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

  it('prépare la bonne partie de message pour GPT-4o selon le format', () => {
    const pdf = openAiContentPart(file('ao.pdf'))
    assert.ok(pdf?.type === 'file' && pdf.file.filename === 'document.pdf' && pdf.file.file_data === `data:application/pdf;base64,${Buffer.from('x').toString('base64')}`)
    const image = openAiContentPart(file('scan.png'))
    assert.ok(image?.type === 'image_url' && image.image_url.url.startsWith('data:image/png;base64,'))
    assert.equal(openAiContentPart(file('ao.docx')), null)
  })

  it('fait remonter « IA indisponible » pour que l\'e-mail attende, sans compter d\'essai', async () => {
    const noCredits = extractor('vision', ['.png'], async () => { throw new AiUnavailable('Claude : crédits épuisés') })
    await assert.rejects(readAttachments([file('photo.png')], ctx(), [noCredits]), (err: unknown) => err instanceof AiUnavailable && !err.countsAsAttempt)
  })
})

describe('IA indisponible : crédits épuisés, clé refusée, service en panne', () => {
  const claudeError = (status: number, type: string, message: string) =>
    Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers())
  const LOW_CREDIT = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'

  it('reconnaît les échecs Claude gratuits à réessayer : compte, configuration, panne', () => {
    assert.equal(claudeProblem(claudeError(400, 'invalid_request_error', LOW_CREDIT)), 'credits')
    assert.equal(claudeProblem(claudeError(402, 'billing_error', 'Payment required')), 'credits')
    assert.equal(claudeProblem(claudeError(400, 'billing_error', 'Billing issue')), 'credits')
    assert.equal(claudeProblem(claudeError(401, 'authentication_error', 'invalid x-api-key')), 'access')
    assert.equal(claudeProblem(claudeError(403, 'permission_error', 'not allowed')), 'access')
    assert.equal(claudeProblem(claudeError(404, 'not_found_error', 'model: claude-x')), 'model')
    assert.equal(claudeProblem(claudeError(529, 'overloaded_error', 'Overloaded')), 'outage')
    assert.equal(claudeProblem(claudeError(429, 'rate_limit_error', 'Too many requests')), 'outage')
    assert.equal(claudeProblem(claudeError(500, 'api_error', 'Internal server error')), 'outage')
    assert.equal(claudeProblem(new Anthropic.APIConnectionError({ message: 'Connection error.' })), 'outage')
  })

  it('laisse suivre la règle normale ce qui a pu être facturé, ou ne vient pas du service', () => {
    assert.equal(claudeProblem(new Anthropic.APIConnectionTimeoutError()), null)
    assert.equal(claudeProblem(new Anthropic.APIUserAbortError()), null)
    assert.equal(claudeProblem(claudeError(504, 'timeout_error', 'Gateway timeout')), null)
    assert.equal(claudeProblem(claudeError(400, 'invalid_request_error', 'PDF has too many pages')), null)
    assert.equal(claudeProblem(new Error(LOW_CREDIT)), null)
  })

  it('reconnaît les échecs gratuits des API compatibles OpenAI ; refus de compte seulement en JSON', () => {
    assert.equal(openAiProblem(429, '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}'), 'credits')
    assert.equal(openAiProblem(402, 'Insufficient credits'), 'credits')
    assert.equal(openAiProblem(401, '{"error":{"code":"invalid_api_key"}}'), 'access')
    assert.equal(openAiProblem(404, '{"error":{"code":"model_not_found"}}'), 'model')
    assert.equal(openAiProblem(429, '{"error":{"code":"rate_limit_exceeded"}}'), 'outage')
    assert.equal(openAiProblem(503, '<html>Service Unavailable</html>'), 'outage')
    assert.equal(openAiProblem(504, '<html>Gateway Timeout</html>'), null)
    // Pare-feu ou proxy (page HTML), texte de l'e-mail recopié dans une erreur : pas un refus du compte.
    assert.equal(openAiProblem(403, '<html>Request blocked</html>'), null)
    assert.equal(openAiProblem(400, '{"error":{"message":"bad input: insufficient_quota"}}'), null)
  })

  it('ne met en attente le texte que si TOUS les modèles ont échoué sans frais', () => {
    const allFree = new LLMChainError([
      { provider: 'claude', error: claudeError(400, 'invalid_request_error', LOW_CREDIT) },
      { provider: 'gpt4o', error: new LLMHttpError(503, 'Service Unavailable') },
      { provider: 'teckia', error: new LLMNotConfiguredError('TeckiA non configuré (URL manquante dans /admin/llm-config)') },
      { provider: 'os-mistral', error: new LLMUnreachableError(false, 'ECONNREFUSED') },
    ])
    assert.equal(llmUnavailableReason(allFree), 'claude : crédits épuisés ; gpt4o : service saturé ou indisponible (503) ; teckia : non configuré dans Config IA ; os-mistral : service saturé ou indisponible')
    assert.equal(allFree.message, claudeError(400, 'invalid_request_error', LOW_CREDIT).message, 'message inchangé pour les autres appelants')
    // Un repli resté sans réponse (a pu être facturé) : règle normale des essais, pas de refacturation sans fin.
    const mixed = new LLMChainError([
      { provider: 'claude', error: claudeError(400, 'invalid_request_error', LOW_CREDIT) },
      { provider: 'gpt4o', error: new LLMUnreachableError(true, 'pas de réponse après 55 s') },
    ])
    assert.equal(llmUnavailableReason(mixed), null)
    assert.equal(llmUnavailableReason(claudeError(402, 'billing_error', 'Payment required')), 'modèle de Config IA : crédits épuisés')
    assert.equal(llmUnavailableReason(new Error('Pas de réponse de l\'IA après 120 s')), null)
  })

  /** Contexte de lecture qui compte les lectures réservées et rendues. */
  function visionCtx({ budgetLeft = true, pass = { visionUnavailable: null as string | null }, releaseFails = false } = {}) {
    const counts = { reserved: 0, released: 0 }
    const ctx: ExtractionContext = {
      deadline: Date.now() + 60_000,
      canDefer: true,
      reserveVisionCall: async () => { if (budgetLeft) counts.reserved++; return budgetLeft },
      releaseVisionCall: async () => {
        if (releaseFails) throw new Error('fetch failed')
        counts.released++
      },
      pass,
    }
    return { ctx, counts }
  }
  const reader = (name: string, read: () => Promise<string>, calls: string[]): VisionReader =>
    ({ name, read: async () => { calls.push(name); return read() } })
  const noCredits = (calls: string[]) => reader('Claude', async () => { throw new AiUnavailable('crédits épuisés') }, calls)

  it('passe à GPT-4o quand Claude n\'a plus de crédits', async () => {
    const { ctx, counts } = visionCtx()
    const calls: string[] = []
    const text = await readWithFallback([noCredits(calls), reader('OpenAI', async () => 'Chef de projet — Niort', calls)], ctx)
    assert.equal(text, 'Chef de projet — Niort')
    assert.deepEqual(calls, ['Claude', 'OpenAI'])
    assert.deepEqual(counts, { reserved: 1, released: 0 })
  })

  it('n\'appelle pas le repli quand Claude répond', async () => {
    const { ctx } = visionCtx()
    const calls: string[] = []
    await readWithFallback([reader('Claude', async () => 'texte', calls), reader('OpenAI', async () => 'autre', calls)], ctx)
    assert.deepEqual(calls, ['Claude'])
  })

  it('met l\'e-mail en attente quand aucun service ne peut lire, et rend la lecture réservée', async () => {
    const { ctx, counts } = visionCtx()
    await assert.rejects(
      readWithFallback([noCredits([]), reader('OpenAI', async () => { throw new AiUnavailable('aucune clé dans Config IA') }, [])], ctx),
      (err: unknown) => err instanceof AiUnavailable && err.stage === 'vision' && !err.countsAsAttempt
        && /Claude : crédits épuisés ; OpenAI : aucune clé dans Config IA/.test(err.message),
    )
    assert.deepEqual(counts, { reserved: 1, released: 1 })
  })

  it('retient l\'indisponibilité pour le reste du passage : plus d\'appel ni de réservation', async () => {
    const pass = { visionUnavailable: null as string | null }
    const first = visionCtx({ pass })
    await assert.rejects(readWithFallback([noCredits([]), reader('OpenAI', async () => { throw new AiUnavailable('crédits épuisés') }, [])], first.ctx), AiUnavailable)
    assert.equal(pass.visionUnavailable, 'Claude : crédits épuisés ; OpenAI : crédits épuisés')

    const next = visionCtx({ pass })
    const calls: string[] = []
    await assert.rejects(readWithFallback([reader('Claude', async () => 'texte', calls)], next.ctx), AiUnavailable)
    assert.deepEqual(calls, [])
    assert.deepEqual(next.counts, { reserved: 0, released: 0 })
  })

  it('un compteur injoignable ne masque jamais la vraie cause', async () => {
    const { ctx } = visionCtx({ releaseFails: true })
    await assert.rejects(readWithFallback([noCredits([])], ctx), AiUnavailable)
    const broken: ExtractionContext = { ...visionCtx().ctx, reserveVisionCall: async () => { throw new Error('fetch failed (ETIMEDOUT)') } }
    await assert.rejects(readWithFallback([reader('Claude', async () => 'texte', [])], broken), (err: unknown) => err instanceof RetryLater && !(err instanceof AiUnavailable))
  })

  it('n\'essaie pas le repli sur un délai dépassé (peut-être facturé) : reprise normale de l\'e-mail', async () => {
    const { ctx, counts } = visionCtx()
    const calls: string[] = []
    await assert.rejects(readWithFallback([
      reader('Claude', async () => { throw new RetryLater('pas de réponse dans le délai') }, calls),
      reader('OpenAI', async () => 'texte', calls),
    ], ctx), (err: unknown) => err instanceof RetryLater && !(err instanceof AiUnavailable))
    assert.deepEqual(calls, ['Claude'])
    assert.equal(counts.released, 0)
  })

  it('garde la cause du premier refus quand le repli échoue pour une autre raison', async () => {
    const { ctx } = visionCtx()
    await assert.rejects(
      readWithFallback([noCredits([]), reader('OpenAI', async () => { throw new RetryLater('pas de réponse d\'OpenAI dans le délai') }, [])], ctx),
      (err: unknown) => err instanceof RetryLater && err.countsAsAttempt && err.message === 'Claude : crédits épuisés ; OpenAI : pas de réponse d\'OpenAI dans le délai',
    )
  })

  it('respecte la limite de lectures par l\'IA avant tout appel', async () => {
    const { ctx } = visionCtx({ budgetLeft: false })
    const calls: string[] = []
    await assert.rejects(readWithFallback([reader('Claude', async () => 'texte', calls)], ctx), SkipAttachment)
    assert.deepEqual(calls, [])
  })

  describe('lecture par OpenAI (fetch simulé, aucun appel réseau)', () => {
    const scan: Attachment = { filename: 'ao.png', contentType: 'image/png', content: Buffer.from('x') }
    const options = { apiKey: 'sk-test', model: 'gpt-4o', prompt: 'Transcris', maxTokens: 8000, wait: 20_000 }
    const respond = (status: number, body: unknown) => async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    const transient = (err: unknown) => err instanceof RetryLater && !(err instanceof AiUnavailable)

    it('envoie le document et renvoie le texte transcrit', async t => {
      const fetchMock = t.mock.method(globalThis, 'fetch', respond(200, { choices: [{ finish_reason: 'stop', message: { content: 'Chef de projet — Niort', refusal: null } }] }))
      assert.equal(await transcribeWithOpenAI(scan, options), 'Chef de projet — Niort')
      const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit]
      assert.equal(url, 'https://api.openai.com/v1/chat/completions')
      const body = JSON.parse(String(init.body))
      assert.equal(body.model, 'gpt-4o')
      assert.equal(body.max_completion_tokens, 8000)
      assert.equal(body.messages[0].content[0].type, 'image_url')
    })

    it('classe chaque échec : compte, modèle, panne (sans frais), délai, document refusé', async t => {
      const cases: [number | 'network' | 'timeout', unknown, (err: unknown) => boolean][] = [
        [429, { error: { code: 'insufficient_quota' } }, err => err instanceof AiUnavailable && err.reason === 'crédits épuisés'],
        [401, { error: { code: 'invalid_api_key' } }, err => err instanceof AiUnavailable && err.reason === 'clé refusée'],
        [404, { error: { code: 'model_not_found' } }, err => err instanceof AiUnavailable && err.reason === 'modèle « gpt-4o » introuvable ou non autorisé (Config IA)'],
        [429, { error: { code: 'rate_limit_exceeded' } }, err => err instanceof AiUnavailable && err.reason === 'service saturé ou indisponible (429)'],
        [503, '<html>Service Unavailable</html>', err => err instanceof AiUnavailable && err.reason === 'service saturé ou indisponible (503)'],
        [504, '<html>Gateway Timeout</html>', transient],
        [400, { error: { message: 'Invalid image' } }, err => err instanceof SkipAttachment && err.message === 'document refusé par OpenAI : Invalid image'],
        [200, { choices: [{ message: { content: null, refusal: 'I cannot help' } }] }, err => err instanceof SkipAttachment],
        [200, { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }, err => err instanceof SkipAttachment],
        [200, '<html>proxy</html>', transient],
        [200, { choices: [] }, transient],
        ['network', null, err => err instanceof AiUnavailable && err.reason === 'service injoignable (ECONNRESET)'],
        ['timeout', null, transient],
      ]
      for (const [status, body, expected] of cases) {
        t.mock.restoreAll()
        if (status === 'network') t.mock.method(globalThis, 'fetch', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) })
        else if (status === 'timeout') t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
        else t.mock.method(globalThis, 'fetch', respond(status, body))
        await assert.rejects(transcribeWithOpenAI(scan, options), expected, `réponse ${status}`)
      }
    })

    it('envoie un nom de fichier générique, pas celui de l\'expéditeur', () => {
      const pdf = openAiContentPart({ filename: 'CV_Prénom_Nom.pdf', contentType: '', content: Buffer.from('x') })
      assert.ok(pdf?.type === 'file' && pdf.file.filename === 'document.pdf')
    })

    it('ne recopie jamais la clé dans les messages d\'erreur', async t => {
      t.mock.method(globalThis, 'fetch', respond(401, '{"error":{"message":"Incorrect API key provided: sk-test"}}'))
      await assert.rejects(transcribeWithOpenAI(scan, options), (err: unknown) => err instanceof Error && !err.message.includes('sk-test'))
      t.mock.restoreAll()
      t.mock.method(globalThis, 'fetch', respond(400, '{"error":{"message":"Bad request for key sk-test"}}'))
      await assert.rejects(transcribeWithOpenAI(scan, options), (err: unknown) => err instanceof SkipAttachment && !err.message.includes('sk-test'))
    })
  })
})

describe('tableaux d\'offres joints (lecture directe, sans IA)', () => {
  // En-têtes réels de tableaux de suivi d'AO reçus ; valeurs inventées.
  const TRACKER_HEADERS = ['N° AO', 'Date de réception', 'Source / Client final', 'Intitulé du poste', 'Séniorité / Expérience', 'TJM (€)', 'Taux PGC', 'Lieu',
    'Rythme (présentiel / TT)', 'Durée', 'Démarrage', 'Contexte de la mission', 'Activités / missions principales', 'Compétences clés attendues',
    'Mots-clés sourcing', 'Statut sourcing', 'Candidats présentés', 'Notes']
  const trackerRow = ['AO-0042', '20/10/2026', 'Mutuelle Exemple', 'Chef de projet MOA (H/F)', '8 ans minimum', '550', '12 %', 'Niort',
    'Hybride, 2 jours de TT', '9 mois', '01/12/2026', 'Refonte de l\'espace adhérents.', 'Animer les ateliers métier ; piloter la recette.', 'MOA, Jira',
    'Jira; Scrum', 'En cours', 'Candidat A présenté', 'Relancer le client lundi']

  it('lit chaque ligne d\'un tableau de suivi d\'AO, colonnes reconnues par leur nom', () => {
    const table = tableOffersOf([[TRACKER_HEADERS, trackerRow]])
    assert.ok(table)
    assert.equal(table.offers.length, 1)
    const [o] = table.offers
    assert.equal(o.title, 'Chef de projet MOA (H/F)')
    assert.equal(o.companyName, 'Mutuelle Exemple')
    assert.equal(o.location, 'Niort')
    assert.equal(o.salary, 550)
    assert.equal(o.remote, 'hybrid')
    assert.equal(o.duration, '9 mois')
    assert.equal(o.startDate, '01/12/2026')
    assert.equal(o.experience, '8 ans minimum')
    assert.deepEqual(o.skills, ['MOA', 'Jira', 'Scrum'])
    assert.equal(o.description, '### Contexte de la mission\nRefonte de l\'espace adhérents.\n\n### Activités / missions principales\nAnimer les ateliers métier ; piloter la recette.')
  })

  it('n\'emporte jamais les colonnes de suivi interne (statut, candidats, notes, numéro, taux)', () => {
    const [o] = tableOffersOf([[TRACKER_HEADERS, trackerRow]])!.offers
    const all = JSON.stringify(o)
    for (const internal of ['AO-0042', '12 %', 'En cours', 'Candidat A', 'Relancer']) assert.ok(!all.includes(internal), internal)
  })

  it('trouve l\'en-tête sous un titre de feuille, et compte les lignes sans intitulé', () => {
    const rows = [['Suivi centralisé des AO'], ['Référence', 'Client', 'Intitulé', 'Date de clôture', 'Description', 'Séniorité'],
      ['R-1', 'Client Exemple', 'Développeur Java', '30/10/2026', 'API Spring Boot.', 'Confirmé'],
      ['R-2', 'Client Exemple', '', '30/10/2026', 'Ligne sans intitulé', ''],
      ['R-3', 'Client Exemple', 'Data engineer', '30/10/2026', 'Pipelines Spark.', 'Senior']]
    const table = tableOffersOf([rows])
    assert.deepEqual(table?.offers.map(o => o.title), ['Développeur Java', 'Data engineer'])
    assert.equal(table?.skippedRows, 1)
    assert.equal(table?.offers[1].description, 'Pipelines Spark.', 'une seule colonne de description : texte repris tel quel')
  })

  it('lit une colonne « date limite » comme la date limite de réponse, pas comme le démarrage', () => {
    const rows = [['Intitulé', 'Lieu', 'Date limite de réponse', 'Démarrage'], ['Développeur Java', 'Lyon', '30/10/2026', 'ASAP']]
    const [o] = tableOffersOf([rows])!.offers
    assert.equal(o.deadline, '30/10/2026')
    assert.equal(o.startDate, 'ASAP')
  })

  it('lit une date Excel au format court régional en jour/mois/année', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Intitulé', 'Lieu', 'Date limite'], ['Développeur Java', 'Lyon', '']])
    sheet.C2 = { t: 'n', v: (Date.UTC(2026, 9, 30) - Date.UTC(1899, 11, 30)) / 86_400_000, z: 'm/d/yy' } // code 14
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'AO')
    const content = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    assert.equal(readTableAttachment({ filename: 'suivi.xlsx', contentType: '', content })?.offers[0].deadline, '30/10/2026')
  })

  it('ne reconnaît pas un tableau qui n\'est pas une liste d\'offres : l\'IA le lira', () => {
    assert.equal(tableOffersOf([[['Nom', 'Prénom', 'E-mail'], ['Dupont', 'Jean', 'j@example.test']]]), null)
    assert.equal(tableOffersOf([[['Intitulé'], ['Seul un titre : pas assez pour être sûr']]]), null)
  })

  it('relit l\'export Excel de la page AO Offers à l\'identique', () => {
    const file: Attachment = { filename: 'ao-offers.xlsx', contentType: '', content: buildAoWorkbook([offer()]) }
    assert.deepEqual(readTableAttachment(file)?.offers, [offer()])
  })

  it('lit un CSV à point-virgule', () => {
    const csv = Buffer.from('Intitulé;Client;Lieu;TJM\nDéveloppeur Java;Client Exemple;Lyon;500 €/j\n')
    const table = readTableAttachment({ filename: 'offres.csv', contentType: 'text/csv', content: csv })
    assert.deepEqual(table?.offers.map(o => [o.title, o.companyName, o.location, o.salary]), [['Développeur Java', 'Client Exemple', 'Lyon', 500]])
  })

  it('lit vite un fichier piégé qui annonce des millions de cellules', () => {
    // CSV de 20 Ko : 16 384 colonnes vides en en-tête, puis 2 000 lignes (29 s et 1,4 Go avant la lecture bornée).
    const csv = Buffer.from(`Intitulé;Client${';'.repeat(16_384)}\n${'Développeur;Client Exemple\n'.repeat(2_000)}`)
    let started = Date.now()
    const table = readTableAttachment({ filename: 'piege.csv', contentType: '', content: csv })
    assert.ok(Date.now() - started < 3_000, `CSV lu en ${Date.now() - started} ms`)
    assert.equal(table?.offers.length, MAX_TABLE_ROWS)
    assert.equal(table?.truncated, true)
    // Classeur de 16 Ko dont la balise <dimension> annonce toute la feuille (A1:XFD1048576, 17 milliards de cellules).
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Intitulé', 'Client'], ['Développeur', 'Client Exemple']]), 'AO')
    const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    const entry = zip.FileIndex.find((f: { name: string }) => f.name === 'sheet1.xml')!
    entry.content = Buffer.from(Buffer.from(entry.content as Uint8Array).toString('utf8').replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:XFD1048576"/>'))
    const forged = Buffer.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }) as Uint8Array)
    started = Date.now()
    const wide = readTableAttachment({ filename: 'large.xlsx', contentType: '', content: forged })
    assert.ok(Date.now() - started < 3_000, `classeur lu en ${Date.now() - started} ms`)
    assert.equal(wide?.offers[0].title, 'Développeur')
  })

  it('refuse un contenu qui ne correspond pas à l\'extension (archive renommée), et l\'ODS', () => {
    const xlsx = buildAoWorkbook([offer()])
    for (const filename of ['offres.xls', 'offres.csv', 'offres.ods']) {
      assert.equal(readTableAttachment({ filename, contentType: '', content: xlsx }), null, filename)
    }
  })

  it('ignore les colonnes qui nomment des personnes (interlocuteur, profil positionné, manager, candidature)', () => {
    const rows = [['Intitulé', 'Interlocuteur mission', 'Profil positionné', 'Manager de la mission', 'Détail candidature', 'Profil recherché'],
      ['Chef de projet', 'Paul Exemple', 'Sophie Exemple (8 ans)', 'Jean Exemple', 'Refusée par Jean Exemple', 'Senior, PMO confirmé']]
    const [o] = tableOffersOf([rows])!.offers
    assert.equal(o.description, 'Senior, PMO confirmé')
    assert.ok(!JSON.stringify(o).includes('Exemple'))
  })

  it('retire aussi une ligne de contact écrite en titre « ### »', () => {
    assert.ok(!scrubContacts('### Contexte\nRefonte.\n\n### Contact : Paul, 06 12 34 56 78', []).includes('Paul'))
  })

  it('confie à l\'IA, avec le corps, un tableau reconnu mais sans ligne exploitable', async () => {
    const empty = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(empty, XLSX.utils.aoa_to_sheet([[...AO_EXCEL_HEADERS]]), 'AO')
    const message = {
      uid: 2, messageId: '<v@x>', fromAddress: '', fromName: '', subject: 'Besoin', receivedAt: new Date(), text: 'Nous cherchons un développeur Java à Lyon, démarrage ASAP.',
      attachments: [{ filename: 'vide.xlsx', contentType: '', content: XLSX.write(empty, { type: 'buffer', bookType: 'xlsx' }) as Buffer }],
    }
    const ctx: ExtractionContext = { deadline: Date.now() + 60_000, canDefer: true, reserveVisionCall: async () => true, releaseVisionCall: async () => {}, pass: { visionUnavailable: null } }
    const content = await buildEmailContent(message, ctx)
    assert.equal(content.tableOffers.length, 0)
    assert.match(content.text, /développeur Java à Lyon/)
  })

  it('n\'envoie pas à l\'IA le corps d\'un e-mail dont le tableau a été lu', async () => {
    const message = {
      uid: 1, messageId: '<t@x>', fromAddress: '', fromName: '', subject: 'Liste des AO', receivedAt: new Date(), text: 'Bonjour, voici nos besoins du mois.',
      attachments: [{ filename: 'suivi.xlsx', contentType: '', content: buildAoWorkbook([offer(), offer({ title: 'Data engineer' })]) }],
    }
    const ctx: ExtractionContext = { deadline: Date.now() + 60_000, canDefer: true, reserveVisionCall: async () => true, releaseVisionCall: async () => {}, pass: { visionUnavailable: null } }
    const content = await buildEmailContent(message, ctx)
    assert.equal(content.text, '')
    assert.deepEqual(content.tableOffers.map(o => o.title), [offer().title, 'Data engineer'])
    assert.deepEqual(content.attachments, ['suivi.xlsx'])
  })
})

describe('expéditeur d\'origine', () => {
  // Corps d'un AO reçu par un client, transféré à la boîte AO par un collaborateur (Outlook, en français).
  const forwardedByUs = [
    'Bonjour, ci-dessous un AO reçu ce matin.',
    '',
    'Camille Martin',
    'Wise Associates',
    '',
    'De : Dupont, Marie <marie.dupont@sopra-steria.com>',
    'Envoyé : lundi 20 octobre 2026 09:12',
    'À : Camille Martin <c.martin@wise-associates.fr>',
    'Objet : AO - Chef de projet MOA',
    '',
    '30/10/2026',
    'Mission longue',
    '480,00',
    'Paris',
    '5 ans et plus',
  ].join('\n')
  const us = { fromName: 'Camille Martin', fromAddress: 'c.martin@wise-associates.fr' }

  it('retrouve l\'expéditeur du message transféré, pas notre collaborateur', () => {
    assert.deepEqual(originalSender({ ...us, text: forwardedByUs }, WISE.ownDomains), { name: 'Dupont, Marie', address: 'marie.dupont@sopra-steria.com' })
  })

  it('lit une adresse renvoyée seule à la ligne après « De : »', () => {
    const text = 'De : Marie Dupont (Direction des achats)\n<marie.dupont@client-exemple.fr>\nEnvoyé : lundi'
    assert.deepEqual(originalSender({ ...us, text }, WISE.ownDomains), { name: 'Marie Dupont Direction des achats', address: 'marie.dupont@client-exemple.fr' })
  })

  it('remonte au message le plus ancien d\'une chaîne de transferts', () => {
    const text = [
      '---------- Forwarded message ---------',
      'From: ESN Conseil <ao@esn-conseil.fr>',
      'Date: Mon, Oct 20, 2026 at 10:00 AM',
      'Subject: Fwd: AO Data',
      '',
      '-------- Message transféré --------',
      '*De :* Achats Client Exemple [mailto:achats@client-exemple.fr]',
      '*Objet :* AO Data engineer',
    ].join('\n')
    assert.deepEqual(originalSender({ ...us, text }, WISE.ownDomains), { name: 'Achats Client Exemple', address: 'achats@client-exemple.fr' })
  })

  it('lit l\'introduction d\'une réponse (« … a écrit : ») et les chevrons encodés', () => {
    const reply = 'Voir ci-dessous.\n\nLe lun. 20 oct. 2026 à 10:12, Marie Martin <marie.martin@client-exemple.fr> a écrit :\n> AO Java'
    assert.deepEqual(originalSender({ ...us, text: reply }, WISE.ownDomains), { name: 'Marie Martin', address: 'marie.martin@client-exemple.fr' })
    const html = 'De : Marie Dupont &lt;marie.dupont@client-exemple.fr&gt;'
    assert.deepEqual(originalSender({ ...us, text: html }, WISE.ownDomains), { name: 'Marie Dupont', address: 'marie.dupont@client-exemple.fr' })
  })

  it('lit vite un corps construit pour ralentir la recherche d\'en-têtes', () => {
    const traps = ['Bonjour\n' + '\n'.repeat(1_000_000) + 'Merci', 'De : ' + 'a'.repeat(1_000_000), 'From' + ' \n'.repeat(500_000) + ':']
    for (const text of traps) {
      const started = Date.now()
      assert.equal(originalSender({ ...us, text }, WISE.ownDomains), null)
      assert.ok(Date.now() - started < 1_000, `${Date.now() - started} ms`)
    }
  })

  it('enregistre l\'expéditeur d\'origine sous la forme « Nom <adresse> » et le relit', () => {
    const sender = { name: 'Dupont, Marie', address: 'marie.dupont@sopra-steria.com' }
    assert.equal(formatSender(sender), 'Dupont, Marie <marie.dupont@sopra-steria.com>')
    assert.deepEqual(parseSender(formatSender(sender)), sender)
    assert.deepEqual(parseSender(formatSender({ name: '', address: 'ao@esn-conseil.fr' })), { name: '', address: 'ao@esn-conseil.fr' })
    assert.equal(parseSender(''), null)
  })

  it('garde l\'expéditeur de l\'e-mail s\'il n\'y a pas de transfert, et rien s\'il vient de chez nous', () => {
    const direct = { fromName: 'ESN Conseil', fromAddress: 'AO@esn-conseil.fr', text: 'De : 3 à 5 ans d\'expérience\nMission longue' }
    assert.deepEqual(originalSender(direct, WISE.ownDomains), { name: 'ESN Conseil', address: 'ao@esn-conseil.fr' })
    assert.equal(originalSender({ ...us, text: 'AO saisi à la main : chef de projet à Lyon.' }, WISE.ownDomains), null)
  })
})

describe('client d\'une offre AO', () => {
  const sopra: Sender = { name: 'Dupont, Marie', address: 'marie.dupont@sopra-steria.com' }

  it('nomme l\'entreprise d\'après le domaine, sauf messagerie grand public ou chez nous', () => {
    assert.equal(companyFromDomain('marie.dupont@sopra-steria.com'), 'Sopra Steria')
    assert.equal(companyFromDomain('achats@bnp.fr'), 'BNP')
    assert.equal(companyFromDomain('rh@mail.client-exemple.co.uk'), 'Client Exemple')
    assert.equal(companyFromDomain('ao.client@gmail.com'), '')
    assert.equal(companyFromDomain('achats@orange.com'), 'Orange', 'orange.fr est grand public, orange.com une entreprise')
    assert.equal(companyFromDomain('x@orange.fr'), '')
    assert.equal(companyFromDomain('rh@caisse-des-depots.fr'), 'Caisse des Depots')
    assert.equal(companyFromDomain('c.martin@wise-associates.fr', WISE.ownDomains), '')
    assert.equal(companyFromDomain(''), '')
  })

  it('préfère le nom lu par l\'IA dans la signature, sinon le domaine', () => {
    assert.equal(senderCompany(sopra, ['Sopra Steria Group', '', 'Sopra Steria Group', 'BNP Paribas'], WISE), 'Sopra Steria Group')
    assert.equal(senderCompany(sopra, ['', 'Wise Associates'], WISE), 'Sopra Steria', 'jamais notre propre nom')
    assert.equal(senderCompany(sopra, [], WISE), 'Sopra Steria', 'offres lues dans un tableau, sans IA')
    assert.equal(senderCompany({ name: 'Recrutement', address: 'ao.client@gmail.com' }, [], WISE), null, 'entreprise inconnue : chaque offre garde son client')
  })

  it('borne le nom tiré d\'un domaine à la taille du champ client', () => {
    assert.ok(senderCompany({ name: '', address: `a@${'b'.repeat(250)}.fr` }, [], WISE)!.length <= 200)
  })

  it('garde les clients cités par l\'appel d\'offres pour les masquer à la publication', () => {
    // Une ESN écrit directement : son nom devient le client, celui qu'elle cite ne doit pas être publié pour autant.
    const extracted = [offer({ companyName: 'ESN Conseil', endClient: 'BNP Paribas', title: 'Développeur React - BNP Paribas' }), offer({ companyName: '', endClient: '' })]
    const cited = citedClients(extracted)
    assert.deepEqual(cited, ['ESN Conseil', 'BNP Paribas'])
    const pub = toPublicOffer({ ...extracted[0], companyName: 'ESN Conseil' }, namesToHide(['ESN Conseil', ...cited], [{ name: '', address: 'ao@esn-conseil.fr' }]))
    assert.ok(!/BNP|ESN/i.test(JSON.stringify(pub)), JSON.stringify(pub))
  })

  it('laisse le client lu dans l\'offre quand l\'expéditeur d\'origine est inconnu', () => {
    assert.equal(senderCompany(null, ['BNP Paribas'], WISE), null)
  })
})
