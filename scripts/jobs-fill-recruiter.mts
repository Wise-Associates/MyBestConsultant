#!/usr/bin/env -S npx tsx
// Recruteur affecté des offres et des appels d'offres au format de l'ADR 0023 (profil, users.$id), demande du
// 2026-11-02 (src/lib/job-ownership.ts) :
// - offre sans recruteur → son auteur (jobs.postedBy, toujours un profil), s'il est recruteur de l'organisation de
//   l'offre ; une offre créée a ainsi recruiterId === postedBy ;
// - jobs.recruiterId et ao_offer_details.assigneeId écrits avant l'ADR (compte Auth, users.userId) → profil de la même
//   personne, sans changer de recruteur.
// Avant d'écrire, sauvegarde jobs (et ao_offer_details s'il y a des AO à convertir) dans <collection>_backup_JJMMAAAA
// (src/lib/appwrite/collection-backup.ts). Reprise sans risque : une valeur déjà au bon format n'est plus changée.
//
//   npm run jobs:fill-recruiter -- .env.dev                    → affiche ce qui serait fait, ne modifie rien
//   npm run jobs:fill-recruiter -- .env.dev --apply            → projet DEV
//   npm run jobs:fill-recruiter -- .env --prod --apply         → production (à lancer par un humain, juste après le
//                                                                 déploiement du code de l'ADR 0023)
//
// Laissées telles quelles et comptées : recruteur affecté inconnu (compte supprimé), auteur introuvable, auteur qui n'est
// pas recruteur de l'organisation de l'offre. À lancer après jobs:move-tenant : une offre déplacée est jugée dans sa
// nouvelle organisation. Chaque document est relu juste avant d'être écrit : changé entre-temps, il est gardé.
// Le fichier d'environnement fournit APPWRITE_* ; seuls des identifiants de documents sont affichés.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { Client, Databases, Query, type Models } from 'node-appwrite'
import { backupCollection, backupCollectionId, BackupStop } from '../src/lib/appwrite/collection-backup'
import { listAllDocuments } from '../src/lib/appwrite/list-all'
import { planJobRecruiter, type JobRecruiterPlan, type UserRef } from '../src/lib/job-ownership'

