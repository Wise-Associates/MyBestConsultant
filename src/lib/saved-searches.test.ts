import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FILTERS, EXPERIENCE_MAX, type SearchableCandidate } from './cvtheque-search'
import { searchableCandidateOf } from './cvtheque-candidate'
import {
  candidateHighlights, isRetryDue, newMatchCount, parseSavedSearchInput, savedSearchEmail, savedSearchOf, searchAlertDocId, shouldAlert,
  type SavedSearch,
} from './saved-searches'

// Données fictives.
const now = new Date('2026-11-18T12:00:00.000Z')
const candidate: SearchableCandidate = {
  name: 'Alex Exemple', city: 'Antananarivo, Madagascar', mobilityRadiusKm: null, skills: ['Revit', 'AutoCAD', 'Architecture'],
  experienceSummary: 'Modeleur BIM', experiences: [{ title: 'Modeleur BIM senior', company: 'Studio Démo', missions: ['Maquettes Revit'] }],
  education: [], languages: [{ name: 'Anglais' }], yearsOfExperience: 7, openToWork: true, desiredSector: [], desiredRoles: [],
  createdAt: '2026-11-18T10:00:00.000Z', jobFamily: 'design_ux',
}
const search: SavedSearch = {
  id: 's1', tenantId: 't1', ownerId: 'r1', name: 'Senior Revit Modelers — Madagascar', description: '',
  filters: { ...EMPTY_FILTERS, skills: ['Revit', 'Architecture'], experience: [5, EXPERIENCE_MAX], location: 'Madagascar', languages: ['Anglais'] },
  active: true, emailAlerts: true, createdAt: '2026-11-17T09:00:00.000Z', lastMatchAt: '', lastOpenedAt: '',
}

describe('Recherches enregistrées : quand alerter', () => {
  it('alerte pour un nouveau candidat qui répond à tous les critères (scénario B du PO)', () => {
    assert.equal(shouldAlert(search, candidate, { newCv: false, now }), true)
  })

  it('n\'alerte pas pour un candidat à qui il manque un critère obligatoire', () => {
    assert.equal(shouldAlert(search, { ...candidate, yearsOfExperience: 3 }, { newCv: false, now }), false)
    assert.equal(shouldAlert(search, { ...candidate, skills: ['AutoCAD'] }, { newCv: false, now }), false)
  })

  it('garde un candidat dont une information manque, comme la liste (années d\'expérience inconnues)', () => {
    assert.equal(shouldAlert(search, { ...candidate, yearsOfExperience: null }, { newCv: false, now }), true)
  })

  it('n\'alerte ni pour une recherche désactivée ni pour une recherche sans critère', () => {
    assert.equal(shouldAlert({ ...search, active: false }, candidate, { newCv: false, now }), false)
    assert.equal(shouldAlert({ ...search, filters: { ...EMPTY_FILTERS, availableOnly: true } }, candidate, { newCv: false, now }), false)
  })

  it('un candidat inscrit avant la recherche n\'alerte que s\'il vient de déposer son CV', () => {
    const older = { ...candidate, createdAt: '2026-11-01T09:00:00.000Z' }
    assert.equal(shouldAlert(search, older, { newCv: false, now }), false)
    assert.equal(shouldAlert(search, older, { newCv: true, now }), true)
  })

  it('identifiant fixe par recherche, recruteur et candidat', () => {
    const id = searchAlertDocId('s1', 'r1', 'c1')
    assert.match(id, /^al[0-9a-f]{34}$/)
    assert.equal(id, searchAlertDocId('s1', 'r1', 'c1'))
    assert.notEqual(id, searchAlertDocId('s2', 'r1', 'c1'))
  })

  it('renvoie un e-mail en échec ou interrompu, 3 essais au plus', () => {
    const at = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
    assert.equal(isRetryDue({ emailStatus: 'failed', emailAttempts: 1, updatedAt: at(1) }, now), true)
    assert.equal(isRetryDue({ emailStatus: 'failed', emailAttempts: 3, updatedAt: at(1) }, now), false)
    assert.equal(isRetryDue({ emailStatus: 'failed', emailAttempts: undefined, updatedAt: at(1) }, now), true)
    // Envoi en cours depuis peu : peut-être encore en route, pas renvoyé.
    assert.equal(isRetryDue({ emailStatus: 'pending', emailAttempts: 0, updatedAt: at(5) }, now), false)
    assert.equal(isRetryDue({ emailStatus: 'pending', emailAttempts: 0, updatedAt: at(20) }, now), true)
    assert.equal(isRetryDue({ emailStatus: 'sent', emailAttempts: 1, updatedAt: at(60) }, now), false)
    assert.equal(isRetryDue({ emailStatus: 'off', emailAttempts: 0, updatedAt: at(60) }, now), false)
  })

  it('compte les correspondances arrivées après la dernière ouverture', () => {
    const dates = ['2026-11-10T00:00:00.000Z', '2026-11-15T00:00:00.000Z', '2026-11-17T00:00:00.000Z']
    assert.equal(newMatchCount(dates, ''), 3)
    assert.equal(newMatchCount(dates, '2026-11-14T00:00:00.000Z'), 2)
  })
})

