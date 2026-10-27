#!/usr/bin/env -S npx tsx
// Structure Appwrite (collections, attributs, index) décrite par appwrite.config.json, instantané du projet DEV,
// appliquée aux projets par la CLI Appwrite épinglée (docs/adr/0011-structure-appwrite-appwrite-config.md).
//
//   npm run schema:pull                → remplace appwrite.config.json par la structure du projet DEV
//   npm run schema:check -- dev|prod   → compare le fichier au projet, sans rien modifier (code 1 s'il diffère)
//   npm run schema:push -- dev         → ajoute au projet DEV les collections, attributs et index du fichier
//   npm run schema:push -- prod        → production : à lancer par un humain, après sauvegarde de la base
//
// Prérequis : une session de la CLI (`npm run appwrite -- login --endpoint https://appwrite.mybestconsultant.fr/v1`),
// à fermer ensuite (`npm run appwrite -- logout`) : elle ouvre tous les projets du serveur.
// schema:push n'applique que des ajouts et ne supprime rien (ce que seul le projet a est gardé) ; il refuse le reste
// (recréations, qui perdent des données, modifications que la CLI 8.3.0 n'applique pas en réalité) : schema-diff.ts.
// La CLI ne lit le projet que dans appwrite.config.json : chaque commande travaille dans un dossier temporaire dont le
// fichier vise le projet et la base de l'environnement. Jamais --force : la CLI demande confirmation.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  configFor, describeChange, diffSchema, isAddition, isBlocking, pushCopy, SchemaFileError,
  type AppwriteEnvironment, type SchemaChange, type SchemaCollection, type SchemaConfig, type SchemaDatabase,
} from '../src/lib/appwrite/schema-diff'

const ENVIRONMENTS = {
  dev: { projectId: 'bestconsultant-dev', databaseId: 'bestconsultant-dev' },
  // La base de production n'a pas l'identifiant de celle de DEV (les collections, si).
  prod: { projectId: 'bestconsultant', databaseId: 'bestconsult' },
} satisfies Record<string, AppwriteEnvironment>
type EnvironmentName = keyof typeof ENVIRONMENTS

const USAGE = 'Usage : npm run schema:pull | npm run schema:check -- dev|prod | npm run schema:push -- dev|prod'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONFIG_FILE = 'appwrite.config.json'
const CLI = createRequire(import.meta.url).resolve('appwrite-cli/index.js')
// Serveur à plus de 250 ms : sans ce délai, Node abandonne la connexion (« fetch failed », voir scripts/dev-local.mjs).
const NETWORK_FLAG = '--network-family-autoselection-attempt-timeout=2000'
// Attente des attributs et index créés, par pas de 2 s : 1 min par défaut, trop court pour une grande table en production.
const PUSH_ATTEMPTS = '150'

/** Arrêt attendu (session fermée, base introuvable…) : le message suffit, sans pile d'appels. */
class Stop extends Error {}

// Bornes des attributs entiers (±9223372036854775807) lues et réécrites au chiffre près, comme le fait la CLI
// (json-bigint) : arrondies par JSON.parse, elles ne correspondraient plus au projet.
// JSON.rawJSON (Node.js 22) est absent des types TypeScript.
const { rawJSON } = JSON as unknown as { rawJSON: (text: string) => unknown }
if (typeof rawJSON !== 'function') throw new Stop('Node.js 22 ou plus est requis (JSON.rawJSON)')

function readConfig(path: string): SchemaConfig {
  return JSON.parse(readFileSync(path, 'utf8'), (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value) && context?.source ? rawJSON(context.source) : value)
}

/** Lance la CLI épinglée dans `cwd`, où elle trouve son appwrite.config.json. */
function runCli(args: string[], cwd: string, quiet = false): void {
  const result = spawnSync(process.execPath, [NETWORK_FLAG, CLI, ...args], { cwd, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' })
  if (result.status === 0) return
  if (quiet) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  const hint = result.error ? result.error.message
    : result.signal ? `interrompue (${result.signal})`
      : 'session ouverte ? npm run appwrite -- login --endpoint https://appwrite.mybestconsultant.fr/v1'
  throw new Stop(`appwrite ${args.join(' ')} a échoué : ${hint}`)
}

/**
 * Structure du projet, lue par la CLI dans `dir` (lecture seule sur le projet). Le fichier part vide : la CLI ajoute
 * les collections lues à celles du fichier sans retirer les autres.
 */
function readProject(environment: AppwriteEnvironment, dir: string): { database: SchemaDatabase; collections: SchemaCollection[] } {
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ projectId: environment.projectId }))
  runCli(['pull', 'collection', '--id', environment.databaseId], dir, true)
  const project = readConfig(join(dir, CONFIG_FILE))
  const database = project.databases?.find(candidate => candidate.$id === environment.databaseId)
  if (!database) throw new Stop(`Base ${environment.databaseId} introuvable sur le projet ${environment.projectId}`)
  return { database, collections: (project.collections ?? []).filter(collection => collection.databaseId === environment.databaseId) }
}

