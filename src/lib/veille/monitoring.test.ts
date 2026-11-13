import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { VeilleConfig } from './config'
import { buildVeilleMonitoring, siteOfOffer, type MonitoredOffer, type StoredRun } from './monitoring'
import { parseRunReport, runDocumentId, veilleSourceOf, type RunReport, type SourceRunReport } from './run-report'

// Réglages et rapports fictifs, au format du scanner veille-marches-emplois.
const config = (overrides: Partial<VeilleConfig> = {}): VeilleConfig => ({
  schemaVersion: 1,
  organisations: [
    { id: 'insee', name: 'INSEE', enabled: true, tenderRules: [] },
    { id: 'dinum', name: 'DINUM', enabled: true, tenderRules: [] },
    { id: 'agence-fictive', name: 'Agence fictive', enabled: false, tenderRules: [] },
    { id: 'banque-postale', name: 'La Banque Postale', enabled: true, tenderRules: [] },
    { id: 'proparco', name: 'Proparco', enabled: true, tenderRules: [] },
    { id: 'autorite-concurrence', name: 'Autorité de la concurrence', enabled: true, tenderRules: [] },
    { id: 'crh', name: 'CRH', enabled: true, tenderRules: [] },
  ],
  sources: [
    { kind: 'boamp', id: 'boamp', enabled: true },
    { kind: 'ted', id: 'ted', enabled: false },
    { kind: 'builtin', id: 'crh-site', enabled: true },
    { kind: 'csp', id: 'csp-insee', enabled: true, organisationId: 'insee', label: 'Choisir le service public — INSEE', codes: ['978'] },
    { kind: 'rss', id: 'agence-fictive-carrieres', enabled: true, organisationId: 'agence-fictive', label: 'Agence fictive — carrières', url: 'https://carrieres.exemple.test/feed', readOfferPage: false },
    { kind: 'csp', id: 'csp-dinum', enabled: true, organisationId: 'dinum', label: 'Choisir le service public — DINUM', codes: ['1001'] },
  ],
  itScope: { enabled: true, cpvPrefixes: ['72'], boampDescriptors: [], phrases: ['développeur*'], acronyms: ['SI'], exclusionPhrases: [] },
  tenderKeywords: { allBuyers: true, families: [], infrastructurePhrases: [] },
  ...overrides,
})

const read = (id: string, overrides: Partial<SourceRunReport> = {}): SourceRunReport => ({
  id, label: `Source ${id}`, kind: 'tender', ok: true, error: null, listed: 10, outOfScope: 2, new: 3, sent: 3, outdated: 0, pending: 0, warnings: [], ...overrides,
})

const run = (startedAt: string, sources: SourceRunReport[], overrides: Partial<RunReport> = {}): StoredRun => ({
  report: {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date(Date.parse(startedAt) + 4 * 60_000).toISOString(),
    settings: { origin: 'remote', version: 12 },
    deliveryError: null,
    sources,
    otherWarnings: [],
    ...overrides,
  },
})

const offer = (veilleSource: string, status: MonitoredOffer['status'], receivedAt = '2026-11-09T09:10:00.000Z', channel: MonitoredOffer['channel'] = 'scraping'): MonitoredOffer =>
  ({ veilleSource, status, receivedAt, channel })

const NOW = new Date('2026-11-10T10:00:00Z')
/** 30 derniers jours au 2026-11-10, comme à l'ouverture de la page. */
const PERIOD = { from: '2026-10-12', to: '2026-11-10' }
const monitor = (input: Partial<Parameters<typeof buildVeilleMonitoring>[0]> = {}) =>
  buildVeilleMonitoring({ config: config(), configVersion: 12, runs: [], offers: [], period: PERIOD, now: NOW, ...input })
const site = (m: ReturnType<typeof monitor>, id: string) => m.sites.find(s => s.id === id)

describe('en-tête X-Wise-Veille-Source', () => {
  it('garde un identifiant de source et refuse tout le reste', () => {
    assert.equal(veilleSourceOf(' csp-dgfip '), 'csp-dgfip')
    assert.equal(veilleSourceOf('boamp-tous-acheteurs'), 'boamp-tous-acheteurs')
    assert.equal(veilleSourceOf('BOAMP'), '')
    assert.equal(veilleSourceOf('boamp\r\nX-Autre: 1'), '')
    assert.equal(veilleSourceOf('x'.repeat(51)), '')
    assert.equal(veilleSourceOf(undefined), '')
    assert.equal(veilleSourceOf(['boamp']), '')
  })
})