describe('Recherches enregistrées : saisie', () => {
  it('valide le nom, la description et les critères', () => {
    const ok = parseSavedSearchInput({ name: '  Revit  ', filters: search.filters })
    assert.ok('input' in ok)
    assert.equal(ok.input.name, 'Revit')
    assert.equal(ok.input.emailAlerts, true)
    assert.deepEqual(ok.input.filters, search.filters)
    assert.deepEqual(parseSavedSearchInput({ name: ' ', filters: search.filters }), { error: 'Donnez un nom à la recherche.' })
    assert.ok('error' in parseSavedSearchInput({ name: 'x'.repeat(101), filters: search.filters }))
    assert.ok('error' in parseSavedSearchInput({ name: 'Tout', filters: EMPTY_FILTERS }))
  })

  it('refuse des filtres trop longs pour l\'attribut filtersJson plutôt qu\'un échec d\'Appwrite', () => {
    const quoted = (n: number) => Array.from({ length: 20 }, (_, i) => `"${i}${'"'.repeat(n)}`)
    const huge = { query: '"'.repeat(300), exclude: '"'.repeat(300), skills: quoted(70), sectors: quoted(70), languages: quoted(70), company: '"'.repeat(200) }
    assert.deepEqual(parseSavedSearchInput({ name: 'Trop', filters: huge }), { error: 'Trop de critères pour une recherche : retirez-en quelques-uns.' })
  })

  it('relit un document, filtres illisibles compris', () => {
    const s = savedSearchOf({ $id: 's9', ownerId: 'r1', name: 'X', filtersJson: '{pas du json', $createdAt: '2026-11-18T00:00:00.000Z' })
    assert.deepEqual(s.filters, EMPTY_FILTERS)
    assert.equal(s.active, true)
    assert.equal(s.emailAlerts, true)
    assert.equal(savedSearchOf({ filtersJson: JSON.stringify(search.filters), active: false }).active, false)
  })
})

describe('Recherches enregistrées : e-mail', () => {
  it('met en avant les compétences demandées et échappe les textes', () => {
    const h = candidateHighlights(candidate, [search.filters])
    assert.deepEqual(h, { position: 'Modeleur BIM senior', location: 'Antananarivo, Madagascar', years: '7 ans', skills: ['Revit', 'Architecture', 'AutoCAD'] })
    const mail = savedSearchEmail({
      recipientName: 'Sam', candidateName: '<b>Alex</b>', highlights: h, searches: [{ name: 'Revit <script>', filters: search.filters }],
      profileUrl: 'https://exemple.test/recruiter/candidate-preview/pool/c1', alertsUrl: 'https://exemple.test/recruiter/alertes',
    })
    assert.equal(mail.subject, 'Nouveau candidat pour votre recherche « Revit <script> »')
    assert.ok(mail.bodyHtml.includes('&lt;b&gt;Alex&lt;/b&gt;'))
    assert.ok(!mail.bodyHtml.includes('<script>'))
    assert.ok(mail.bodyHtml.includes('Compétences : Revit, Architecture'))
  })

  it('regroupe plusieurs recherches dans un seul e-mail', () => {
    const mail = savedSearchEmail({
      recipientName: '', candidateName: '', highlights: candidateHighlights(candidate, []),
      searches: [{ name: 'A', filters: EMPTY_FILTERS }, { name: 'B', filters: EMPTY_FILTERS }], profileUrl: 'https://exemple.test/p', alertsUrl: 'https://exemple.test/a',
    })
    assert.equal(mail.subject, 'Nouveau candidat pour 2 de vos recherches')
    assert.ok(mail.bodyHtml.startsWith('\n      <p style="margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;">Bonjour,</p>'))
    assert.ok(mail.bodyHtml.includes('Un candidat'))
  })
})

