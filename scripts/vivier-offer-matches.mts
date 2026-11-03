#!/usr/bin/env -S npx tsx
// Reconstruit les correspondances du vivier général (collection vivier_offer_matches, ADR 0026) à partir des scores
// enregistrés sur chaque CV (vivier_cvs.offerMatchesJson) : une ligne par CV et par offre notée 65 ou plus. Idempotent :
// crée les lignes manquantes, corrige celles qui diffèrent, supprime celles dont le CV n'existe plus ou n'y correspond plus.
//   npm run vivier:matches -- .env.dev                 → affiche ce qui serait fait, ne modifie rien
//   npm run vivier:matches -- .env.dev --apply         → projet DEV
//   npm run vivier:matches -- .env --prod --apply      → production (à lancer par un humain)
// Ordre de mise en place (ADR 0026) : `npm run schema:push`, ce script avec --apply, déploiement du code qui lit les
// lignes, puis ce script de nouveau (CV comparés entre-temps par l'ancien code), puis une simulation qui doit afficher
// + 0, ~ 0, - 0. Il peut tourner pendant que les recruteurs travaillent : chaque CV à corriger est relu avec ses lignes
// juste avant d'écrire, comme le fait l'application, et une ligne écrite ou supprimée entre-temps par elle est laissée.
// Le fichier d'environnement fournit APPWRITE_* ; aucune valeur secrète ni donnée de CV n'est affichée.

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { Client, Databases, Query, type Models } from 'node-appwrite'
import { parseOfferScores } from '../src/lib/vivier-matching'
import { rowChanges, wantedRows, type VivierOfferMatchRow } from '../src/lib/vivier-offer-matches'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const PAGE = 500

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
  console.error('Usage : npm run vivier:matches -- <fichier .env> [--apply] [--prod]')
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
const CVS = env.APPWRITE_COLLECTION_VIVIER_CVS || 'vivier_cvs'
const MATCHES = env.APPWRITE_COLLECTION_VIVIER_OFFER_MATCHES || 'vivier_offer_matches'
const CV_FIELDS = ['$id', '$updatedAt', 'tenantId', 'jobId', 'offerMatchesJson']
const errorCode = (err: unknown) => (err as { code?: number } | null)?.code

/** Tous les documents d'une collection (curseur), `select` pour ne lire que les attributs utiles. */
async function* all(collection: string, queries: string[] = []): AsyncGenerator<Models.Document[]> {
  let cursor: string | undefined
  for (;;) {
    const res = await db.listDocuments(DB, collection, [...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])])
    if (res.documents.length) yield res.documents
    if (res.documents.length < PAGE) return
    cursor = res.documents[res.documents.length - 1].$id
  }
}

/** CV relu juste avant d'écrire ses lignes ; undefined s'il a été supprimé. */
async function freshCv(cvId: string): Promise<Models.Document | undefined> {
  return db.getDocument(DB, CVS, cvId, [Query.select(CV_FIELDS)]).catch(err => {
    if (errorCode(err) === 404) return undefined
    throw err
  })
}

/** Lignes d'un CV, relues juste avant d'écrire, avec la date de leur dernière écriture. */
async function rowsOf(cvId: string): Promise<{ rows: Map<string, VivierOfferMatchRow>; updatedAt: Map<string, string> }> {
  const rows = new Map<string, VivierOfferMatchRow>()
  const updatedAt = new Map<string, string>()
  for await (const page of all(MATCHES, [Query.equal('vivierCvId', cvId)])) {
    for (const d of page) { rows.set(d.$id, rowOf(d)); updatedAt.set(d.$id, d.$updatedAt) }
  }
  return { rows, updatedAt }
}

/** Lignes voulues pour un CV ; aucune pour un CV du vivier d'une offre (son score est sur le CV lui-même). */
function wantedOf(cv: Models.Document | undefined): Map<string, VivierOfferMatchRow> {
  if (!cv || cv.jobId) return new Map()
  return wantedRows(String(cv.tenantId ?? ''), cv.$id, parseOfferScores(cv.offerMatchesJson as string | null))
}

function rowOf(d: Models.Document): VivierOfferMatchRow {
  return { tenantId: String(d.tenantId ?? ''), jobId: String(d.jobId ?? ''), vivierCvId: String(d.vivierCvId ?? ''), score: Number(d.score), reason: String(d.reason ?? '') }
}

