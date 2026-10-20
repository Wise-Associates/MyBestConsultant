#!/usr/bin/env node
// Veilleur temps réel de la boîte AO : garde une connexion IMAP ouverte en IDLE (lecture seule) et, dès qu'un
// message arrive, appelle /api/cron/ao-inbox. Le traitement (lecture, IA, dédoublonnage, verrou) reste celui
// du site : le veilleur ne fait que sonner.
// Tourne en continu dans un conteneur Docker sur le serveur Hetzner (voir README.md). En local, à côté de
// `npm run dev` : `npm run ao:idle`.
// Journal : événements et nombres uniquement (ni contenu d'e-mail, ni adresse, ni secret).
import { ImapFlow } from 'imapflow'
import { readConfig } from './config.mjs'
import { callSync, describeReport } from './sync-client.mjs'
import { createSyncTrigger } from './trigger.mjs'

/**
 * IDLE relancé toutes les 4 min : du trafic passe avant le contrôle d'inactivité d'imapflow (5 min) et bien
 * avant la déconnexion des sessions inactives par le serveur (30 min au plus tôt, RFC 2177).
 */
const MAX_IDLE_MS = 4 * 60_000
/** Délais avant reconnexion ; le dernier se répète tant que la connexion échoue. */
const RECONNECT_DELAYS_MS = [5_000, 15_000, 60_000, 300_000]
/**
 * Identifiants refusés (mot de passe changé sur IONOS mais pas ici…) : réessayer ne sert qu'après une
 * correction, et des échecs répétés pourraient faire bloquer la boîte, que le site lit aussi.
 */
const AUTH_RETRY_DELAYS_MS = [300_000, 900_000, 3_600_000]
/** Une connexion restée ouverte au moins ce temps remet les délais de reconnexion au début. */
const STABLE_CONNECTION_MS = 60_000

const log = line => console.log(`${new Date().toISOString()} ${line}`)
const logError = line => console.error(`${new Date().toISOString()} ✗ ${line}`)
const reasonOf = err => `${err?.message ?? String(err)}${err?.code ? ` (${err.code})` : ''}`

// --local : ajouté par `npm run ao:idle` (poste de développement).
const result = readConfig(process.env, { localOnly: process.argv.includes('--local') })
if (!result.ok) {
  for (const error of result.errors) logError(error)
  process.exit(1)
}
const { imap, syncUrl, secret, fallbackMs } = result.config

const trigger = createSyncTrigger({
  call: async () => {
    const report = await callSync({ url: syncUrl, secret })
    log(`✓ ${describeReport(report)}`)
    return report
  },
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
  now: Date.now,
  logError,
})

let client = null
let connectedAt = 0
let reconnectTimer = null
let reconnectAttempts = 0
let authFailures = 0
let stopping = false

const delayAt = (delays, attempt) => delays[Math.min(attempt, delays.length - 1)]

function scheduleReconnect({ authFailed = false } = {}) {
  if (stopping || reconnectTimer) return
  const delay = authFailed ? delayAt(AUTH_RETRY_DELAYS_MS, authFailures++) : delayAt(RECONNECT_DELAYS_MS, reconnectAttempts++)
  log(`reconnexion IMAP dans ${delay / 1000} s`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, delay)
}

async function connect() {
  const connection = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: true,
    auth: { user: imap.user, pass: imap.password },
    logger: false,
    maxIdleTime: MAX_IDLE_MS,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
  })
  client = connection
  connectedAt = 0
  // Après une erreur, imapflow ferme la connexion et émet « close » : la reconnexion part de là.
  connection.on('error', err => logError(`IMAP : ${reasonOf(err)}`))
  connection.on('close', () => {
    if (client !== connection) return
    client = null
    if (connectedAt && Date.now() - connectedAt >= STABLE_CONNECTION_MS) reconnectAttempts = 0
    log('connexion IMAP fermée')
    scheduleReconnect()
  })
  connection.on('exists', ({ count, prevCount }) => {
    if (count <= prevCount) return
    log(`nouveau message (${prevCount} → ${count})`)
    trigger.request()
  })

  try {
    await connection.connect()
    // Ouverture en lecture seule (EXAMINE) ; imapflow passe ensuite de lui-même en IDLE.
    await connection.mailboxOpen(imap.mailbox, { readOnly: true })
  } catch (err) {
    if (client === connection) client = null
    connection.close()
    logError(`connexion IMAP impossible : ${reasonOf(err)}`)
    scheduleReconnect({ authFailed: err?.authenticationFailed === true })
    return
  }
  connectedAt = Date.now()
  authFailures = 0
  log(`connecté à ${imap.host}, dossier ${imap.mailbox} : en attente de nouveaux messages`)
  // Rattrape ce qui est arrivé avant le démarrage ou pendant une coupure.
  trigger.request()
}

// Filet de sécurité : une notification IDLE perdue (connexion à moitié coupée…) ne retarde pas un message de
// plus de AO_IDLE_FALLBACK_MINUTES. Le site lit la boîte lui-même : ce contrôle marche même sans IMAP ici.
const fallback = setInterval(() => trigger.request(), fallbackMs)

async function shutdown(signal) {
  if (stopping) return
  stopping = true
  log(`${signal} reçu : arrêt du veilleur`)
  clearInterval(fallback)
  clearTimeout(reconnectTimer)
  trigger.stop()
  // `docker stop` tue le conteneur après 10 s : on quitte au plus tard après 5 s, même si le serveur IMAP ne répond pas.
  setTimeout(() => process.exit(0), 5_000).unref()
  const connection = client
  client = null
  await connection?.logout().catch(err => logError(`déconnexion IMAP : ${reasonOf(err)}`))
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

log(`veilleur AO : ${imap.host} (${imap.mailbox}) → ${syncUrl.origin}${syncUrl.pathname}, contrôle de secours toutes les ${fallbackMs / 60_000} min`)
await connect()