describe('Recherches enregistrées : lecture d\'un candidat', () => {
  it('lit le profil comme la liste de la CV Thèque, et tolère un profil illisible', () => {
    const c = searchableCandidateOf({
      $createdAt: '2026-11-18T10:00:00.000Z', firstName: 'Alex', lastName: 'Exemple', city: 'Lyon', desiredRoles: 'Lead, Architecte',
      cvProfileJson: JSON.stringify({ skills: ['Java', 3], experiences: [{ title: 'Dev', company: 'X' }], languages: [{ name: 'Anglais', level: 'C1' }], yearsOfExperience: 4 }),
    })
    assert.equal(c.name, 'Alex Exemple')
    assert.deepEqual(c.skills, ['Java'])
    assert.deepEqual(c.experiences, [{ title: 'Dev', company: 'X', missions: [] }])
    assert.deepEqual(c.desiredRoles, ['Lead', 'Architecte'])
    assert.equal(c.openToWork, true)
    assert.deepEqual(searchableCandidateOf({ cvProfileJson: '{oops' }).skills, [])
  })
})

describe('Recherches enregistrées : compétences équivalentes (ADR 0057)', () => {
  // Cas signalé le 2026-11-20 : recherche « Angular + Node.js », candidat fictif qui a Angular et NestJS.
  const nodeSearch: SavedSearch = { ...search, filters: { ...EMPTY_FILTERS, skills: ['Angular', 'Node.js'] } }
  const dev: SearchableCandidate = { ...candidate, skills: ['TypeScript', 'Docker', 'Angular', 'NestJS'], languages: [] }

  it('alerte pour un candidat qui a la compétence voisine, comme la liste le retient', () => {
    assert.equal(shouldAlert(nodeSearch, dev, { newCv: true, now }), true)
    assert.equal(shouldAlert(nodeSearch, { ...dev, skills: ['Angular', 'Python'] }, { newCv: true, now }), false)
  })

  it('met en tête de l\'e-mail les compétences qui ont retenu le candidat, équivalences comprises', () => {
    assert.deepEqual(candidateHighlights(dev, [nodeSearch.filters]).skills, ['Angular', 'NestJS', 'TypeScript', 'Docker'])
  })
})

describe('Recherches enregistrées : filtre Métier (ADR 0057)', () => {
  const byFamily: SavedSearch = { ...search, filters: { ...EMPTY_FILTERS, jobFamilies: ['design_ux'] } }
  it('alerte pour un candidat de la famille choisie, pas pour un autre métier ni pour un CV pas encore classé', () => {
    assert.equal(shouldAlert(byFamily, candidate, { newCv: true, now }), true)
    assert.equal(shouldAlert(byFamily, { ...candidate, jobFamily: 'rh' }, { newCv: true, now }), false)
    assert.equal(shouldAlert(byFamily, { ...candidate, jobFamily: null }, { newCv: true, now }), false)
  })
  it('lit la famille passée par la classification', () => {
    assert.equal(searchableCandidateOf({ cvProfileJson: '{}' }, 'rh').jobFamily, 'rh')
    assert.equal(searchableCandidateOf({ cvProfileJson: '{}' }).jobFamily, null)
  })
})