/** Production : confirmation en tapant l'identifiant du projet, comme npm run schema:push. */
async function confirmProduction(): Promise<void> {
  if (!apply || env.APPWRITE_PROJECT_ID === DEV_PROJECT_ID) return
  console.log(`Écriture dans ${env.APPWRITE_ENDPOINT}, projet ${env.APPWRITE_PROJECT_ID}, base ${DB}.`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question('Tapez l\'identifiant du projet pour confirmer : ')
  rl.close()
  if (answer.trim() !== env.APPWRITE_PROJECT_ID) {
    console.error('Confirmation incorrecte : rien n\'a été modifié.')
    process.exit(1)
  }
}

async function main() {
  await confirmProduction()
  try {
    await db.listDocuments(DB, MATCHES, [Query.limit(1)])
  } catch (err) {
    console.error(`Collection ${MATCHES} illisible (${(err as Error).message}) : créez-la d'abord (npm run schema:push -- dev|prod).`)
    process.exit(1)
  }

  const counts = { cvs: 0, created: 0, updated: 0, removed: 0, unchanged: 0, concurrent: 0 }
  const wanted = new Map<string, VivierOfferMatchRow>()
  for await (const page of all(CVS, [Query.isNull('jobId'), Query.select(CV_FIELDS)])) {
    for (const cv of page) {
      counts.cvs++
      for (const [id, row] of wantedOf(cv)) wanted.set(id, row)
    }
  }
  // Lignes existantes relevées en entier avant toute écriture (écrire pendant le parcours fausserait le curseur).
  const existing = new Map<string, VivierOfferMatchRow>()
  for await (const page of all(MATCHES)) for (const d of page) existing.set(d.$id, rowOf(d))

  const { write, remove } = rowChanges(existing, wanted)
  counts.unchanged = wanted.size - write.length
  // CV à corriger traités un par un, relus avec leurs lignes juste avant d'écrire (le premier relevé peut dater de
  // plusieurs minutes) : une comparaison terminée entre-temps par l'application n'est pas défaite.
  const toFix = new Set([...write.map(([, row]) => row.vivierCvId), ...remove.map(id => existing.get(id)?.vivierCvId ?? '')].filter(Boolean))
  for (const cvId of toFix) {
    const [cv, { rows: current, updatedAt }] = await Promise.all([freshCv(cvId), rowsOf(cvId)])
    // L'application écrit les lignes puis les scores du CV : une ligne plus récente que le CV est celle d'une
    // comparaison en cours, dont les scores n'ont pas encore été enregistrés. Laissée, pour ne pas la défaire.
    const inProgress = (id: string) => {
      const at = updatedAt.get(id)
      return !!cv && !!at && Date.parse(at) > Date.parse(cv.$updatedAt)
    }
    const changes = rowChanges(current, wantedOf(cv))
    for (const [id, row] of changes.write) {
      if (inProgress(id)) { counts.concurrent++; continue }
      if (current.has(id)) {
        if (!apply) { counts.updated++; continue }
        try {
          await db.updateDocument(DB, MATCHES, id, row)
          counts.updated++
        } catch (err) {
          // Supprimée entre-temps par l'application (score repassé sous le seuil) : laissée ainsi.
          if (errorCode(err) !== 404) throw err
          counts.concurrent++
        }
        continue
      }
      if (!apply) { counts.created++; continue }
      try {
        await db.createDocument(DB, MATCHES, id, row)
        counts.created++
      } catch (err) {
        // Écrite entre-temps par l'application : la sienne est à jour, elle est laissée.
        if (errorCode(err) !== 409) throw err
        counts.concurrent++
      }
    }
    for (const id of changes.remove) {
      if (inProgress(id)) { counts.concurrent++; continue }
      counts.removed++
      if (apply) await db.deleteDocument(DB, MATCHES, id).catch(err => { if (errorCode(err) !== 404) throw err })
    }
  }

  console.log(`Projet ${env.APPWRITE_PROJECT_ID} — ${counts.cvs} CV du vivier général lu(s), ${wanted.size} correspondance(s) attendue(s).`)
  console.log(`  + ${counts.created} ligne(s) ${apply ? 'créée(s)' : 'à créer'}`)
  console.log(`  ~ ${counts.updated} ligne(s) ${apply ? 'corrigée(s)' : 'à corriger'}`)
  console.log(`  - ${counts.removed} ligne(s) sans CV ou sans correspondance ${apply ? 'supprimée(s)' : 'à supprimer'}`)
  console.log(`  = ${counts.unchanged} ligne(s) déjà à jour`)
  if (counts.concurrent) console.log(`  · ${counts.concurrent} ligne(s) écrite(s) entre-temps par l'application, laissée(s)`)
  if (!apply) console.log('Simulation : rien n\'a été modifié. Ajoutez --apply pour écrire.')
}

main().catch(err => {
  console.error('Échec :', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
