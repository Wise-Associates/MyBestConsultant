#!/usr/bin/env -S npx tsx
// Fait passer toutes les offres d'une organisation dans une autre (jobs.tenantId), demande du 2026-11-02 :
// 6a6b61fc003030e03c0e → 6a638503001e4c91fa24. Avant d'écrire, sauvegarde la collection jobs dans jobs_backup_JJMMAAAA
// (src/lib/appwrite/collection-backup.ts). Reprise sans risque : une offre déjà déplacée n'est plus relue.
//
//   npm run jobs:move-tenant -- .env.dev --from 6a6b61fc003030e03c0e --to 6a638503001e4c91fa24            → affiche ce qui serait fait, ne modifie rien
//   npm run jobs:move-tenant -- .env.dev --from 6a6b61fc003030e03c0e --to 6a638503001e4c91fa24 --apply    → projet DEV
//   npm run jobs:move-tenant -- .env --prod --from <organisation> --to <organisation> --apply             → production (à lancer par un humain)
//
// Seul jobs.tenantId change. Les données liées gardent l'ancienne organisation (candidatures, présélections, CV du vivier,
// correspondances IA, publications ; entretiens et e-mails suivent les candidatures), mais les pages d'une offre
// (pipeline, matching) vérifient l'organisation de l'offre puis lisent ces données par offre : la nouvelle organisation
// voit les candidats des offres déplacées, l'ancienne ne peut plus les ouvrir (son tableau de bord compte encore leurs
// candidatures). À ne lancer que si les deux organisations sont la même entreprise. Le script compte ces données, les
// pipelines qui listent les offres, les appels d'offres d'origine (boîtes AO de l'ancienne organisation) et les
// recruteurs affectés qui ne sont pas de la nouvelle, sans les modifier.
// Retour arrière : les offres déplacées sont celles de la sauvegarde dont tenantId vaut l'ancienne organisation.
// Le fichier d'environnement fournit APPWRITE_* ; seuls les noms des deux organisations sont affichés (vérification),
// aucune valeur secrète ni donnée d'offre.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { Client, Databases, Query } from 'node-appwrite'
import { backupCollection, backupCollectionId, BackupStop } from '../src/lib/appwrite/collection-backup'
import { listAllDocuments } from '../src/lib/appwrite/list-all'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const APPWRITE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/
/** Identifiants par requête (Query.equal sur une liste). */
const BATCH = 100
const PARALLEL = 10

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

