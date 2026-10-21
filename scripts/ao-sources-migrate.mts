#!/usr/bin/env -S npx tsx
// Passage d'AO Offers aux boîtes par organisation (docs/adr/0005-ao-boites-par-organisation.md). Idempotent.
//
//   npm run ao:migrate-sources -- .env.dev                       → affiche ce qui serait fait, ne modifie rien
//   npm run ao:migrate-sources -- .env.dev --apply               → projet DEV
//   npm run ao:migrate-sources -- .env --prod --apply            → production (à lancer par un humain)
//   … --apply --reseal          → réenregistre le serveur, l'identifiant et le mot de passe de la boîte de la plateforme
//   … --apply --drop-old-index  → étape finale (voir l'ADR) : supprime l'index unique sur messageId seul
//
// Prérequis : `npm run ao:setup -- <fichier> --apply` (collection ao_sources, ao_emails.sourceId, index unique
// sourceId + messageId « available »). Pendant l'exécution, le script détient les verrous de synchronisation (ancien
// et nouveau) : tout passage, ancien ou nouveau code, est ignoré au lieu d'écrire en même temps.
//   1. crée la boîte de la plateforme (tenantId « admin ») à partir de AO_IMAP_*, mot de passe chiffré avec
//      AO_CREDENTIALS_KEY (la même clé que le serveur), lié à la boîte, au serveur et à l'identifiant ;
//   2. rattache à cette boîte les e-mails AO qui n'en ont pas (un e-mail en conflit est signalé, pas modifié) ;
//   3. avec --drop-old-index seulement, et s'il ne reste aucun e-mail sans boîte : supprime l'ancien index unique.
// Le fichier d'environnement fournit APPWRITE_*, AO_IMAP_* et AO_CREDENTIALS_KEY ; aucune valeur secrète n'est affichée.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Client, Databases, ID, Query, type Models } from 'node-appwrite'
import { keyFromBase64, seal } from '../src/lib/crypto-box'
import { lockIdFor, mailboxSecretContext, PLATFORM_TENANT_ID } from '../src/lib/ao/tenancy'

