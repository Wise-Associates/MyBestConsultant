import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readConfig } from './config.mjs'
import { callSync, describeReport, readReport } from './sync-client.mjs'
import { BACKLOG_RETRY_MS, BUSY_RETRY_MS, DEBOUNCE_MS, ERROR_RETRY_MS, createSyncTrigger } from './trigger.mjs'

const VALID_ENV = {
  AO_IMAP_USER: 'ao@example.test',
  AO_IMAP_PASSWORD: 'mot-de-passe',
  CRON_SECRET: 'x'.repeat(32),
  AO_SYNC_URL: 'https://site.example.test/api/cron/ao-inbox',
}

describe('readConfig', () => {
  it('applique les valeurs par défaut du site', () => {
    const result = readConfig(VALID_ENV)
    assert.equal(result.ok, true)
    assert.equal(result.config.imap.host, 'imap.ionos.fr')
    assert.equal(result.config.imap.port, 993)
    assert.equal(result.config.imap.mailbox, 'INBOX')
    assert.equal(result.config.fallbackMs, 15 * 60_000)
  })

  it('refuse un démarrage incomplet, avec toutes les raisons', () => {
    const result = readConfig({ CRON_SECRET: 'court' })
    assert.equal(result.ok, false)
    assert.equal(result.errors.length, 3)
  })

  it('exige https, sauf vers le poste local', () => {
    assert.equal(readConfig({ ...VALID_ENV, AO_SYNC_URL: 'http://site.example.test/api/cron/ao-inbox' }).ok, false)
    for (const url of ['http://localhost:3000/api/cron/ao-inbox', 'http://127.0.0.1:3000/x', 'http://[::1]:3000/x']) {
      assert.equal(readConfig({ ...VALID_ENV, AO_SYNC_URL: url }).ok, true, url)
    }
  })

  it('borne l\'intervalle de secours entre 1 min et 1 jour', () => {
    assert.equal(readConfig({ ...VALID_ENV, AO_IDLE_FALLBACK_MINUTES: '0' }).ok, false)
    assert.equal(readConfig({ ...VALID_ENV, AO_IDLE_FALLBACK_MINUTES: 'abc' }).ok, false)
    // Au-delà, setInterval déborde et tournerait toutes les millisecondes.
    assert.equal(readConfig({ ...VALID_ENV, AO_IDLE_FALLBACK_MINUTES: '99999' }).ok, false)
    assert.equal(readConfig({ ...VALID_ENV, AO_IDLE_FALLBACK_MINUTES: '2' }).config.fallbackMs, 120_000)
    assert.equal(readConfig({ ...VALID_ENV, AO_IDLE_FALLBACK_MINUTES: '1440' }).ok, true)
  })

  it('refuse les valeurs que fetch recopierait en entier dans le journal', () => {
    assert.equal(readConfig({ ...VALID_ENV, CRON_SECRET: `${'x'.repeat(20)}\n${'y'.repeat(20)}` }).ok, false)
    const withCredentials = new URL(VALID_ENV.AO_SYNC_URL)
    withCredentials.username = 'moi'
    withCredentials.password = 'factice'
    assert.equal(readConfig({ ...VALID_ENV, AO_SYNC_URL: withCredentials.href }).ok, false)
  })

  it('en local (npm run ao:idle), ne vise jamais un autre serveur que le poste', () => {
    const result = readConfig(VALID_ENV, { localOnly: true })
    assert.equal(result.ok, false)
    assert.match(result.errors[0], /ne vise que le serveur local/)
    assert.equal(readConfig({ ...VALID_ENV, AO_SYNC_URL: 'http://localhost:3000/api/cron/ao-inbox' }, { localOnly: true }).ok, true)
  })
})

