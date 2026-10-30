#!/usr/bin/env -S npx tsx
// Reconstruit l'index de la liste des offres AO (collection ao_offer_index, ADR 0019) à partir de ao_offers, ao_emails
// et ao_sources : une ligne par offre, rattachée à l'organisation de la boîte de son e-mail. Idempotent : crée les
// lignes manquantes, corrige celles qui diffèrent, supprime celles dont l'offre n'existe plus (ou n'a plus de boîte).
//   npm run ao:index -- .env.dev                    → affiche ce qui serait fait, ne modifie rien
//   npm run ao:index -- .env.dev --apply            → projet DEV
//   npm run ao:index -- .env --prod --apply         → production (à lancer par un humain)
// Ordre de mise en place (ADR 0019) : `npm run schema:push`, ce script avec --apply, déploiement du code qui lit
// l'index, puis ce script de nouveau (offres créées ou changées entre-temps par l'ancien code), puis une simulation qui
// doit afficher + 0, ~ 0, - 0. Il peut tourner pendant une synchronisation : une ligne n'est supprimée qu'après avoir
// vérifié que son offre n'existe vraiment plus, et une ligne écrite entre-temps par l'application est laissée.
// Le fichier d'environnement fournit APPWRITE_* ; aucune valeur secrète ni donnée d'offre n'est affichée.

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { Client, Databases, Query, type Models } from 'node-appwrite'
import { indexDocumentOf, senderOf, type AoOfferIndexDoc } from '../src/lib/ao/offer-index'
import { docToAoEmail, docToAoOffer } from '../src/lib/ao/repo'
import type { AoEmail } from '../src/lib/ao/types'

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
  console.error('Usage : npm run ao:index -- <fichier .env> [--apply] [--prod]')
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
const OFFERS = env.APPWRITE_COLLECTION_AO_OFFERS || 'ao_offers'
const EMAILS = env.APPWRITE_COLLECTION_AO_EMAILS || 'ao_emails'
const SOURCES = env.APPWRITE_COLLECTION_AO_SOURCES || 'ao_sources'
const INDEX = env.APPWRITE_COLLECTION_AO_OFFER_INDEX || 'ao_offer_index'

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

async function byIds(collection: string, ids: string[]): Promise<Map<string, Models.Document>> {
  const found = new Map<string, Models.Document>()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100)
    const res = await db.listDocuments(DB, collection, [Query.equal('$id', batch), Query.limit(batch.length)])
    for (const doc of res.documents) found.set(doc.$id, doc)
  }
  return found
}