const DEV_PROJECT_ID = 'bestconsultant-dev'
const OLD_UNIQUE_INDEX = 'messageid_unique'
const NEW_UNIQUE_INDEX = 'source_message_unique'
/** Verrou de l'ancien code (un seul passage à la fois, toutes boîtes confondues). */
const OLD_LOCK_ID = 'sync_lock'
const LOCK_MS = 30 * 60_000

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
  console.error('Usage : npm run ao:migrate-sources -- <fichier .env> [--apply] [--prod] [--reseal] [--drop-old-index]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const reseal = flags.includes('--reseal')
const dropOldIndex = flags.includes('--drop-old-index')
const env = readEnv(file)
const required = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'AO_IMAP_USER', 'AO_IMAP_PASSWORD', 'AO_CREDENTIALS_KEY']
for (const name of required) {
  if (!env[name]) { console.error(`${name} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}
const key = keyFromBase64(env.AO_CREDENTIALS_KEY, 'AO_CREDENTIALS_KEY')

const db = new Databases(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))
const DB = env.APPWRITE_DB_ID
const SOURCES = env.APPWRITE_COLLECTION_AO_SOURCES || 'ao_sources'
const EMAILS = env.APPWRITE_COLLECTION_AO_EMAILS || 'ao_emails'
const STATE = env.APPWRITE_COLLECTION_AO_STATE || 'ao_sync_state'
const codeOf = (err: unknown) => (err as { code?: number }).code
/** Arrêt prévu (message pour l'opérateur) : les verrous sont rendus, le script se termine en erreur. */
class Stop extends Error {}

const host = (env.AO_IMAP_HOST || 'imap.ionos.fr').trim().toLowerCase()
const username = env.AO_IMAP_USER.trim()
const mailbox = (env.AO_IMAP_MAILBOX || 'INBOX').trim()

console.log(`Projet ${env.APPWRITE_PROJECT_ID}, base ${DB} — ${apply ? 'MIGRATION' : 'simulation (ajoutez --apply pour migrer)'}`)

// 0. Prérequis, vérifiés avant toute écriture.
try {
  await db.getCollection(DB, SOURCES)
} catch (err) {
  if (codeOf(err) !== 404) throw err
  console.error(`Collection ${SOURCES} absente : lancez d'abord npm run ao:setup -- ${file} --apply.`)
  process.exit(1)
}
const sourceIdAttr = (await db.listAttributes(DB, EMAILS)).attributes.find(a => (a as { key: string }).key === 'sourceId') as { status?: string } | undefined
const newIndex = (await db.listIndexes(DB, EMAILS)).indexes.find(i => i.key === NEW_UNIQUE_INDEX)
if (sourceIdAttr?.status !== 'available' || newIndex?.status !== 'available') {
  console.error(`${EMAILS}.sourceId : ${sourceIdAttr?.status ?? 'absent'} ; index ${NEW_UNIQUE_INDEX} : ${newIndex?.status ?? 'absent'}${newIndex?.error ? ` (${newIndex.error})` : ''}.`)
  console.error('Les deux doivent être « available » : lancez npm run ao:setup -- <fichier> --apply et attendez la fin de la création.')
  process.exit(1)
}

// Verrous de synchronisation (ancien code : sync_lock ; nouveau : verrou de la plateforme), détenus pendant la migration.
const locks: { id: string; token: string }[] = []
async function takeLock(id: string): Promise<boolean> {
  const token = randomUUID()
  const data = { kind: 'lock', holder: 'ao-sources-migrate', token, expiresAt: new Date(Date.now() + LOCK_MS).toISOString() }
  try {
    await db.createDocument(DB, STATE, id, data)
  } catch (err) {
    if (codeOf(err) !== 409) throw err
    const current = await db.getDocument(DB, STATE, id)
    if (new Date(String(current.expiresAt)).getTime() > Date.now()) return false
    await db.updateDocument(DB, STATE, id, data)
  }
  locks.push({ id, token })
  return true
}
async function releaseLocks(): Promise<void> {
  for (const lock of locks) {
    const current = await db.getDocument(DB, STATE, lock.id).catch(() => null)
    if (current?.token === lock.token) await db.deleteDocument(DB, STATE, lock.id)
  }
}

let exitCode = 0
try {
  if (apply) {
    for (const id of [OLD_LOCK_ID, lockIdFor(PLATFORM_TENANT_ID)]) {
      if (!(await takeLock(id))) {
        throw new Stop(`Une synchronisation est en cours (verrou ${id}) : arrêtez les planificateurs et réessayez dans quelques minutes.`)
      }
    }
  }

  // 1. Boîte de la plateforme, retrouvée par son organisation seulement (un seul document attendu).
  const platform = await db.listDocuments(DB, SOURCES, [Query.equal('tenantId', PLATFORM_TENANT_ID), Query.limit(10)])
  if (platform.total > 1) {
    throw new Stop(`${platform.total} boîtes de la plateforme existent déjà : ce script n'en gère qu'une, corrigez à la main.`)
  }
  let source: Models.Document | undefined = platform.documents[0]
  const fields = (id: string) => ({
    host, username, mailbox,
    passwordSealed: seal(env.AO_IMAP_PASSWORD, key, mailboxSecretContext({ $id: id, host, username })),
  })
  if (!source) {
    const id = ID.unique()
    console.log(`+ boîte de la plateforme ${username} sur ${host} (dossier ${mailbox})`)
    if (apply) {
      source = await db.createDocument(DB, SOURCES, id, {
        tenantId: PLATFORM_TENANT_ID, label: username, enabled: true, lastError: '',
        ownDomains: [username.split('@')[1]?.toLowerCase() || 'wise-associates.fr'], ...fields(id),
      })
    }
  } else if (reseal) {
    console.log(`~ boîte de la plateforme ${source.$id} : serveur, identifiant, dossier et mot de passe réenregistrés`)
    if (apply) await db.updateDocument(DB, SOURCES, source.$id, { ...fields(source.$id), lastError: '' })
  } else if (source.host !== host || source.username !== username) {
    // Ne jamais supprimer cette boîte pour la recréer : ses e-mails y sont rattachés par son identifiant.
    throw new Stop(`La boîte de la plateforme ${source.$id} vise ${source.username} sur ${source.host}, le fichier ${username} sur ${host} : ajoutez --reseal pour la mettre à jour.`)
  } else {
    console.log(`= boîte de la plateforme déjà créée (${source.$id})`)
  }

  // 2. E-mails sans boîte → boîte de la plateforme (la seule lue avant cette version), par curseur : un e-mail en
  //    conflit (même Message-ID déjà rattaché) est signalé et laissé tel quel, la suite continue.
  let attached = 0
  let missing = 0
  const conflicts: string[] = []
  let cursor: string | null = null
  for (;;) {
    const page: Models.DocumentList<Models.Document> = await db.listDocuments(DB, EMAILS, [
      Query.isNull('sourceId'), Query.orderAsc('$id'), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : []),
    ])
    if (!page.documents.length) break
    cursor = page.documents[page.documents.length - 1].$id
    if (!apply || !source) {
      missing += page.documents.length
      continue
    }
    for (const doc of page.documents) {
      try {
        await db.updateDocument(DB, EMAILS, doc.$id, { sourceId: source.$id })
        attached++
      } catch (err) {
        if (codeOf(err) === 404) continue // purgé entre-temps
        if (codeOf(err) !== 409) throw err
        conflicts.push(doc.$id)
      }
    }
  }
  if (apply) console.log(`~ ${attached} e-mail(s) rattaché(s) à la boîte de la plateforme`)
  else console.log(`? ${missing} e-mail(s) à rattacher à la boîte de la plateforme`)
  if (conflicts.length) {
    console.error(`! ${conflicts.length} e-mail(s) déjà présents dans la boîte (créés par l'ancienne version pendant la migration), laissés sans boîte : ${conflicts.slice(0, 20).join(', ')}`)
    exitCode = 1
  }

  // 3. Ancien index unique : seulement sur demande, quand plus aucun e-mail n'est sans boîte.
  const remaining = (await db.listDocuments(DB, EMAILS, [Query.isNull('sourceId'), Query.limit(1)])).total
  const hasOldIndex = (await db.listIndexes(DB, EMAILS)).indexes.some(i => i.key === OLD_UNIQUE_INDEX)
  if (hasOldIndex && dropOldIndex) {
    if (remaining > 0) {
      console.error(`Index ${OLD_UNIQUE_INDEX} gardé : ${remaining} e-mail(s) encore sans boîte.`)
      exitCode = 1
    } else {
      console.log(`- index ${EMAILS}.${OLD_UNIQUE_INDEX}`)
      if (apply) await db.deleteIndex(DB, EMAILS, OLD_UNIQUE_INDEX)
    }
  } else if (hasOldIndex) {
    console.log(`= index ${OLD_UNIQUE_INDEX} gardé (supprimé par --drop-old-index, étape finale de l'ADR 0005)`)
  }
  console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
} catch (err) {
  if (!(err instanceof Stop)) throw err
  console.error(err.message)
  exitCode = 1
} finally {
  await releaseLocks()
}
if (exitCode) process.exit(exitCode)