function compare(environment: AppwriteEnvironment, dir: string): { copy: SchemaConfig; changes: SchemaChange[] } {
  const project = readProject(environment, dir)
  const config = configFor(readConfig(join(ROOT, CONFIG_FILE)), ENVIRONMENTS.dev, environment, project.database)
  return { copy: pushCopy(config, project.collections), changes: diffSchema(config.collections ?? [], project.collections) }
}

function report(environment: AppwriteEnvironment, changes: SchemaChange[]): void {
  if (changes.length === 0) {
    console.log(`Projet ${environment.projectId}, base ${environment.databaseId} : identique à ${CONFIG_FILE}.`)
    return
  }
  console.log(`Projet ${environment.projectId}, base ${environment.databaseId} : ${changes.length} différence(s) avec ${CONFIG_FILE}`)
  for (const change of changes) console.log(`  ${describeChange(change)}`)
}

async function confirmed(question: string, expected: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await prompt.question(question)).trim() === expected
  } finally {
    prompt.close()
  }
}

function pull(dir: string): void {
  const { collections } = readProject(ENVIRONMENTS.dev, dir)
  // Copié tel quel : le fichier écrit par la CLI garde les bornes 64 bits au chiffre près.
  copyFileSync(join(dir, CONFIG_FILE), join(ROOT, CONFIG_FILE))
  console.log(`${CONFIG_FILE} : ${collections.length} collections du projet ${ENVIRONMENTS.dev.projectId}. Relisez : git diff ${CONFIG_FILE}`)
}

function check(name: EnvironmentName, dir: string): void {
  const { changes } = compare(ENVIRONMENTS[name], dir)
  report(ENVIRONMENTS[name], changes)
  if (changes.length > 0) process.exitCode = 1
}

async function push(name: EnvironmentName, dir: string): Promise<void> {
  const environment = ENVIRONMENTS[name]
  if (name === 'prod') {
    console.log('Production : sauvegardez la base d\'abord (dump MariaDB). Ces ajouts passent avant la mise en production du code qui les utilise.\n')
  }
  const { changes } = compare(environment, dir)
  report(environment, changes)
  if (changes.some(isBlocking)) {
    console.error('\nRien n\'a été poussé : les lignes ✗ passent par un script de migration ou la console Appwrite.')
    process.exitCode = 1
    return
  }
  if (!changes.some(isAddition)) return

  if (!process.stdin.isTTY) throw new Stop('schema:push demande des confirmations : lancez-le dans un terminal')
  if (!(await confirmed(`\nTapez ${environment.projectId} pour appliquer ces ajouts : `, environment.projectId))) {
    console.log('Rien n\'a été poussé.')
    return
  }
  // Le projet ou le fichier ont pu changer pendant la confirmation : on pousse ce qui vient d'être relu, s'il est
  // identique à ce qui a été montré.
  const current = compare(environment, dir)
  if (JSON.stringify(current.changes) !== JSON.stringify(changes)) {
    throw new Stop('Le projet ou le fichier ont changé depuis la comparaison : rien n\'a été poussé, relancez npm run schema:push.')
  }
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(current.copy, null, 4))

  // La CLI traite les collections une à une et s'arrête à la première erreur : l'état du projet est relu dans tous les cas.
  let failed = false
  try {
    runCli(['push', 'collection', '--all', '--attempts', PUSH_ATTEMPTS], dir)
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    console.error(error.message)
    failed = true
  }
  console.log(failed ? '\nÉtat du projet après l\'échec :' : '\nVérification :')
  const after = compare(environment, dir)
  report(environment, after.changes)
  if (failed || after.changes.some(isAddition)) {
    process.exitCode = 1
  } else if (name === 'dev') {
    // La CLI complète les réglages par défaut (array, encrypt…) d'un attribut écrit à la main dans le fichier ; sans
    // eux, la comparaison suivante y verrait une recréation. Tous les ajouts étant sur DEV, le fichier en est repris.
    pull(dir)
  } else if (after.changes.some(isBlocking)) {
    process.exitCode = 1
  }
}

const [command, name] = process.argv.slice(2)
const environment = name === 'dev' || name === 'prod' ? name : undefined
if (command !== 'pull' && !((command === 'check' || command === 'push') && environment)) {
  console.error(USAGE)
  process.exitCode = 1
} else {
  const dir = mkdtempSync(join(tmpdir(), 'mbc-appwrite-'))
  try {
    if (command === 'pull') pull(dir)
    else if (command === 'check' && environment) check(environment, dir)
    else if (command === 'push' && environment) await push(environment, dir)
  } catch (error) {
    if (!(error instanceof Stop || error instanceof SchemaFileError)) throw error
    console.error(error.message)
    process.exitCode = 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
