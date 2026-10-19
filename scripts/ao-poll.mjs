#!/usr/bin/env node
// Remplace Vercel Cron en local : appelle /api/cron/ao-inbox toutes les 5 minutes (lecture de la boîte AO).
//
//   npm run dev                       ← dans un premier terminal
//   npm run ao:poll                   ← dans un second : un passage tout de suite, puis toutes les 5 minutes
//   npm run ao:poll -- --once         ← un seul passage
//   npm run ao:poll -- --every 10 --url http://localhost:3001
//
// Les variables sont lues avec le chargeur de Next.js (@next/env, fourni avec `next`), dans le même ordre que
// `npm run dev` : .env.development.local, .env.local, .env.development, .env. Le CRON_SECRET utilisé est donc
// celui du serveur local. Aucun secret n'est affiché. Ctrl+C pour arrêter.
import nextEnv from '@next/env'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const once = args.includes('--once')
const everyMinutes = Number(option('--every', '5'))
const baseUrl = option('--url', 'http://localhost:3000').replace(/\/$/, '')
/** S'il reste des e-mails après un passage (limite atteinte), on relance plus tôt pour vider la file. */
const BACKLOG_DELAY_MS = 30_000

if (!Number.isFinite(everyMinutes) || everyMinutes < 1) {
  console.error('--every attend un nombre de minutes (1 minimum).')
  process.exit(1)
}

const { loadedEnvFiles } = nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error })
const secret = process.env.CRON_SECRET ?? ''
const time = () => new Date().toLocaleTimeString('fr-FR')
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

console.log(`Fichiers d'environnement : ${loadedEnvFiles.map(f => f.path).join(', ') || 'aucun'}`)
console.log(`Projet Appwrite du serveur local : ${process.env.APPWRITE_PROJECT_ID || '(non défini)'} — vérifiez que ce n'est pas la production.`)
if (secret.length < 16) {
  console.error('CRON_SECRET absent ou trop court (16 caractères minimum) : ajoutez-le dans .env.development.local, puis relancez `npm run dev`.')
  process.exit(1)
}

/** Un passage. Renvoie le délai avant le suivant (null : arrêt). */
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
      console.error('           ↳ Le serveur local n\'atteint pas Appwrite (réseau sans IPv6). Relancez-le avec :')
      console.error('             NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000 npm run dev')
    }
    return null
  }
  if (!body.configured) {
    console.error(`${time()} ✗ Boîte AO non configurée côté serveur : AO_IMAP_USER et AO_IMAP_PASSWORD.`)
    return null
  }

  const parts = [
    `${body.processed} e-mail${body.processed > 1 ? 's' : ''} traité${body.processed > 1 ? 's' : ''}`,
    plural(body.offersCreated, 'nouvelle offre'),
    body.duplicates ? plural(body.duplicates, 'doublon') : '',
    body.noOffer ? `${body.noOffer} sans offre` : '',
    body.failed ? `${body.failed} en erreur` : '',
    body.remaining ? `${body.remaining} en attente` : '',
  ].filter(Boolean)
  console.log(`${time()} ✓ ${body.pending ? parts.join(' · ') : 'aucun nouvel e-mail'}`)
  for (const error of body.errors ?? []) console.log(`           ↳ ${error}`)
  return body.remaining ? BACKLOG_DELAY_MS : everyMinutes * 60_000
}

console.log(`Lecture de la boîte AO via ${baseUrl}/api/cron/ao-inbox${once ? '' : ` toutes les ${everyMinutes} min (Ctrl+C pour arrêter)`}\n`)
for (;;) {
  const delay = await poll()
  if (once) process.exit(delay === null ? 1 : 0)
  // Une erreur (serveur arrêté, secret différent…) n'arrête pas la boucle : on réessaie au prochain créneau.
  await new Promise(resolve => setTimeout(resolve, delay ?? everyMinutes * 60_000))
}