/** Horloge et minuteries simulées : `advance` exécute dans l'ordre les minuteries échues. */
function fakeClock() {
  let time = 0
  const timers = []
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return {
    now: () => time,
    schedule(fn, ms) {
      const timer = { at: time + ms, fn, done: false }
      timers.push(timer)
      return () => { timer.done = true }
    },
    async advance(ms) {
      const end = time + ms
      await settle()
      for (;;) {
        const next = timers.filter(t => !t.done && t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        time = next.at
        next.done = true
        next.fn()
        await settle()
      }
      time = end
      await settle()
    },
  }
}

const OK = { skipped: false, remaining: 0 }

/** Déclencheur dont chaque appel renvoie la réponse suivante de `outcomes` (une Error est levée). */
function setup(outcomes = []) {
  const clock = fakeClock()
  const calls = []
  const errors = []
  const trigger = createSyncTrigger({
    call: async () => {
      calls.push(clock.now())
      const outcome = outcomes.length ? outcomes.shift() : OK
      if (outcome instanceof Error) throw outcome
      return typeof outcome === 'function' ? outcome() : outcome
    },
    schedule: clock.schedule,
    now: clock.now,
    logError: line => errors.push(line),
  })
  return { clock, calls, errors, trigger }
}

describe('createSyncTrigger', () => {
  it('regroupe une rafale de messages en un seul appel', async () => {
    const { clock, calls, trigger } = setup()
    trigger.request()
    await clock.advance(1_000)
    trigger.request()
    trigger.request()
    await clock.advance(10 * 60_000)
    assert.deepEqual(calls, [DEBOUNCE_MS])
  })

  it('relance un appel si un message arrive pendant le passage', async () => {
    let finish
    const { clock, calls, trigger } = setup([() => new Promise(resolve => { finish = () => resolve(OK) })])
    trigger.request()
    await clock.advance(DEBOUNCE_MS)
    trigger.request()
    trigger.request()
    assert.equal(calls.length, 1, 'jamais deux appels à la fois')
    await clock.advance(20_000)
    finish()
    await clock.advance(DEBOUNCE_MS)
    assert.deepEqual(calls, [DEBOUNCE_MS, 25_000 + DEBOUNCE_MS])
  })

  it('réessaie quand une autre synchronisation tient le verrou', async () => {
    const { clock, calls, trigger } = setup([{ skipped: true, remaining: 0 }])
    trigger.request()
    await clock.advance(10 * 60_000)
    assert.deepEqual(calls, [DEBOUNCE_MS, DEBOUNCE_MS + BUSY_RETRY_MS])
  })

  it('poursuit tant que du courrier reste à traiter', async () => {
    const { clock, calls, trigger } = setup([{ skipped: false, remaining: 40 }, { skipped: false, remaining: 15 }])
    trigger.request()
    await clock.advance(10 * 60_000)
    assert.deepEqual(calls, [DEBOUNCE_MS, DEBOUNCE_MS + BACKLOG_RETRY_MS, DEBOUNCE_MS + 2 * BACKLOG_RETRY_MS])
  })

  it('espace les essais après une erreur, puis repart à zéro après un succès', async () => {
    const down = new Error('site injoignable')
    const { clock, calls, errors, trigger } = setup([down, down, down, down, OK, down])
    trigger.request()
    await clock.advance(60 * 60_000)
    const gaps = calls.slice(1).map((at, i) => at - calls[i])
    assert.deepEqual(gaps, [...ERROR_RETRY_MS, ERROR_RETRY_MS.at(-1)])
    assert.equal(errors.length, 4)
    assert.match(errors[0], /site injoignable — nouvel essai dans 1 min/)

    trigger.request()
    await clock.advance(DEBOUNCE_MS)
    await clock.advance(ERROR_RETRY_MS[0] - 1)
    assert.equal(calls.length, 6, 'après un succès, le premier délai d\'erreur est de nouveau 1 min')
  })

  it('ne raccourcit pas l\'attente après une erreur quand un message arrive', async () => {
    const { clock, calls, trigger } = setup([new Error('HTTP 500')])
    trigger.request()
    await clock.advance(DEBOUNCE_MS)
    trigger.request()
    await clock.advance(ERROR_RETRY_MS[0] - 1)
    assert.equal(calls.length, 1)
    await clock.advance(1)
    assert.equal(calls.length, 2)
  })

  it('garde l\'appel prévu le plus tôt', async () => {
    const { clock, calls, trigger } = setup([{ skipped: false, remaining: 3 }])
    trigger.request()
    await clock.advance(DEBOUNCE_MS)
    trigger.request()
    await clock.advance(BACKLOG_RETRY_MS)
    assert.deepEqual(calls, [DEBOUNCE_MS, 2 * DEBOUNCE_MS])
  })

  it('n\'appelle plus rien une fois arrêté', async () => {
    const { clock, calls, trigger } = setup()
    trigger.request()
    trigger.stop()
    trigger.request()
    await clock.advance(10 * 60_000)
    assert.equal(calls.length, 0)
  })
})

const SYNC_URL = new URL('https://site.example.test/api/cron/ao-inbox')
const SECRET = 's'.repeat(32)
const REPORT = { configured: true, skipped: false, mode: 'incremental', pending: 2, processed: 2, offersCreated: 1, duplicates: 1, noOffer: 0, failed: 0, remaining: 0, errors: [] }
const respond = (status, body, headers = {}) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })

