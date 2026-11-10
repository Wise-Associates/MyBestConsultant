import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { VeilleConfig } from './config'
import { buildVeilleMonitoring, type MonitoredOffer, type StoredRun } from './monitoring'
import { parseRunReport, runDocumentId, veilleSourceOf, type RunReport, type SourceRunReport } from './run-report'

// Réglages et rapports fictifs, au format du scanner veille-marches-emplois.
const config = (overrides: Partial<VeilleConfig> = {}): VeilleConfig => ({
  schemaVersion: 1,
  organisations: [
    { id: 'insee', name: 'INSEE', enabled: true, tenderRules: [] },
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
const monitor = (input: Partial<Parameters<typeof buildVeilleMonitoring>[0]> = {}) =>
  buildVeilleMonitoring({ config: config(), configVersion: 12, runs: [], offers: [], now: NOW, ...input })
const source = (m: ReturnType<typeof monitor>, id: string) => m.sources.find(s => s.id === id)

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

describe('suivi des sources', () => {
  it('liste les sources des réglages, avec la recherche chez tous les acheteurs après BOAMP et TED', () => {
    const m = monitor()
    assert.deepEqual(m.sources.map(s => s.id), ['boamp', 'boamp-tous-acheteurs', 'ted', 'ted-tous-acheteurs', 'crh-site', 'csp-insee', 'agence-fictive-carrieres'])
    assert.equal(source(m, 'crh-site')?.organisation, 'CRH')
    assert.equal(source(m, 'boamp-tous-acheteurs')?.organisation, 'Autres acheteurs')
  })

  it('désactivée : source éteinte, organisme éteint, ou recherche chez tous les acheteurs coupée', () => {
    const m = monitor({ config: config({ tenderKeywords: { allBuyers: false, families: [], infrastructurePhrases: [] } }) })
    assert.equal(source(m, 'ted')?.health, 'disabled')
    assert.equal(source(m, 'ted-tous-acheteurs')?.health, 'disabled')
    assert.equal(source(m, 'boamp-tous-acheteurs')?.health, 'disabled')
    assert.equal(source(m, 'agence-fictive-carrieres')?.health, 'disabled', 'organisme désactivé')
    assert.equal(source(m, 'boamp')?.health, 'never')
  })

  it('état d\'après le dernier passage : en échec (avec le nombre de passages de suite), à vérifier, OK', () => {
    const m = monitor({
      runs: [
        run('2026-11-09T05:00:00.000Z', [read('boamp', { ok: false, error: 'HTTP 503', listed: 0 }), read('csp-insee')]),
        run('2026-11-10T09:00:00.000Z', [read('boamp', { ok: false, error: 'HTTP 503', listed: 0 }), read('csp-insee', { warnings: ['Page modifiée ?'] }), read('crh-site')]),
        run('2026-11-08T17:00:00.000Z', [read('boamp'), read('csp-insee')]),
      ],
    })
    const boamp = source(m, 'boamp')
    assert.equal(boamp?.health, 'error')
    assert.equal(boamp?.consecutiveFailures, 2)
    assert.equal(boamp?.lastSuccessAt, '2026-11-08T17:00:00.000Z')
    assert.equal(boamp?.lastRun?.error, 'HTTP 503')
    assert.equal(source(m, 'csp-insee')?.health, 'warning')
    assert.equal(source(m, 'crh-site')?.health, 'ok')
    assert.equal(monitor({ runs: [run('2026-11-10T09:00:00.000Z', [read('boamp')]), run('2026-11-09T09:00:00.000Z', [read('crh-site')])] }).sources.find(s => s.id === 'crh-site')?.health,
      'skipped', 'activée mais absente du dernier passage')
    assert.equal(m.lastRunAt, '2026-11-10T09:00:00.000Z')
    assert.equal(m.stale, false)
  })

  it('totaux sur 30 jours seulement, sans compter deux fois une offre en attente d\'un passage à l\'autre', () => {
    const m = monitor({ runs: [
      // 300 nouvelles, 200 envoyées : les 100 autres redeviennent nouvelles au passage suivant.
      run('2026-11-09T09:00:00.000Z', [read('boamp', { new: 300, sent: 200, outdated: 0, pending: 100, outOfScope: 4 })]),
      run('2026-11-10T09:00:00.000Z', [read('boamp', { new: 100, sent: 99, outdated: 1, pending: 0, outOfScope: 0 })]),
      run('2026-10-01T09:00:00.000Z', [read('boamp')]),
    ] })
    assert.deepEqual(source(m, 'boamp')?.window, { runs: 2, sent: 299, outOfScope: 4, outdated: 1 })
  })

  it('compte les offres AO de chaque source par statut ; celles sans source à part ; jamais les e-mails ordinaires', () => {
    const m = monitor({
      offers: [
        offer('boamp', 'published'), offer('boamp', 'to_review'), offer('boamp', 'ignored', '2026-09-01T09:00:00.000Z'),
        offer('', 'to_review'), offer('', 'published', '2026-11-09T09:00:00.000Z', 'email'),
      ],
    })
    assert.deepEqual(source(m, 'boamp')?.offers, { total: 3, recent: 2, byStatus: { published: 1, to_review: 1, ignored: 1 } })
    assert.deepEqual(m.unknownOffers, { total: 1, recent: 1, byStatus: { published: 0, to_review: 1, ignored: 0 } })
  })

  it('garde une source retirée des réglages tant qu\'elle a des passages ou des offres', () => {
    const m = monitor({ runs: [run('2026-11-10T09:00:00.000Z', [read('ancienne-source', { label: 'Ancienne source fictive', kind: 'job' })])], offers: [offer('autre-ancienne', 'published')] })
    assert.equal(source(m, 'ancienne-source')?.health, 'removed')
    assert.equal(source(m, 'ancienne-source')?.label, 'Ancienne source fictive')
    assert.equal(source(m, 'autre-ancienne')?.health, 'removed')
  })

  it('réglages illisibles : seules les sources des rapports, sans les déclarer désactivées', () => {
    const m = monitor({ config: null, configVersion: null, runs: [run('2026-11-10T09:00:00.000Z', [read('boamp')])] })
    assert.deepEqual(m.sources.map(s => [s.id, s.health]), [['boamp', 'ok']])
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
