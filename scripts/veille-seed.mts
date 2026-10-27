#!/usr/bin/env -S npx tsx
// Premiers réglages de la veille marchés et emplois (ADR 0012) : charge dans veille_config les réglages du scanner
// (fichier config/defaults.json du projet veille-marches-emplois) comme version 1. Une seule fois : si une version
// existe déjà, rien n'est écrit (les réglages se modifient ensuite dans /admin/veille).
//
//   npm run veille:seed -- .env.dev --file ../veille-marches-emplois/config/defaults.json            → simulation
//   npm run veille:seed -- .env.dev --file ../veille-marches-emplois/config/defaults.json --apply    → projet DEV
//   … .env --prod --apply                                                                            → production (un humain)
//
// Prérequis : la collection veille_config (npm run schema:push -- dev|prod). Le fichier d'environnement fournit
// APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DB_ID ; aucune valeur secrète n'est affichée.
import { readFileSync } from 'node:fs'
import { Client, Databases, ID, Query } from 'node-appwrite'
import { MAX_CONFIG_LENGTH, parseVeilleConfig, VEILLE_SCHEMA_VERSION } from '../src/lib/veille/config'

const DEV_PROJECT_ID = 'bestconsultant-dev'

/** Lecture d'un fichier .env : fins de ligne Windows, guillemets simples ou doubles, commentaire en fin de valeur. */
function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.replace(/\r$/, '')
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    const quoted = value.match(/^(['"])(.*)\1$/)
    if (quoted) value = quoted[2]
    else value = value.replace(/\s+#.*$/, '')
    env[m[1]] = value
  }
  return env
}

const args = process.argv.slice(2)
const envFile = args[0]
const fileIndex = args.indexOf('--file')
const configFile = fileIndex >= 0 ? args[fileIndex + 1] : undefined
if (!envFile || envFile.startsWith('--') || !configFile) {
  console.error('Usage : npm run veille:seed -- <fichier .env> --file <defaults.json du scanner> [--apply] [--prod]')
  process.exit(1)
}
const apply = args.includes('--apply')
const env = readEnv(envFile)
for (const name of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID']) {
  if (!env[name]) { console.error(`${name} manquant dans ${envFile}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !args.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}

const parsed = parseVeilleConfig(JSON.parse(readFileSync(configFile, 'utf-8')))
if (!parsed.success) {
  console.error(`Réglages refusés (${configFile}) :\n- ${parsed.errors.join('\n- ')}`)
  process.exit(1)
}
const config = parsed.config
const json = JSON.stringify(config)
if (json.length > MAX_CONFIG_LENGTH) {
  console.error(`Réglages trop volumineux (${json.length} caractères, ${MAX_CONFIG_LENGTH} au plus) : rien n'est écrit.`)
  process.exit(1)
}
const codeOf = (err: unknown) => (err as { code?: number }).code

const db = new Databases(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))
const DB = env.APPWRITE_DB_ID
const COLLECTION = env.APPWRITE_COLLECTION_VEILLE_CONFIG || 'veille_config'

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB}, collection ${COLLECTION} — ${apply ? 'ÉCRITURE' : 'simulation (ajoutez --apply pour écrire)'}`)
console.log(`Réglages lus : ${config.organisations.length} organismes, ${config.sources.length} sources, ${config.itScope.phrases.length} expressions informatiques (${json.length} caractères).`)

const existing = await db.listDocuments(DB, COLLECTION, [Query.orderDesc('version'), Query.limit(1)]).catch((err: unknown) => {
  if (codeOf(err) === 404) {
    console.error(`Collection ${COLLECTION} introuvable : créez-la d'abord (npm run schema:push -- dev|prod, dans un terminal).`)
    process.exit(1)
  }
  throw err
})
if (existing.documents[0]) {
  console.log(`Déjà configuré (version ${existing.documents[0].version}) : rien n'est écrit. Les réglages se modifient dans /admin/veille.`)
  process.exit(0)
}
if (!apply) {
  console.log('+ version 1 serait créée.')
  process.exit(0)
}
try {
  await db.createDocument(DB, COLLECTION, ID.custom('v1'), {
    version: 1,
    schemaVersion: VEILLE_SCHEMA_VERSION,
    config: json,
    savedById: 'seed',
    savedByName: 'Import initial (veille:seed)',
  })
} catch (err) {
  // Version 1 créée entre-temps (autre lancement, ou enregistrement depuis la page) : rien n'est écrasé.
  if (codeOf(err) === 409) {
    console.log('Version 1 déjà créée entre-temps : rien n\'est écrit. Les réglages se modifient dans /admin/veille.')
    process.exit(0)
  }
  throw err
}
console.log('+ version 1 créée.')