const DEV_PROJECT_ID = 'bestconsultant-dev'
/** Identifiants par requête (Query.equal sur une liste). */
const BATCH = 100
const PARALLEL = 10
/** Identifiants affichés par cas à vérifier. */
const SHOWN = 20

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
if (!file || file.startsWith('--')) {
  console.error('Usage : npm run jobs:fill-recruiter -- <fichier .env> [--apply] [--prod]')
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
const USERS = env.APPWRITE_COLLECTION_USERS || 'users'
const DETAILS = env.APPWRITE_COLLECTION_AO_OFFER_DETAILS || 'ao_offer_details'
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

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const toUser = (doc: Models.Document): UserRef =>
  ({ $id: doc.$id, userId: text(doc.userId), tenantId: text(doc.tenantId), role: text(doc.role) })

/** Profils désignés par `values` : par document (users.$id), sinon par compte Auth (users.userId, valeur ancienne). */
async function usersOf(values: string[]): Promise<Map<string, UserRef>> {
  const found = new Map<string, UserRef>()
  const select = Query.select(['$id', 'userId', 'tenantId', 'role'])
  for (const field of ['$id', 'userId'] as const) {
    const pending = values.filter(value => !found.has(value))
    for (let i = 0; i < pending.length; i += BATCH) {
      const page = await db.listDocuments(DB, USERS, [Query.equal(field, pending.slice(i, i + BATCH)), select, Query.limit(BATCH)])
      for (const doc of page.documents) found.set(field === '$id' ? doc.$id : text(doc.userId), toUser(doc))
    }
  }
  return found
}

/** ao_offer_details.assigneeId n'existe qu'après `npm run schema:push` (affectation des AO). */
async function hasAssigneeAttribute(): Promise<boolean> {
  const { attributes } = await db.listAttributes(DB, DETAILS, [Query.limit(100)])
  return attributes.some(attribute => attribute.key === 'assigneeId')
}

/** Sauvegarde de `collection`, puis vérifie que les documents à modifier y sont. */
async function backup(collection: string, ids: string[]): Promise<void> {
  const backupId = backupCollectionId(collection, new Date())
  const report = await backupCollection(db, DB, collection, backupId, true)
  console.log(`+ sauvegarde ${backupId} ${report.existed ? 'complétée' : 'créée'} : ${report.copied} document(s) copié(s), ${report.kept} déjà sauvegardé(s)`)
  const unsaved = ids.filter(id => !report.savedIds.has(id))
  if (unsaved.length) throw new Stop(`${unsaved.length} document(s) absent(s) de la sauvegarde ${backupId} : rien n'est modifié.`)
}

/**
 * Relit chaque document et l'écrit si `next` (calculé sur la version relue) donne encore une valeur ; renvoie les
 * identifiants écrits. Supprimé ou déjà changé entre-temps : gardé.
 */
async function rewrite(collection: string, ids: string[], field: string, next: (doc: Models.Document) => string | undefined): Promise<string[]> {
  const written: string[] = []
  for (let i = 0; i < ids.length; i += PARALLEL) {
    await Promise.all(ids.slice(i, i + PARALLEL).map(async id => {
      try {
        const value = next(await db.getDocument(DB, collection, id))
        if (value === undefined) return
        await db.updateDocument(DB, collection, id, { [field]: value })
        written.push(id)
      } catch (err) {
        if (codeOf(err) !== 404) throw err
      }
    }))
  }
  return written
}

const sample = (list: string[]) => `${list.slice(0, SHOWN).join(', ')}${list.length > SHOWN ? ', …' : ''}`

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'MISE À JOUR' : 'simulation (ajoutez --apply pour écrire)'}`)
let exitCode = 0
try {
  // 1. Offres, AO affectés et utilisateurs qu'ils désignent.
  const jobs = await listAllDocuments(db, DB, JOBS, [Query.select(['$id', 'tenantId', 'postedBy', 'recruiterId'])])
  const withAssignee = await hasAssigneeAttribute()
  const details = withAssignee
    ? await listAllDocuments(db, DB, DETAILS, [Query.isNotNull('assigneeId'), Query.select(['$id', 'assigneeId'])])
    : []
  const users = await usersOf([...new Set([
    ...jobs.flatMap(job => [text(job.postedBy), text(job.recruiterId)]),
    ...details.map(detail => text(detail.assigneeId)),
  ].filter(Boolean))])
  const find = (id: string) => users.get(id)
  const planOf = (doc: Models.Document) =>
    planJobRecruiter({ tenantId: text(doc.tenantId), postedBy: text(doc.postedBy), recruiterId: text(doc.recruiterId) }, find)
  /** Profil à écrire sur un AO dont le recruteur est encore un compte Auth. */
  const aoProfileOf = (doc: Models.Document) => {
    const assignee = find(text(doc.assigneeId))
    return assignee && assignee.$id !== text(doc.assigneeId) ? assignee.$id : undefined
  }

  // 2. Décisions.
  const byNote = new Map<JobRecruiterPlan['note'], string[]>()
  for (const job of jobs) {
    const { note } = planOf(job)
    byNote.set(note, [...(byNote.get(note) ?? []), job.$id])
  }
  const ids = (note: JobRecruiterPlan['note']) => byNote.get(note) ?? []
  const jobWrites = [...ids('filled'), ...ids('converted')]
  const aoWrites = details.filter(detail => aoProfileOf(detail)).map(detail => detail.$id)
  const aoUnknown = details.filter(detail => text(detail.assigneeId) && !find(text(detail.assigneeId))).map(detail => detail.$id)
  const mark = apply ? '~' : '?'
  console.log(`${jobs.length} offre(s)`)
  console.log(`${mark} ${ids('filled').length} offre(s) sans recruteur à affecter à leur auteur`)
  console.log(`${mark} ${ids('converted').length} offre(s) dont le recruteur affecté est un compte Auth, à convertir en profil`)
  console.log(`= ${ids('already').length} offre(s) déjà affectée(s) à un profil ; ${ids('unowned').length} sans auteur ni recruteur`)
  if (ids('recruiter-unknown').length) console.log(`! ${ids('recruiter-unknown').length} recruteur(s) affecté(s) introuvable(s), gardé(s) : ${sample(ids('recruiter-unknown'))}`)
  if (ids('author-unknown').length) console.log(`! ${ids('author-unknown').length} auteur(s) introuvable(s), offre(s) laissée(s) sans recruteur : ${sample(ids('author-unknown'))}`)
  if (ids('author-outside').length) console.log(`! ${ids('author-outside').length} auteur(s) qui ne sont pas recruteurs de l'organisation de l'offre, offre(s) laissée(s) sans recruteur : ${sample(ids('author-outside'))}`)
  if (!withAssignee) console.log(`= ${DETAILS}.assigneeId absent (npm run schema:push pas encore fait) : aucun AO affecté`)
  else {
    console.log(`${mark} ${aoWrites.length} AO dont le recruteur affecté est un compte Auth, à convertir en profil (${details.length} AO affecté(s))`)
    if (aoUnknown.length) console.log(`! ${aoUnknown.length} AO affecté(s) à un recruteur introuvable, gardé(s) : ${sample(aoUnknown)}`)
  }

  // 3. Sauvegardes, puis écriture document par document, relu juste avant.
  if (!apply || (jobWrites.length === 0 && aoWrites.length === 0)) {
    const backupId = backupCollectionId(JOBS, new Date())
    const report = await backupCollection(db, DB, JOBS, backupId, false)
    console.log(`? sauvegarde ${backupId} (${report.existed ? 'existe déjà' : 'à créer'}) : ${report.copied} offre(s) à copier${aoWrites.length ? `, puis ${DETAILS}` : ''}`)
  } else {
    await confirmProduction()
    if (jobWrites.length) await backup(JOBS, jobWrites)
    if (aoWrites.length) await backup(DETAILS, aoWrites)
    // Listes complètes : retour arrière = valeur relue dans la sauvegarde, au même $id.
    const jobsWritten = await rewrite(JOBS, jobWrites, 'recruiterId', doc => {
      const plan = planOf(doc)
      return plan.note === 'filled' || plan.note === 'converted' ? plan.recruiterId : undefined
    })
    console.log(`~ ${jobsWritten.length} offre(s) mise(s) à jour : ${jobsWritten.join(', ')}`)
    const aoWritten = await rewrite(DETAILS, aoWrites, 'assigneeId', aoProfileOf)
    if (aoWrites.length) console.log(`~ ${aoWritten.length} AO mis à jour : ${aoWritten.join(', ')}`)
    const kept = jobWrites.length + aoWrites.length - jobsWritten.length - aoWritten.length
    if (kept) console.log(`= ${kept} document(s) modifié(s) ou supprimé(s) pendant le passage, gardé(s)`)
  }
  console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
} catch (err) {
  if (!(err instanceof Stop || err instanceof BackupStop)) throw err
  console.error(err.message)
  exitCode = 1
}
if (exitCode) process.exit(exitCode)