describe('callSync', () => {
  it('envoie le secret et renvoie le compte rendu', async () => {
    let seen
    const report = await callSync({
      url: SYNC_URL,
      secret: SECRET,
      fetchImpl: async (url, init) => { seen = { url: String(url), init }; return respond(200, REPORT)() },
    })
    assert.equal(seen.url, SYNC_URL.href)
    assert.equal(seen.init.headers.Authorization, `Bearer ${SECRET}`)
    assert.equal(seen.init.redirect, 'manual')
    assert.equal(report.offersCreated, 1)
  })

  it('signale une redirection au lieu de perdre le secret', async () => {
    await assert.rejects(
      callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: respond(308, '', { location: 'https://www.site.example.test/api/cron/ao-inbox' }) }),
      /redirection 308 vers https:\/\/www\.site\.example\.test.*AO_SYNC_URL/,
    )
  })

  it('explique un 401, une erreur du site et une page non JSON', async () => {
    await assert.rejects(callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: respond(401, { error: 'Unauthorized' }) }), /401 : accès refusé \(CRON_SECRET différent/)
    await assert.rejects(
      callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: respond(500, { error: 'Synchronisation AO échouée', detail: 'fetch failed (ETIMEDOUT)' }) }),
      /HTTP 500 : fetch failed \(ETIMEDOUT\)/,
    )
    await assert.rejects(callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: respond(502, '<html>Bad gateway</html>') }), /^Error: HTTP 502$/)
  })

  it('signale un site injoignable sans révéler le secret', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    await assert.rejects(
      callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: async () => { throw refused } }),
      err => err.message === 'site injoignable (site.example.test) : fetch failed (ECONNREFUSED)' && !err.message.includes(SECRET),
    )
  })

  it('retire le secret d\'un message d\'erreur de fetch qui le recopie', async () => {
    const invalidHeader = new TypeError(`Headers.append: "Bearer ${SECRET}" is an invalid header value.`)
    await assert.rejects(
      callSync({ url: SYNC_URL, secret: SECRET, fetchImpl: async () => { throw invalidHeader } }),
      err => !err.message.includes(SECRET) && err.message.includes('Bearer [CRON_SECRET]'),
    )
  })
})

describe('readReport', () => {
  it('refuse ce qui n\'est pas un compte rendu, et une boîte non configurée côté site', () => {
    assert.throws(() => readReport(null), /réponse inattendue/)
    assert.throws(() => readReport({ ok: true }), /réponse inattendue/)
    assert.throws(() => readReport({ ...REPORT, configured: false }), /non configurée/)
  })

  it('décrit le passage avec des nombres seulement', () => {
    const line = describeReport(readReport({ ...REPORT, failed: 1, errors: ['Offre de Jean Dupont : réponse IA tronquée'] }))
    assert.equal(line, '2 e-mail(s) : 2 traité(s) · 1 offre(s) créée(s) · 1 doublon(s) · 1 en erreur (voir /admin/ao-offers)')
    assert.equal(describeReport(readReport({ ...REPORT, pending: 0, mode: 'reconcile' })), 'aucun nouvel e-mail (rattrapage des 7 derniers jours)')
  })
})