describe('rapport de passage reçu', () => {
  it('accepte le rapport du scanner', () => {
    const parsed = parseRunReport(run('2026-11-10T09:00:00.000Z', [read('boamp')]).report)
    assert.equal(parsed.success, true)
  })

  it('refuse un autre format, sans recopier la valeur reçue', () => {
    const bad = { ...run('2026-11-10T09:00:00.000Z', [read('boamp')]).report, schemaVersion: 2 }
    const parsed = parseRunReport(bad)
    assert.equal(parsed.success, false)
    if (!parsed.success) assert.match(parsed.error, /^schemaVersion : /)
  })

  it('refuse un identifiant de source, un nombre ou un message hors des bornes', () => {
    const report = run('2026-11-10T09:00:00.000Z', [read('boamp')]).report
    assert.equal(parseRunReport({ ...report, sources: [read('Boamp Fictif')] }).success, false)
    assert.equal(parseRunReport({ ...report, sources: [read('boamp', { sent: -1 })] }).success, false)
    assert.equal(parseRunReport({ ...report, sources: [read('boamp', { error: 'x'.repeat(301) })] }).success, false)
    assert.equal(parseRunReport({ ...report, startedAt: 'hier' }).success, false)
  })

  it('identifie un passage par l\'instant de son début : un rapport renvoyé retombe sur le même document', () => {
    assert.equal(runDocumentId('2026-11-10T09:00:03.123Z'), 'run_20261110090003123')
    assert.equal(runDocumentId('2026-11-10T09:00:03Z'), runDocumentId('2026-11-10T09:00:03.000Z'))
  })

  it('reçu par la route : refuse un passage daté dans le futur, trop ancien, ou fini avant d\'avoir commencé', () => {
    const now = new Date('2026-11-10T10:00:00Z')
    const at = (startedAt: string, finishedAt: string) => ({ ...run(startedAt, [read('boamp')]).report, finishedAt })
    assert.equal(parseRunReport(at('2026-11-10T09:00:00.000Z', '2026-11-10T09:04:00.000Z'), now).success, true)
    assert.equal(parseRunReport(at('2026-11-10T10:05:00.000Z', '2026-11-10T10:06:00.000Z'), now).success, true, 'décalage d\'horloge toléré')
    assert.equal(parseRunReport(at('2099-01-01T00:00:00.000Z', '2099-01-01T00:04:00.000Z'), now).success, false)
    assert.equal(parseRunReport(at('2026-11-07T09:00:00.000Z', '2026-11-07T09:04:00.000Z'), now).success, false)
    assert.equal(parseRunReport(at('2026-11-10T09:00:00.000Z', '2026-11-10T08:59:00.000Z'), now).success, false)
    assert.equal(parseRunReport(at('2026-11-10T09:00:00.000Z', '2099-01-01T00:00:00.000Z'), now).success, false)
    // Rapport déjà enregistré, relu des semaines plus tard : seul le format compte.
    assert.equal(parseRunReport(at('2026-10-01T09:00:00.000Z', '2026-10-01T09:04:00.000Z')).success, true)
  })
})

