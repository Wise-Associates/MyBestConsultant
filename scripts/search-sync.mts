#!/usr/bin/env -S npx tsx
// Remet l'index de recherche des CV (Meilisearch, ADR 0044 phase 2) d'accord avec Appwrite : applique les réglages de
// l'index, y écrit chaque CV classé (cv_classifications), en retire ceux qui n'y sont plus. Idempotent ; à lancer après
// `npm run cv:classify`, après un changement de réglages (cv-search.ts) et en cas d'avertissement « à rattraper ».
//   npm run search:sync -- .env.dev                 → compte ce qui serait fait, ne modifie rien
//   npm run search:sync -- .env.dev --apply         → projet DEV
//   npm run search:sync -- .env --prod --apply      → production (à lancer par un humain)
// Le fichier fournit APPWRITE_*, APPWRITE_COLLECTION_CV_CLASSIFICATIONS, MEILI_URL et MEILI_API_KEY. Aucune donnée de
// CV ni valeur secrète n'est affichée.

import { readFileSync } from 'node:fs'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const BATCH = 500

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
if (!file) {
  console.error('Usage : npm run search:sync -- <fichier .env> [--apply] [--prod]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const env = readEnv(file)
// Toutes les variables lues par le script (collections, bucket des CV, index), vérifiées avant toute lecture : toutes
// les manquantes d'un coup, par leur nom seulement.
const missing = [
  'APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'APPWRITE_COLLECTION_USERS',
  'APPWRITE_COLLECTION_VIVIER_CVS', 'APPWRITE_COLLECTION_CV_CLASSIFICATIONS', 'APPWRITE_STORAGE_CVS', 'MEILI_URL', 'MEILI_API_KEY',
].filter(name => !env[name])
if (missing.length) {
  console.error(`Variables manquantes dans ${file} : ${missing.join(', ')}.`)
  console.error('Valeurs : celles du même projet (production : /etc/mybestconsultant/app.env et search.env sur le serveur).')
  process.exit(1)
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}
Object.assign(process.env, env)

const { Query } = await import('node-appwrite')
const { createAdminClient } = await import('../src/lib/appwrite/client')
const { DB_ID, COLLECTIONS, BUCKETS } = await import('../src/lib/appwrite/config')
const { listAllDocuments, listAllByValues } = await import('../src/lib/appwrite/list-all')
const { cvSearchDocument } = await import('../src/lib/search/cv-search')
const meili = await import('../src/lib/search/meili')
type Classification = import('../src/lib/cv-classification').CvClassification

const { databases, storage } = createAdminClient()
const classifications = await listAllDocuments(databases, DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, [
  Query.select(['$id', 'kind', 'sourceId', 'tenantId', 'ownerId', 'data']),
])
// Rôle et désinscription des candidats et profils de chasseurs (filtres de l'index), lus d'un coup.
const userIds = classifications.filter(d => d.kind === 'candidate').map(d => String(d.sourceId))
const users = await listAllByValues(databases, DB_ID, COLLECTIONS.USERS, '$id', userIds, [Query.select(['$id', '$updatedAt', 'role', 'optedOutOfOutreach', 'cvFileId'])])
const userById = new Map(users.map(u => [u.$id, u]))
// Dates de dépôt (fraîcheur et tendances des statistiques) : CV des candidats d'après leur fichier, lus en une liste du
// bucket plutôt qu'un appel par CV ; CV des viviers d'après leur import ; profil sans fichier : sa dernière modification.
const fileDates = new Map<string, string>()
for (let cursor: string | undefined; ;) {
  const page = await storage.listFiles(BUCKETS.CVS, [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])])
  for (const f of page.files) fileDates.set(f.$id, f.$createdAt)
  if (page.files.length < 100) break
  cursor = page.files[page.files.length - 1].$id
}
const vivierIds = classifications.filter(d => d.kind === 'vivier').map(d => String(d.sourceId))
const viviers = await listAllByValues(databases, DB_ID, COLLECTIONS.VIVIER_CVS, '$id', vivierIds, [Query.select(['$id', '$createdAt'])])
const vivierDate = new Map(viviers.map(v => [v.$id, v.$createdAt]))

let unreadable = 0
const docs = classifications.flatMap(d => {
  let classification: Classification
  try { classification = JSON.parse(String(d.data)) as Classification } catch { unreadable++; return [] }
  const kind = d.kind === 'vivier' ? 'vivier' as const : 'candidate' as const
  const user = kind === 'candidate' ? userById.get(String(d.sourceId)) : undefined
  // Candidat supprimé entre-temps : pas indexé (sa classification sera effacée par npm run cv:classify).
  if (kind === 'candidate' && !user) return []
  return [cvSearchDocument({
    id: d.$id, kind, sourceId: String(d.sourceId), tenantId: String(d.tenantId ?? ''), ownerId: String(d.ownerId ?? ''),
    role: kind === 'vivier' ? 'vivier' : String(user?.role ?? ''), optedOut: user?.optedOutOfOutreach === true, classification,
    cvDate: kind === 'vivier' ? vivierDate.get(String(d.sourceId)) ?? null
      : user?.cvFileId ? fileDates.get(String(user.cvFileId)) ?? null : user?.$updatedAt ?? null,
  })]
})
const wanted = new Set(docs.map(d => d.id))
let indexed: string[] = []
try {
  indexed = await meili.listCvDocumentIds()
} catch (err) {
  // Index pas encore créé : tout est à écrire.
  if (!(err instanceof meili.MeiliError && err.status === 404)) throw err
}
const stale = indexed.filter(id => !wanted.has(id))

console.log(`Projet ${env.APPWRITE_PROJECT_ID} — index « ${meili.cvIndexUid()} » : ${indexed.length} documents.`)
const undated = docs.filter(d => d.cvDate === null).length
console.log(`CV classés à écrire : ${docs.length}${undated ? ` (${undated} sans date de dépôt connue)` : ''}${unreadable ? ` (${unreadable} classification(s) illisible(s) ignorée(s))` : ''} · documents à retirer : ${stale.length}`)
if (!apply) {
  console.log('Simulation : rien n\'est modifié. Ajoutez --apply pour le faire.')
  process.exit(0)
}

await meili.waitForTask(await meili.applyCvIndexSettings(), 120_000)
console.log('Réglages de l\'index appliqués.')
for (let i = 0; i < docs.length; i += BATCH) {
  await meili.waitForTask(await meili.upsertCvDocuments(docs.slice(i, i + BATCH)), 120_000)
  console.log(`… ${Math.min(i + BATCH, docs.length)} / ${docs.length} écrits`)
}
for (let i = 0; i < stale.length; i += BATCH) {
  await meili.waitForTask(await meili.deleteCvDocuments(stale.slice(i, i + BATCH)), 120_000)
}
console.log(`Terminé : ${docs.length} écrits, ${stale.length} retirés.`)