const [file, ...flags] = process.argv.slice(2)
const option = (name: string) => {
  const at = flags.indexOf(name)
  return at >= 0 ? flags[at + 1] ?? '' : ''
}
const from = option('--from')
const to = option('--to')
if (!file || file.startsWith('--') || !APPWRITE_ID.test(from) || !APPWRITE_ID.test(to) || from === to) {
  console.error('Usage : npm run jobs:move-tenant -- <fichier .env> --from <organisation> --to <autre organisation> [--apply] [--prod]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const env = readEnv(file)
for (const name of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID']) {
  if (!env[name]) { console.error(`${name} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}

const db = new Databases(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))
const DB = env.APPWRITE_DB_ID
const JOBS = env.APPWRITE_COLLECTION_JOBS || 'jobs'
const TENANTS = env.APPWRITE_COLLECTION_TENANTS || 'tenants'
const USERS = env.APPWRITE_COLLECTION_USERS || 'users'
const PIPELINES = env.APPWRITE_COLLECTION_FUNNEL_PIPELINES || 'funnel_pipelines'
/** Collections dont les documents portent jobId et tenantId : ils restent dans l'ancienne organisation. */
const LINKED = [
  env.APPWRITE_COLLECTION_APPLICATIONS || 'applications',
  env.APPWRITE_COLLECTION_SCREENINGS || 'screenings',
  env.APPWRITE_COLLECTION_VIVIER_CVS || 'vivier_cvs',
  env.APPWRITE_COLLECTION_JOB_MATCHES || 'job_matches',
  env.APPWRITE_COLLECTION_SOCIAL_POSTS || 'social_posts',
]
const codeOf = (err: unknown) => (err as { code?: number }).code
/** Arrêt prévu (message pour l'opérateur) : le script se termine en erreur, sans pile d'appels. */
class Stop extends Error {}

/** Production : confirmation en tapant l'identifiant du projet, comme npm run ao:index et schema:push. */
async function confirmProduction(): Promise<void> {
  if (env.APPWRITE_PROJECT_ID === DEV_PROJECT_ID) return
  console.log(`Écriture dans ${env.APPWRITE_ENDPOINT}, projet ${env.APPWRITE_PROJECT_ID}, base ${DB}.`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Tapez l\'identifiant du projet pour confirmer : ')
  rl.close()
  if (answer.trim() !== env.APPWRITE_PROJECT_ID) throw new Stop('Confirmation incorrecte : rien n\'a été modifié.')
}

async function tenantName(id: string): Promise<string | null> {
  try {
    return String((await db.getDocument(DB, TENANTS, id)).name ?? '')
  } catch (err) {
    if (codeOf(err) === 404) return null
    throw err
  }
}

/** Documents de `collection` liés aux offres `jobIds` et encore dans l'ancienne organisation. */
async function countLinked(collection: string, jobIds: string[]): Promise<number> {
  let total = 0
  for (let i = 0; i < jobIds.length; i += BATCH) {
    const page = await db.listDocuments(DB, collection, [
      Query.equal('jobId', jobIds.slice(i, i + BATCH)), Query.equal('tenantId', from), Query.select(['$id']), Query.limit(1),
    ])
    total += page.total
  }
  return total
}

/** Offres d'un pipeline. Même lecture que l'application (parseJson, funnel.ts) : une liste illisible n'en contient aucune. */
function parseIds(json: unknown): string[] {
  try {
    const value = JSON.parse(String(json ?? '[]'))
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'DÉPLACEMENT' : 'simulation (ajoutez --apply pour déplacer)'}`)
let exitCode = 0
try {
  // 1. Organisations : la nouvelle doit exister ; l'ancienne peut avoir été supprimée.
  const targetName = await tenantName(to)
  if (targetName === null) throw new Stop(`Organisation ${to} introuvable : rien n'est déplacé.`)
  const sourceName = await tenantName(from)
  console.log(`Offres de ${from} (${sourceName ?? 'organisation introuvable'}) vers ${to} (${targetName})`)

  // 2. Offres à déplacer.
  const jobs = await listAllDocuments(db, DB, JOBS, [Query.equal('tenantId', from), Query.select(['$id', 'recruiterId'])])
  const ids = jobs.map(job => job.$id)
  console.log(`${apply ? '~' : '?'} ${ids.length} offre(s) à déplacer`)

  if (ids.length > 0) {
    // 3. Ce qui reste dans l'ancienne organisation : compté, jamais modifié.
    for (const collection of LINKED) {
      const count = await countLinked(collection, ids)
      if (count) console.log(`! ${collection} : ${count} document(s) de ces offres gardent l'organisation ${from}, visibles par ${to} depuis les pages de l'offre`)
    }
    const moving = new Set(ids)
    const pipelines = (await listAllDocuments(db, DB, PIPELINES, [Query.equal('tenantId', from), Query.select(['$id', 'jobIdsJson'])]))
      .filter(pipeline => parseIds(pipeline.jobIdsJson).some(id => moving.has(id)))
    if (pipelines.length) console.log(`! ${PIPELINES} : ${pipelines.length} pipeline(s) de l'ancienne organisation listent ces offres (pipeline par défaut dans la nouvelle)`)
    const fromAo = ids.filter(id => id.startsWith('ao')).length
    if (fromAo) console.log(`! ${fromAo} offre(s) publiée(s) depuis un appel d'offres : l'AO reste dans les boîtes de l'ancienne organisation`)
    // Profil (ADR 0023) ou compte Auth (valeur d'avant, convertie par jobs:fill-recruiter).
    const recruiters = new Set((await listAllDocuments(db, DB, USERS, [
      Query.equal('tenantId', to), Query.equal('role', 'recruiter'), Query.select(['$id', 'userId']),
    ])).flatMap(user => [user.$id, String(user.userId)]))
    const outside = jobs.filter(job => job.recruiterId && !recruiters.has(String(job.recruiterId))).length
    if (outside) console.log(`! ${outside} offre(s) affectée(s) à un recruteur qui n'est pas de ${to} (« Recruteur hors de l'équipe » dans « Mes offres »)`)
  }

  // 4. Sauvegarde, puis déplacement offre par offre.
  if (apply && ids.length > 0) await confirmProduction()
  const backupId = backupCollectionId(JOBS, new Date())
  const backup = await backupCollection(db, DB, JOBS, backupId, apply && ids.length > 0)
  if (!apply || ids.length === 0) {
    console.log(`? sauvegarde ${backupId} (${backup.existed ? 'existe déjà' : 'à créer'}) : ${backup.copied} offre(s) à copier, ${backup.kept} déjà sauvegardée(s)`)
  } else {
    console.log(`+ sauvegarde ${backupId} ${backup.existed ? 'complétée' : 'créée'} : ${backup.copied} offre(s) copiée(s), ${backup.kept} déjà sauvegardée(s)`)
    const unsaved = ids.filter(id => !backup.savedIds.has(id))
    if (unsaved.length) throw new Stop(`${unsaved.length} offre(s) absente(s) de la sauvegarde ${backupId} : rien n'est déplacé.`)

    let moved = 0
    for (let i = 0; i < ids.length; i += PARALLEL) {
      await Promise.all(ids.slice(i, i + PARALLEL).map(async id => {
        try {
          await db.updateDocument(DB, JOBS, id, { tenantId: to })
          moved++
        } catch (err) {
          if (codeOf(err) !== 404) throw err // supprimée entre-temps
        }
      }))
    }
    console.log(`~ ${moved} offre(s) déplacée(s) vers ${to}`)
    const remaining = (await db.listDocuments(DB, JOBS, [Query.equal('tenantId', from), Query.select(['$id']), Query.limit(1)])).total
    if (remaining) {
      console.error(`! ${remaining} offre(s) encore dans ${from} (créées pendant le passage) : relancez le script.`)
      exitCode = 1
    }
  }
  console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
} catch (err) {
  if (!(err instanceof Stop || err instanceof BackupStop)) throw err
  console.error(err.message)
  exitCode = 1
}
if (exitCode) process.exit(exitCode)