/** Valeurs identiques ; dates comparées comme instants (Appwrite les renvoie en « +00:00 », l'index les écrit en « Z »). */
function differs(current: Models.Document, wanted: AoOfferIndexDoc): boolean {
  const doc = current as Models.Document & Record<string, unknown>
  return (Object.keys(wanted) as (keyof AoOfferIndexDoc)[]).some(key => {
    if (key === 'receivedAt') return new Date(String(doc.receivedAt)).getTime() !== new Date(wanted.receivedAt).getTime()
    return (doc[key] ?? null) !== (wanted[key] ?? null)
  })
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
    await db.listDocuments(DB, INDEX, [Query.limit(1)])
  } catch (err) {
    console.error(`Collection ${INDEX} illisible (${(err as Error).message}) : créez-la d'abord (npm run schema:push -- dev|prod).`)
    process.exit(1)
  }
  const tenantOf = new Map<string, string>()
  for await (const page of all(SOURCES, [Query.select(['$id', 'tenantId'])])) {
    for (const source of page) tenantOf.set(source.$id, String((source as Models.Document & { tenantId?: unknown }).tenantId ?? ''))
  }

  const counts = { offers: 0, created: 0, updated: 0, unchanged: 0, concurrent: 0, withoutMailbox: 0, orphans: 0, recent: 0 }
  const indexed = new Set<string>()
  const withoutMailbox = new Set<string>()
  /** Ligne voulue pour une offre (null : pas de boîte connue, donc à aucune organisation). */
  const wantedFor = (offer: ReturnType<typeof docToAoOffer>, emailDoc: Models.Document | undefined): AoOfferIndexDoc | null => {
    const email: AoEmail | undefined = emailDoc ? docToAoEmail(emailDoc) : undefined
    const tenantId = email ? tenantOf.get(email.sourceId) : undefined
    if (!tenantId) return null
    return indexDocumentOf(offer, { tenantId, receivedAt: email?.receivedAt ?? offer.createdAt, subject: email?.subject ?? '', sender: senderOf(email) })
  }
  for await (const page of all(OFFERS)) {
    const offers = page.map(docToAoOffer)
    const [emails, existing] = await Promise.all([byIds(EMAILS, offers.map(o => o.emailId)), byIds(INDEX, offers.map(o => o.$id))])
    for (const offer of offers) {
      counts.offers++
      const wanted = wantedFor(offer, emails.get(offer.emailId))
      // Sans boîte connue, l'offre n'est à aucune organisation : pas de ligne (et l'ancienne, s'il y en a, est supprimée).
      if (!wanted) { counts.withoutMailbox++; withoutMailbox.add(offer.$id); continue }
      indexed.add(offer.$id)
      const current = existing.get(offer.$id)
      if (!current) {
        if (!apply) { counts.created++; continue }
        try {
          await db.createDocument(DB, INDEX, offer.$id, wanted)
          counts.created++
        } catch (err) {
          // Écrite entre-temps par l'application (synchronisation en cours) : la sienne est à jour, elle est laissée.
          if ((err as { code?: number }).code !== 409) throw err
          counts.concurrent++
        }
      } else if (differs(current, wanted)) {
        counts.updated++
        if (!apply) continue
        // Relue juste avant l'écriture : un statut changé depuis la lecture de la page (publication…) n'est pas écrasé.
        const fresh = await db.getDocument(DB, OFFERS, offer.$id).catch(err => { if ((err as { code?: number }).code === 404) return null; throw err })
        const freshWanted = fresh ? wantedFor(docToAoOffer(fresh), (await byIds(EMAILS, [docToAoOffer(fresh).emailId])).get(docToAoOffer(fresh).emailId)) : null
        if (freshWanted) await db.updateDocument(DB, INDEX, offer.$id, freshWanted)
      } else {
        counts.unchanged++
      }
    }
  }

  // Lignes sans offre indexée : relevées d'abord (supprimer pendant le parcours fausserait le curseur), puis supprimées
  // seulement si leur offre n'existe vraiment plus ou n'a pas de boîte. Une offre créée pendant le parcours garde sa ligne.
  const candidates: string[] = []
  for await (const page of all(INDEX, [Query.select(['$id'])])) {
    for (const line of page) if (!indexed.has(line.$id)) candidates.push(line.$id)
  }
  const stillThere = await byIds(OFFERS, candidates)
  for (const id of candidates) {
    if (stillThere.has(id) && !withoutMailbox.has(id)) { counts.recent++; continue }
    counts.orphans++
    if (apply) await db.deleteDocument(DB, INDEX, id).catch(err => { if ((err as { code?: number }).code !== 404) throw err })
  }

  console.log(`Projet ${env.APPWRITE_PROJECT_ID} — ${counts.offers} offre(s) lue(s).`)
  console.log(`  + ${counts.created} ligne(s) d'index ${apply ? 'créée(s)' : 'à créer'}`)
  console.log(`  ~ ${counts.updated} ligne(s) ${apply ? 'corrigée(s)' : 'à corriger'}`)
  console.log(`  - ${counts.orphans} ligne(s) sans offre (ou sans boîte) ${apply ? 'supprimée(s)' : 'à supprimer'}`)
  console.log(`  = ${counts.unchanged} ligne(s) déjà à jour`)
  if (counts.concurrent) console.log(`  · ${counts.concurrent} ligne(s) écrite(s) entre-temps par l'application, laissée(s)`)
  if (counts.recent) console.log(`  · ${counts.recent} ligne(s) d'offres créées pendant le parcours, laissée(s)`)
  if (counts.withoutMailbox) console.log(`  ! ${counts.withoutMailbox} offre(s) dont l'e-mail ou la boîte est introuvable : absentes de toute liste.`)
  if (!apply) console.log('Simulation : rien n\'a été modifié. Ajoutez --apply pour écrire.')
}

main().catch(err => {
  console.error('Échec :', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
