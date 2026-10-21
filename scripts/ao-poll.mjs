#!/usr/bin/env node
// Remplace Vercel Cron en local : appelle /api/cron/ao-inbox toutes les 5 minutes (lecture de la boîte AO).
//
//   npm run dev                       ← dans un premier terminal
//   npm run ao:poll                   ← au premier plan : un passage tout de suite, puis toutes les N minutes (Ctrl+C)
//   npm run ao:poll -- --once         ← un seul passage
//   npm run ao:poll -- --every 10 --url http://localhost:3001
//   npm run ao:poll:start             ← même chose en arrière-plan (accepte aussi --every et --url)
//   npm run ao:poll:status            ← lancé ou non, et dernières lignes du journal
//   npm run ao:poll:stop              ← arrête la lecture en arrière-plan
//
// Les variables sont lues avec le chargeur de Next.js (@next/env, fourni avec `next`), dans le même ordre que
// `npm run dev` : .env.development.local, .env.local, .env.development, .env. Le CRON_SECRET utilisé est donc
// celui du serveur local. Aucun secret n'est affiché.
//
// Intervalle : --every N, sinon AO_POLL_INTERVAL_MINUTES (dans un fichier .env), sinon 5 minutes.
import nextEnv from '@next/env'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMANDS = ['start', 'stop', 'status']
const command = COMMANDS.includes(process.argv[2]) ? process.argv[2] : 'run'
const args = process.argv.slice(command === 'run' ? 2 : 3)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const once = args.includes('--once')
const baseUrl = option('--url', 'http://localhost:3000').replace(/\/$/, '')
const background = process.env.AO_POLL_BACKGROUND === '1'
/** S'il reste des e-mails après un passage (limite atteinte), on relance plus tôt pour vider la file. */
const BACKLOG_DELAY_MS = 30_000

// Lecture en arrière-plan : PID et journal dans le dossier temporaire du système (un par copie du projet).
const instance = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 8)
const PID_FILE = join(tmpdir(), `ao-poll-${instance}.pid`)
const LOG_FILE = join(tmpdir(), `ao-poll-${instance}.log`)

/** PID de la lecture en arrière-plan si elle tourne encore (sinon nettoie un fichier PID périmé). */
function runningPid() {
  if (!existsSync(PID_FILE)) return null
  const pid = Number(readFileSync(PID_FILE, 'utf-8'))
  let alive = Number.isInteger(pid) && pid > 0
  try { if (alive) process.kill(pid, 0) } catch { alive = false }
  // Un PID peut être réattribué à un autre programme : sous Linux, on vérifie que c'est bien ce script.
  try { if (alive && !readFileSync(`/proc/${pid}/cmdline`, 'utf-8').includes('ao-poll')) alive = false } catch { /* pas de /proc (macOS, Windows) */ }
  if (!alive) rmSync(PID_FILE, { force: true })
  return alive ? pid : null
}

const logTail = (lines = 10) => (existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf-8').trimEnd().split('\n').slice(-lines).join('\n') : '(journal vide)')

if (command === 'stop') {
  const pid = runningPid()
  if (!pid) {
    console.log('Aucune lecture AO en arrière-plan.')
  } else {
    process.kill(pid, 'SIGTERM')
    rmSync(PID_FILE, { force: true })
    console.log(`Lecture AO arrêtée (PID ${pid}). Journal : ${LOG_FILE}`)
  }
  process.exit(0)
}

if (command === 'status') {
  const pid = runningPid()
  console.log(pid ? `Lecture AO en arrière-plan : lancée (PID ${pid}).` : 'Lecture AO en arrière-plan : arrêtée.')
  if (existsSync(LOG_FILE)) console.log(`Journal : ${LOG_FILE}\n\n${logTail()}`)
  process.exit(0)
}

const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })
const DEFAULT_INTERVAL_MINUTES = 5
const everyMinutes = Number(option('--every', process.env.AO_POLL_INTERVAL_MINUTES || String(DEFAULT_INTERVAL_MINUTES)))
if (!Number.isFinite(everyMinutes) || everyMinutes < 1) {
  console.error('Intervalle invalide (--every ou AO_POLL_INTERVAL_MINUTES) : un nombre de minutes, 1 minimum.')
  process.exit(1)
}
const secret = process.env.CRON_SECRET ?? ''
const time = () => new Date().toLocaleString('fr-FR')
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

console.log(`Fichiers d'environnement : ${loadedEnvFiles.map(f => f.path).join(', ') || 'aucun'}`)
console.log(`Projet Appwrite du serveur local : ${process.env.APPWRITE_PROJECT_ID || '(non défini)'} — vérifiez que ce n'est pas la production.`)
if (secret.length < 16) {
  console.error('CRON_SECRET absent ou trop court (16 caractères minimum) : ajoutez-le dans .env.development.local, puis relancez `npm run dev`.')
  process.exit(1)
}

const existing = background ? null : runningPid()
if (existing) {
  console.error(`Une lecture AO tourne déjà en arrière-plan (PID ${existing}) : npm run ao:poll:stop pour l'arrêter.`)
  process.exit(1)
}

