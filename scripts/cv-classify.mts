#!/usr/bin/env -S npx tsx
// Rattrapage de la classification des CV (collection cv_classifications, ADR 0044) : classe tous les CV de la base
// candidats, des profils de chasseurs et des viviers qui ne le sont pas pour leur version actuelle (Claude Haiku, GPT-4o
// mini si les crédits Anthropic sont épuisés), et efface les classifications dont le CV n'existe plus. Idempotent : un CV
// déjà classé n'est pas refait, le script peut être relancé après un arrêt ou une panne.
//   npm run cv:classify -- .env.dev                       → compte ce qui serait fait, aucun appel d'IA, ne modifie rien
//   npm run cv:classify -- .env.dev --apply               → projet DEV
//   npm run cv:classify -- .env.dev --apply --limit 50    → 50 CV au plus (essai, maîtrise du coût)
//   npm run cv:classify -- .env --prod --apply            → production (à lancer par un humain)
// Prérequis : `npm run schema:push` (collection cv_classifications), clés Claude et OpenAI dans Config IA (ou
// ANTHROPIC_API_KEY / OPENAI_API_KEY dans le fichier). Aucune donnée de CV ni valeur secrète n'est affichée.

import { readFileSync } from 'node:fs'

const DEV_PROJECT_ID = 'bestconsultant-dev'
/** CV classés en même temps : quelques appels simultanés, sous les limites de débit. */
const CONCURRENCY = 4
/** Échecs d'affilée avant l'arrêt (IA ou stockage en panne) : inutile de continuer à échouer. */
const MAX_CONSECUTIVE_FAILURES = 10

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
  console.error('Usage : npm run cv:classify -- <fichier .env> [--apply] [--prod] [--limit N]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const limitAt = flags.indexOf('--limit')
const limit = limitAt >= 0 ? Number(flags[limitAt + 1]) : Infinity
if (!(limit > 0)) { console.error('--limit : nombre de CV attendu'); process.exit(1) }
const env = readEnv(file)
for (const name of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'APPWRITE_COLLECTION_CV_CLASSIFICATIONS']) {
  if (!env[name]) { console.error(`${name} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}
// Les modules de l'application lisent leur configuration dans process.env, à leur chargement.
Object.assign(process.env, env)

const { Query } = await import('node-appwrite')
const { createAdminClient } = await import('../src/lib/appwrite/client')
const { DB_ID, COLLECTIONS } = await import('../src/lib/appwrite/config')
const { listAllDocuments } = await import('../src/lib/appwrite/list-all')
const { classificationId } = await import('../src/lib/appwrite/cv-classifications')
const { classifyFailureText, classifySource, isUpToDate, sourceKeyOf } = await import('../src/lib/cv-classify')
const { mapLimit } = await import('../src/lib/concurrency')

const { databases } = createAdminClient()
type Kind = 'candidate' | 'vivier'

// Sources : candidats et profils de chasseurs (users), CV des viviers (vivier_cvs) ; seulement les champs utiles.
const [users, viviers, stored] = await Promise.all([
  listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', ['candidate', 'hunter_profile']), Query.select(['$id', 'cvFileId', 'cvProfileJson'])]),
  listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.select(['$id', 'cvFileId', 'cvProfileJson'])]),
  listAllDocuments(databases, DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, [Query.select(['$id', 'sourceKey', 'version'])]),
])
const storedById = new Map(stored.map(d => [d.$id, { sourceKey: String(d.sourceKey ?? ''), version: Number(d.version ?? 0) }]))

const sources = [
  ...users.map(d => ({ kind: 'candidate' as Kind, doc: d })),
  ...viviers.map(d => ({ kind: 'vivier' as Kind, doc: d })),
]
const live = new Set(sources.map(s => classificationId(s.kind, s.doc.$id)))
let nothing = 0
let upToDate = 0
const todo: { kind: Kind; id: string }[] = []
for (const { kind, doc } of sources) {
  const key = sourceKeyOf(doc)
  if (!key) { nothing++; continue }
  if (isUpToDate(storedById.get(classificationId(kind, doc.$id)) ?? null, key)) upToDate++
  else todo.push({ kind, id: doc.$id })
}
const orphans = stored.filter(d => !live.has(d.$id)).map(d => d.$id)
const planned = todo.slice(0, Number.isFinite(limit) ? limit : todo.length)

console.log(`Projet ${env.APPWRITE_PROJECT_ID} — ${users.length} candidats et profils de chasseurs, ${viviers.length} CV de viviers.`)
console.log(`Déjà classés : ${upToDate} · sans CV ni profil : ${nothing} · à classer : ${todo.length}${planned.length < todo.length ? ` (${planned.length} avec --limit)` : ''} · classifications sans CV à effacer : ${orphans.length}`)
if (!apply) {
  console.log('Simulation : rien n\'est modifié, aucun appel d\'IA. Ajoutez --apply pour le faire.')
  process.exit(0)
}

for (const id of orphans) {
  await databases.deleteDocument(DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, id).catch(err => {
    if ((err as { code?: number }).code !== 404) throw err
  })
}
if (orphans.length) console.log(`${orphans.length} classification(s) sans CV effacée(s).`)

const counts: Record<string, number> = {}
let done = 0
let consecutiveFailures = 0
let stopped = false
await mapLimit(planned, CONCURRENCY, async ({ kind, id }) => {
  if (stopped) return
  let outcome: string
  try {
    outcome = await classifySource(kind, id)
    consecutiveFailures = 0
  } catch (err) {
    outcome = 'failed'
    consecutiveFailures++
    // Cause de chaque modèle essayé (Claude, puis GPT-4o mini), jamais le texte du CV, pour savoir quoi corriger.
    console.error(`Échec (${kind} ${id}) : ${classifyFailureText(err).slice(0, 400)}`)
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopped = true
      console.error(`${MAX_CONSECUTIVE_FAILURES} échecs d'affilée : arrêt. Corrigez la cause puis relancez (les CV classés sont gardés).`)
    }
  }
  counts[outcome] = (counts[outcome] ?? 0) + 1
  if (++done % 25 === 0) console.log(`… ${done} / ${planned.length}`)
})
console.log('Terminé :', Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'rien à faire')
process.exit(stopped || counts.failed ? 1 : 0)