describe('suivi des sources par site', () => {
  it('un site par site source : BOAMP et TED avec leur recherche chez tous les acheteurs, Choisir le service public en un seul', () => {
    const m = monitor()
    assert.deepEqual(m.sites.map(s => s.id), ['boamp', 'ted', 'crh-site', 'choisir-le-service-public', 'agence-fictive-carrieres', 'e-mails'])
    assert.deepEqual(site(m, 'boamp')?.searches.map(s => s.id), ['boamp', 'boamp-tous-acheteurs'])
    assert.deepEqual(site(m, 'choisir-le-service-public')?.searches.map(s => s.id), ['csp-insee', 'csp-dinum'])
    assert.equal(site(m, 'choisir-le-service-public')?.label, 'Choisir le service public')
    assert.equal(site(m, 'crh-site')?.label, 'CRH — page d\'accueil (annonce PDF)')
    assert.equal(site(m, 'agence-fictive-carrieres')?.label, 'Agence fictive — carrières')
    assert.deepEqual(m.sites.map(s => s.kind), ['tender', 'tender', 'job', 'job', 'job', 'email'])
  })

  it('état du site : la plus grave de ses recherches lues ; désactivé seulement si toutes sont éteintes', () => {
    const m = monitor({ runs: [run('2026-11-10T09:00:00.000Z', [
      read('boamp'), read('boamp-tous-acheteurs', { warnings: ['Page modifiée ?'] }),
      read('csp-insee', { ok: false, error: 'HTTP 503', listed: 0 }), read('csp-dinum'), read('crh-site'),
    ])] })
    assert.equal(site(m, 'boamp')?.health, 'warning')
    assert.equal(site(m, 'boamp')?.warning, 1)
    const csp = site(m, 'choisir-le-service-public')
    assert.equal(csp?.health, 'error')
    assert.deepEqual([csp?.failing, csp?.active], [1, 2])
    assert.equal(site(m, 'crh-site')?.health, 'ok')
    assert.equal(site(m, 'ted')?.health, 'disabled', 'TED et sa recherche chez tous les acheteurs éteints')
    assert.equal(site(m, 'agence-fictive-carrieres')?.health, 'disabled', 'organisme désactivé')
    assert.equal(site(m, 'e-mails')?.health, null, 'sans objet pour la boîte AO')

    const partial = monitor({ config: config({ tenderKeywords: { allBuyers: false, families: [], infrastructurePhrases: [] } }) })
    assert.equal(partial.sites.find(s => s.id === 'boamp')?.searches.find(s => s.id === 'boamp-tous-acheteurs')?.health, 'disabled')
    assert.equal(site(partial, 'boamp')?.health, 'never', 'recherche des organismes suivis encore active')
  })

  it('garde l\'état de chaque recherche : échecs de suite, dernière lecture réussie, non lue au dernier passage', () => {
    const m = monitor({ runs: [
      run('2026-11-09T05:00:00.000Z', [read('boamp', { ok: false, error: 'HTTP 503', listed: 0 }), read('csp-insee')]),
      run('2026-11-10T09:00:00.000Z', [read('boamp', { ok: false, error: 'HTTP 503', listed: 0 }), read('csp-insee')]),
      run('2026-11-08T17:00:00.000Z', [read('boamp'), read('csp-insee'), read('csp-dinum')]),
    ] })
    const boamp = site(m, 'boamp')?.searches.find(s => s.id === 'boamp')
    assert.equal(boamp?.health, 'error')
    assert.equal(boamp?.consecutiveFailures, 2)
    assert.equal(boamp?.lastSuccessAt, '2026-11-08T17:00:00.000Z')
    assert.equal(boamp?.lastRun?.error, 'HTTP 503')
    const csp = site(m, 'choisir-le-service-public')
    assert.equal(csp?.searches.find(s => s.id === 'csp-dinum')?.health, 'skipped', 'activée mais absente du dernier passage')
    assert.equal(csp?.health, 'skipped')
    assert.equal(csp?.lastSuccessAt, '2026-11-10T09:00:00.000Z', 'la plus récente de ses recherches')
    assert.equal(m.lastRunAt, '2026-11-10T09:00:00.000Z')
    assert.equal(m.firstRunAt, '2026-11-08T17:00:00.000Z')
    assert.equal(m.stale, false)
  })

  it('chiffres de lecture sur la période choisie : un passage compté une fois par site, une annonce en attente une fois', () => {
    const m = monitor({ runs: [
      // 300 nouvelles, 200 envoyées : les 100 autres redeviennent nouvelles au passage suivant.
      run('2026-11-09T09:00:00.000Z', [read('boamp', { new: 300, sent: 200, pending: 100, outOfScope: 4 }), read('csp-insee', { sent: 2 }), read('csp-dinum', { sent: 1 })]),
      run('2026-11-10T09:00:00.000Z', [read('boamp', { new: 100, sent: 99, outdated: 1, outOfScope: 0 }), read('boamp-tous-acheteurs', { sent: 5, outOfScope: 0 })]),
      run('2026-10-01T09:00:00.000Z', [read('boamp')]),
    ] })
    assert.deepEqual(site(m, 'boamp')?.reads, { runs: 2, sent: 304, outOfScope: 4, outdated: 1 })
    assert.deepEqual(site(m, 'choisir-le-service-public')?.reads, { runs: 1, sent: 3, outOfScope: 4, outdated: 0 })
    const lastWeek = monitor({ period: { from: '2026-11-10', to: '2026-11-10' }, runs: [run('2026-11-09T09:00:00.000Z', [read('boamp')]), run('2026-11-10T09:00:00.000Z', [read('boamp', { sent: 7 })])] })
    assert.deepEqual(site(lastWeek, 'boamp')?.reads, { runs: 1, sent: 7, outOfScope: 2, outdated: 0 })
    // Bornes de la période en jours UTC : premier instant du premier jour et dernier instant du dernier jour compris.
    const edges = monitor({ period: { from: '2026-11-01', to: '2026-11-09' }, runs: [
      run('2026-11-01T00:00:00.000Z', [read('boamp', { sent: 1 })]), run('2026-11-09T23:59:59.000Z', [read('boamp', { sent: 2 })]),
      run('2026-10-31T23:59:59.000Z', [read('boamp', { sent: 4 })]), run('2026-11-10T00:00:00.000Z', [read('boamp', { sent: 8 })]),
    ] })
    assert.equal(site(edges, 'boamp')?.reads.sent, 3)
  })

  it('offres AO de la période par site et par statut ; e-mails AO et veille sans source à part', () => {
    const m = monitor({ offers: [
      offer('boamp', 'published'), offer('boamp-tous-acheteurs', 'to_review'), offer('boamp', 'ignored', '2026-09-01T09:00:00.000Z'),
      offer('csp-dinum', 'to_review'), offer('csp-insee', 'published'),
      offer('', 'to_review'), offer('', 'published', '2026-11-09T09:00:00.000Z', 'email'), offer('boamp', 'published', '2026-11-09T09:00:00.000Z', 'email'),
    ] })
    assert.deepEqual(site(m, 'boamp')?.offers, { total: 2, byStatus: { published: 1, to_review: 1, ignored: 0 } }, 'hors période : écartée')
    assert.deepEqual(site(m, 'choisir-le-service-public')?.offers, { total: 2, byStatus: { published: 1, to_review: 1, ignored: 0 } })
    assert.deepEqual(site(m, 'e-mails')?.offers, { total: 2, byStatus: { published: 2, to_review: 0, ignored: 0 } }, 'un en-tête de source sur un e-mail ordinaire ne compte pas')
    assert.deepEqual(site(m, 'veille-sans-source')?.offers, { total: 1, byStatus: { published: 0, to_review: 1, ignored: 0 } })
    assert.equal(site(m, 'veille-sans-source')?.health, null)
    assert.equal(site(monitor(), 'veille-sans-source'), undefined, 'proposée seulement si elle a des offres')
    assert.equal(siteOfOffer({ channel: 'scraping', veilleSource: 'ted-tous-acheteurs' }, config()).id, 'ted')
  })

  it('garde une recherche retirée des réglages, rattachée à son site quand on le connaît', () => {
    const m = monitor({
      runs: [run('2026-11-10T09:00:00.000Z', [read('ancienne-source', { label: 'Ancienne source fictive', kind: 'job' })])],
      offers: [offer('ancienne-source', 'published'), offer('csp-ancien-organisme', 'published'), offer('autre-ancienne', 'published')],
    })
    assert.deepEqual([site(m, 'ancienne-source')?.label, site(m, 'ancienne-source')?.kind, site(m, 'ancienne-source')?.health], ['Ancienne source fictive', 'job', 'removed'])
    assert.equal(site(m, 'ancienne-source')?.offers.total, 1)
    // La page filtre les offres par ce même identifiant de site (page.tsx) : il doit être celui de la ligne du tableau.
    for (const id of ['ancienne-source', 'csp-ancien-organisme', 'autre-ancienne']) {
      assert.ok(m.sites.some(s => s.id === siteOfOffer({ channel: 'scraping', veilleSource: id }, config()).id), id)
    }
    assert.equal(site(m, 'choisir-le-service-public')?.offers.total, 1, 'identifiant des recherches de Choisir le service public')
    assert.deepEqual([site(m, 'autre-ancienne')?.kind, site(m, 'autre-ancienne')?.health], ['unknown', 'removed'])
  })

  it('réglages illisibles : sites des rapports et des offres, sans les déclarer désactivés', () => {
    const m = monitor({ config: null, configVersion: null, runs: [run('2026-11-10T09:00:00.000Z', [read('boamp'), read('csp-insee', { label: 'Choisir le service public — INSEE', kind: 'job' })])] })
    assert.deepEqual(m.sites.map(s => [s.id, s.health]), [['boamp', 'ok'], ['choisir-le-service-public', 'ok'], ['e-mails', null]])
  })

  it('rapports illisibles : états et chiffres de lecture inconnus, offres comptées', () => {
    const m = monitor({ runs: null, offers: [offer('boamp', 'published')] })
    assert.equal(m.readsKnown, false)
    assert.ok(m.sites.every(s => s.health === null))
    assert.equal(site(m, 'boamp')?.offers.total, 1)
  })

  it('signale un scanner muet depuis plus de 13 heures, ou des réglages qui ne sont pas ceux en vigueur', () => {
    assert.equal(monitor().stale, true, 'aucun rapport')
    assert.equal(monitor({ runs: [run('2026-11-09T17:00:00.000Z', [])] }).stale, true)
    assert.equal(monitor({ runs: [run('2026-11-09T21:00:00.000Z', [])] }).stale, false)
    assert.equal(monitor({ runs: [run('2026-11-10T09:00:00.000Z', [])] }).settings?.outdated, false)
    assert.equal(monitor({ configVersion: 13, runs: [run('2026-11-10T09:00:00.000Z', [])] }).settings?.outdated, true)
    assert.equal(monitor({ runs: [run('2026-11-10T09:00:00.000Z', [], { settings: { origin: 'snapshot', version: 12 } })] }).settings?.outdated, true)
  })
})