if (command === 'start') {
  const log = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter(a => a !== '--once')], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, AO_POLL_BACKGROUND: '1' },
  })
  child.unref()
  writeFileSync(PID_FILE, String(child.pid))
  // Laisse le temps au premier contrôle : une erreur immédiate (serveur arrêté…) est montrée tout de suite.
  await new Promise(resolve => setTimeout(resolve, 1500))
  if (!runningPid()) {
    console.error(`La lecture s'est arrêtée aussitôt. Journal (${LOG_FILE}) :\n\n${logTail()}`)
    process.exit(1)
  }
  console.log(`Lecture AO lancée en arrière-plan (PID ${child.pid}), toutes les ${everyMinutes} min.`)
  console.log(`Journal : ${LOG_FILE} — état : npm run ao:poll:status — arrêt : npm run ao:poll:stop`)
  process.exit(0)
}

/** Un passage. Renvoie le délai avant le suivant (null : erreur, on réessaie au créneau suivant). */
async function poll() {
  let res
  try {
    res = await fetch(`${baseUrl}/api/cron/ao-inbox`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(310_000),
    })
  } catch (err) {
    const reason = err?.cause?.code === 'ECONNREFUSED' ? `serveur injoignable sur ${baseUrl} (lancez \`npm run dev\`)` : (err?.message ?? String(err))
    console.error(`${time()} ✗ ${reason}`)
    return null
  }

  if (res.status === 401) {
    console.error(`${time()} ✗ 401 : le serveur n'a pas le même CRON_SECRET (relancez \`npm run dev\` après avoir modifié les fichiers .env).`)
    return null
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`${time()} ✗ ${res.status} ${body.error ?? ''}${body.detail ? ` : ${body.detail}` : ' — détails dans le terminal de `npm run dev`.'}`)
    if (/ETIMEDOUT|ENETUNREACH/.test(body.detail ?? '')) {
      console.error('           ↳ Le serveur local n\'atteint pas Appwrite (réseau sans IPv6 ou serveur lointain).')
      console.error('             Arrêtez `npm run dev` et relancez-le avec : npm run dev:local')
    }
    return null
  }
  if (!body.configured) {
    console.error(`${time()} ✗ Aucune boîte AO active côté serveur : npm run ao:migrate-sources (docs/adr/0005).`)
    return null
  }
  if (body.skipped) {
    console.log(`${time()} ⏭ une synchronisation est déjà en cours (bouton admin ou autre appel) : passage ignoré`)
    return everyMinutes * 60_000
  }

  const parts = [
    `${body.processed} e-mail${body.processed > 1 ? 's' : ''} traité${body.processed > 1 ? 's' : ''}`,
    `${body.offersCreated} nouvelle${body.offersCreated > 1 ? 's' : ''} offre${body.offersCreated > 1 ? 's' : ''}`,
    body.duplicates ? plural(body.duplicates, 'doublon') : '',
    body.noOffer ? `${body.noOffer} sans offre` : '',
    body.failed ? `${body.failed} en erreur` : '',
    body.remaining ? `${body.remaining} en attente` : '',
  ].filter(Boolean)
  const mode = body.mode === 'reconcile' ? ' (rattrapage des 7 derniers jours)' : ''
  // Une boîte illisible (mot de passe, serveur) laisse « aucun nouvel e-mail » : la signaler comme un échec.
  const mark = body.failedMailboxes ? '✗' : '✓'
  const failures = body.failedMailboxes ? ` — ${plural(body.failedMailboxes, 'boîte')} illisible${body.failedMailboxes > 1 ? 's' : ''}` : ''
  const unread = body.unentitled ? ` — ${plural(body.unentitled, 'organisation')} sans abonnement actif` : ''
  console.log(`${time()} ${mark} ${body.pending ? parts.join(' · ') : 'aucun nouvel e-mail'}${mode}${failures}${unread}`)
  for (const error of body.errors ?? []) console.log(`           ↳ ${error}`)
  // IA indisponible (crédits épuisés, clé refusée) : relancer plus tôt ne changerait rien.
  if (body.aiUnavailable) console.log('           ↳ IA indisponible : les e-mails attendent (crédits à recharger ou clé à ajouter dans Config IA).')
  return body.remaining && !body.aiUnavailable ? BACKLOG_DELAY_MS : everyMinutes * 60_000
}

const stopHint = background ? 'npm run ao:poll:stop pour arrêter' : 'Ctrl+C pour arrêter'
console.log(`Lecture de la boîte AO via ${baseUrl}/api/cron/ao-inbox${once ? '' : ` toutes les ${everyMinutes} min (${stopHint})`}\n`)
for (;;) {
  const delay = await poll()
  if (once) process.exit(delay === null ? 1 : 0)
  // Une erreur (serveur arrêté, secret différent…) n'arrête pas la boucle : on réessaie au prochain créneau.
  await new Promise(resolve => setTimeout(resolve, delay ?? everyMinutes * 60_000))
}
