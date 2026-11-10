#!/usr/bin/env -S npx tsx
// Complète la date limite des e-mails de la veille arrivés sans (appels d'offres du BOAMP). Audit du 10/11/2026 : les
// avis européens en procédure restreinte ou négociée ont un champ `datelimitereponse` vide au BOAMP, et la veille les
// envoyait sans « Date limite de réponse » ; la date est dans le contenu de l'avis (eForms). La veille l'écrit désormais
// à l'envoi (veille-marches-emplois, ADR 0011) : ce script rattrape les e-mails déjà reçus.
//   npm run ao:deadlines -- .env.dev                    → affiche ce qui serait fait, ne modifie rien
//   npm run ao:deadlines -- .env.dev --apply            → projet DEV
//   npm run ao:deadlines -- .env.prod --prod            → simulation sur la production (lecture seule)
//   npm run ao:deadlines -- .env.prod --prod --apply | tee <fichier hors du dépôt>  → production (à lancer par un humain ;
//                                                          la liste s'affiche, puis l'identifiant du projet est demandé)
// Ne fait qu'écrire `deadline` sur un e-mail (ao_emails) qui n'en a pas, relu juste avant : une date déjà là n'est jamais
// remplacée, et aucune offre n'est modifiée ni supprimée. Les offres dont la date est passée apparaissent ensuite dans
// « Offres échues » du tableau, à relire (lien de l'avis affiché). La date est celle du dernier avis rectificatif s'il en
// donne une (il peut la repousser), et un marché déjà attribué est signalé. Retour arrière : remettre `deadline` à vide sur les e-mails des lignes « écrite ».
// Un même message lu par deux boîtes (même boîte IMAP pour la plateforme et une organisation) donne deux e-mails : les
// avis relevés sur l'un valent pour l'autre s'ils ont le même Message-ID et le même objet (choix assumé : seule une date
// publique du BOAMP passe d'une organisation à l'autre).
// Lit les données ouvertes du BOAMP (sans clé). Le fichier d'environnement fournit APPWRITE_* ; aucune valeur secrète
// n'est affichée. Affiche l'objet de chaque e-mail (intitulé d'un avis public).

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { Client, Databases, Query, type Models } from 'node-appwrite'
import { z } from 'zod'
import { boampIdOf, correctedDeadline, frenchDeadline, pickDeadline } from '../src/lib/ao/boamp-deadline'
import { isPastDeadline } from '../src/lib/ao/dates'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const PAGE = 500
const BOAMP_API = 'https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records'
/** Identifiants d'avis par requête au BOAMP (dans l'adresse). */
const BOAMP_CHUNK = 50
const BOAMP_TIMEOUT_MS = 30_000

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
  console.error('Usage : npm run ao:deadlines -- <fichier .env> [--apply] [--prod]')
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
const EMAILS = env.APPWRITE_COLLECTION_AO_EMAILS || 'ao_emails'
const OFFERS = env.APPWRITE_COLLECTION_AO_OFFERS || 'ao_offers'
const DETAILS = env.APPWRITE_COLLECTION_AO_OFFER_DETAILS || 'ao_offer_details'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

async function listAll(collection: string, queries: string[]): Promise<Models.Document[]> {
  const all: Models.Document[] = []
  let cursor: string | undefined
  for (;;) {
    const { documents } = await db.listDocuments(DB, collection, [...queries, Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])])
    all.push(...documents)
    if (documents.length < PAGE) return all
    cursor = documents[documents.length - 1].$id
  }
}

/** Documents dont `attribute` vaut l'une des valeurs, par lots de 100 (Appwrite refuse davantage dans un Query.equal). */
async function listByValues(collection: string, attribute: string, values: string[], select: string[]): Promise<Models.Document[]> {
  const unique = [...new Set(values.filter(Boolean))]
  const out: Models.Document[] = []
  for (let i = 0; i < unique.length; i += 100) {
    out.push(...await listAll(collection, [Query.equal(attribute, unique.slice(i, i + 100)), Query.select(select)]))
  }
  return out
}

