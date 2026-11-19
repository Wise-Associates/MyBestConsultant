import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  nextScraperStatus,
  parseScraperStatusReport,
  scraperSessionAlerts,
  type ScraperStatus,
  type ScraperStatusReport,
} from './scraper-status'

// États fictifs, au format du scraper french-tender-scraper (src/alerts/mbc-status.ts).
const now = new Date('2026-11-19T07:00:00.000Z')
const report = (overrides: Partial<ScraperStatusReport> = {}): ScraperStatusReport => ({
  schemaVersion: 1,
  site: 'partenaire-gc',
  state: 'session_expired',
  checkedAt: '2026-11-19T06:55:00.000Z',
  ...overrides,
})
const stored = (overrides: Partial<ScraperStatus> = {}): ScraperStatus => ({
  site: 'partenaire-gc',
  state: 'session_expired',
  since: '2026-11-18T07:00:00.000Z',
  checkedAt: '2026-11-18T19:00:00.000Z',
  ...overrides,
})

describe('parseScraperStatusReport', () => {
  it('accepte un état du scraper', () => {
    assert.deepEqual(parseScraperStatusReport(report(), now), { success: true, report: report() })
  })

  it('refuse un format inconnu sans répéter la valeur reçue', () => {
    const bad = parseScraperStatusReport({ ...report(), state: 'tout-va-bien' }, now)
    assert.equal(bad.success, false)
    assert.match(!bad.success ? bad.error : '', /^state : /)
    assert.doesNotMatch(!bad.success ? bad.error : '', /tout-va-bien/)
    assert.equal(parseScraperStatusReport({ ...report(), schemaVersion: 2 }, now).success, false)
  })

  it('n’accepte que les sites connus, sans texte choisi par l’envoyeur', () => {
    for (const site of ['support', 'Partenaire GC', '-partenaire']) {
      assert.equal(parseScraperStatusReport({ ...report(), site }, now).success, false, site)
    }
    const withLabel = parseScraperStatusReport({ ...report(), label: 'Reconnectez-vous sur https://exemple.test' }, now)
    assert.deepEqual(withLabel.success && withLabel.report, report(), 'champ inconnu ignoré, jamais gardé')
  })

  it('refuse un contrôle trop ancien ou dans le futur', () => {
    assert.equal(parseScraperStatusReport(report({ checkedAt: '2026-11-16T07:00:00.000Z' }), now).success, false)
    assert.equal(parseScraperStatusReport(report({ checkedAt: '2099-01-01T00:00:00.000Z' }), now).success, false)
    assert.equal(parseScraperStatusReport(report({ checkedAt: '2026-11-19T07:05:00.000Z' }), now).success, true, 'décalage d’horloge toléré')
  })
})

describe('nextScraperStatus', () => {
  it('enregistre le premier état reçu, depuis ce contrôle', () => {
    assert.deepEqual(nextScraperStatus(null, report()), {
      site: 'partenaire-gc',
      state: 'session_expired',
      since: '2026-11-19T06:55:00.000Z',
      checkedAt: '2026-11-19T06:55:00.000Z',
    })
  })

  it('garde la date du premier constat tant que l’état ne change pas', () => {
    assert.equal(nextScraperStatus(stored(), report())?.since, '2026-11-18T07:00:00.000Z')
  })

  it('repart de ce contrôle quand l’état change', () => {
    const next = nextScraperStatus(stored(), report({ state: 'ok' }))
    assert.equal(next?.state, 'ok')
    assert.equal(next?.since, '2026-11-19T06:55:00.000Z')
  })

  it('ne ramène jamais un état passé (nouvelle tentative ou arrivée dans le désordre)', () => {
    assert.equal(nextScraperStatus(stored({ state: 'ok', checkedAt: '2026-11-19T06:55:00.000Z' }), report()), null)
    assert.equal(nextScraperStatus(stored({ checkedAt: '2026-11-19T08:00:00.000Z' }), report({ state: 'ok' })), null)
  })
})

describe('scraperSessionAlerts', () => {
  it('un bandeau par session expirée, nom du site fixé par MyBestConsultant, avec la commande et les dates', () => {
    const alerts = scraperSessionAlerts([stored()])
    assert.equal(alerts.length, 1)
    assert.match(alerts[0], /^Session Partenaire GC expirée depuis le 18\/11\/2026/)
    assert.match(alerts[0], /npm run login:session -- partenaire-gc/)
    assert.match(alerts[0], /Dernier contrôle le 18\/11\/2026\.$/)
  })

  it('aucun bandeau quand les sessions sont valides', () => {
    assert.deepEqual(scraperSessionAlerts([stored({ state: 'ok' })]), [])
    assert.deepEqual(scraperSessionAlerts([]), [])
  })
})