const boampRecord = z.object({
  idweb: z.string(),
  dateparution: z.string().nullish(),
  datelimitereponse: z.string().nullish(),
  donnees: z.string().nullish(),
  annonce_lie: z.array(z.string()).nullish(),
})
type BoampRecord = z.infer<typeof boampRecord>
const boampPage = z.object({ total_count: z.number(), results: z.array(boampRecord) })
/** Au-delà, la requête est à revoir (quelques rectificatifs par avis au plus). */
const BOAMP_MAX_RESULTS = 100

/** Avis du BOAMP pour une requête (données ouvertes, sans clé), du plus récent au plus ancien. */
async function boampQuery(where: string, select: string): Promise<BoampRecord[]> {
  const params = new URLSearchParams({ where, select, order_by: 'dateparution desc', limit: String(BOAMP_MAX_RESULTS) })
  const res = await fetch(`${BOAMP_API}?${params}`, {
    headers: { accept: 'application/json', 'user-agent': 'MyBestConsultant ao:deadlines' },
    signal: AbortSignal.timeout(BOAMP_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`BOAMP : HTTP ${res.status}`)
  const page = boampPage.parse(await res.json())
  if (page.total_count > page.results.length) throw new Error(`BOAMP : ${page.total_count} avis pour une requête, plus de ${BOAMP_MAX_RESULTS} : à revoir.`)
  return page.results
}

/**
 * Avis initiaux par identifiant, et pour chacun son dernier rectificatif (qui peut repousser la date limite) et son avis
 * d'attribution s'il est paru (marché attribué : plus de réponse possible). Identifiants vérifiés par boampIdOf
 * (« 26-92618 ») : sûrs entre guillemets dans la requête.
 */
async function boampNotices(ids: string[]) {
  const records = new Map<string, BoampRecord>()
  const corrections = new Map<string, BoampRecord>()
  const awards = new Map<string, BoampRecord>()
  const linked = (chunk: string[]) => chunk.map(id => `annonce_lie="${id}"`).join(' OR ')
  for (let i = 0; i < ids.length; i += BOAMP_CHUNK) {
    const chunk = ids.slice(i, i + BOAMP_CHUNK)
    for (const r of await boampQuery(`idweb IN (${chunk.map(id => `"${id}"`).join(', ')})`, 'idweb,datelimitereponse,donnees')) records.set(r.idweb, r)
    // Du plus récent au plus ancien : le premier vu pour un avis est le dernier paru.
    for (const r of await boampQuery(`etat="RECTIFICATIF" AND (${linked(chunk)})`, 'idweb,dateparution,datelimitereponse,donnees,annonce_lie')) {
      for (const id of r.annonce_lie ?? []) if (chunk.includes(id) && !corrections.has(id)) corrections.set(id, r)
    }
    for (const r of await boampQuery(`nature="ATTRIBUTION" AND (${linked(chunk)})`, 'idweb,dateparution,annonce_lie')) {
      for (const id of r.annonce_lie ?? []) if (chunk.includes(id) && !awards.has(id)) awards.set(id, r)
    }
  }
  return { records, corrections, awards }
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

interface Plan { emailId: string; subject: string; receivedAt: string; ids: string[]; deadline: string; notes: string[] }

/** Jour à Paris (AAAA-MM-JJ). */
const parisDay = (instant: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)

async function main() {
  const emails = (await listAll(EMAILS, [Query.equal('status', 'processed'), Query.select(['$id', '$createdAt', 'deadline', 'subject', 'receivedAt', 'messageId'])]))
    .filter(doc => !str(doc.deadline).trim())
  const offers = await listByValues(OFFERS, 'emailId', emails.map(e => e.$id), ['$id', 'emailId'])
  const details = await listByValues(DETAILS, '$id', offers.map(o => o.$id), ['$id', 'sourceUrl'])
  const urlOf = new Map(details.map(d => [d.$id, str(d.sourceUrl)]))
  const idsByEmail = new Map<string, string[]>()
  for (const offer of offers) {
    const id = boampIdOf(urlOf.get(offer.$id) ?? '')
    if (id) idsByEmail.set(str(offer.emailId), [...new Set([...(idsByEmail.get(str(offer.emailId)) ?? []), id])])
  }
  // Un même message lu par deux boîtes (deux organisations sur la même boîte IMAP) donne deux e-mails : l'IA n'a pas
  // toujours relevé le lien de l'avis dans les deux. Les avis d'un e-mail valent pour toutes ses copies (même Message-ID).
  const copyKey = (email: Models.Document) => (str(email.messageId) ? `${str(email.messageId)}\n${str(email.subject)}` : '')
  const idsByMessage = new Map<string, string[]>()
  for (const email of emails) {
    const ids = idsByEmail.get(email.$id)
    const key = copyKey(email)
    if (ids && key) idsByMessage.set(key, [...new Set([...(idsByMessage.get(key) ?? []), ...ids])])
  }
  for (const email of emails) {
    const shared = idsByMessage.get(copyKey(email))
    if (shared) idsByEmail.set(email.$id, shared)
  }
  const { records, corrections, awards } = await boampNotices([...new Set([...idsByEmail.values()].flat())])

  const now = new Date()
  const today = parisDay(now)
  const plans: Plan[] = []
  let withoutDate = 0
  let missing = 0
  for (const email of emails) {
    const ids = idsByEmail.get(email.$id)
    if (!ids) continue
    // Une seule date par e-mail : parmi celles de ses avis, même règle que pour les lots d'un avis (pickDeadline).
    const dates = ids.flatMap(id => {
      const record = records.get(id)
      if (!record) { missing++; return [] }
      const deadline = correctedDeadline(record, corrections.get(id), today)
      if (!deadline) { withoutDate++; return [] }
      return [deadline]
    })
    const notes = ids.flatMap(id => [
      ...(corrections.has(id) ? [`rectifié par ${corrections.get(id)?.idweb}`] : []),
      ...(awards.has(id) ? [`attribué (avis ${awards.get(id)?.idweb} du ${str(awards.get(id)?.dateparution)})`] : []),
    ])
    const deadline = pickDeadline(dates, today)
    if (deadline) plans.push({ emailId: email.$id, subject: str(email.subject), receivedAt: str(email.receivedAt) || email.$createdAt, ids, deadline: frenchDeadline(deadline), notes })
  }

  console.log(`${emails.length} e-mail(s) traité(s) sans date limite, dont ${idsByEmail.size} lié(s) à un avis du BOAMP.`)
  console.log(`Avis : ${records.size} relu(s), ${corrections.size} rectifié(s), ${awards.size} attribué(s), ${missing} introuvable(s) au BOAMP, ${withoutDate} sans date limite.`)
  for (const p of plans) {
    // Date passée : lien de l'avis, pour vérifier sur boamp.fr qu'aucun rectificatif ne l'a repoussée avant de supprimer.
    const past = isPastDeadline(p.deadline, now, new Date(p.receivedAt))
      ? ` (passée : ${p.ids.map(id => `https://www.boamp.fr/pages/avis/?q=idweb:${id}`).join(' ')})`
      : ''
    const notes = p.notes.length ? `  [${p.notes.join(' ; ')}]` : ''
    console.log(`  + ${p.emailId}  ${p.ids.join(',')}  ${p.deadline}${past}${notes}  reçu le ${p.receivedAt.slice(0, 10)}  « ${p.subject.slice(0, 70)} »`)
  }
  if (!apply) {
    console.log(`\n${plans.length} date(s) limite(s) à écrire. Simulation : rien n'a été modifié (ajoutez --apply).`)
    return
  }
  if (!plans.length) return
  // Confirmation après la liste : on confirme exactement ce qui est affiché.
  await confirmProduction()
  let written = 0
  let skipped = 0
  for (const p of plans) {
    // Relu juste avant d'écrire : une date arrivée entre-temps (synchronisation, autre passage du script) est gardée.
    const current = await db.getDocument(DB, EMAILS, p.emailId, [Query.select(['$id', 'deadline'])])
    if (str(current.deadline).trim()) {
      skipped++
      console.log(`  gardée  ${p.emailId}  (date arrivée entre-temps)`)
      continue
    }
    await db.updateDocument(DB, EMAILS, p.emailId, { deadline: p.deadline })
    written++
    console.log(`  écrite  ${p.emailId}  ${p.deadline}`)
  }
  console.log(`\n${written} date(s) limite(s) écrite(s), ${skipped} gardée(s). Retour arrière : deadline = '' sur les lignes « écrite ».`)
}

main().catch((err: unknown) => {
  console.error(`Échec : ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
