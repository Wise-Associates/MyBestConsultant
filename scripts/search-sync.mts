#!/usr/bin/env -S npx tsx
// Remet l'index de recherche des CV (Meilisearch, ADR 0044 phase 2) d'accord avec Appwrite : applique les réglages de
// l'index, y écrit chaque CV classé (cv_classifications), en retire ceux qui n'y sont plus (src/lib/search/sync.ts).
// Idempotent. Pour un poste qui joint Meilisearch : en local, celui de docker-compose.yml. En production, Meilisearch
// n'est joignable que depuis l'application (réseau interne) : la synchronisation y tourne chaque nuit et à la demande sur
// le serveur (`sudo -u deploy /opt/mybestconsultant/repo/deploy/mbc-cron.sh search-sync`, route /api/cron/search-sync).
//   npm run search:sync -- .env.dev                 → compte ce qui serait fait, ne modifie rien
//   npm run search:sync -- .env.dev --apply         → projet DEV
//   npm run search:sync -- .env --prod --apply      → production, depuis un poste relié par un tunnel (à lancer par un
//                                                     humain ; d'ordinaire inutile : le serveur la fait, voir plus haut)
// Le fichier fournit APPWRITE_*, APPWRITE_COLLECTION_CV_CLASSIFICATIONS, MEILI_URL et MEILI_API_KEY. Aucune donnée de
// CV ni valeur secrète n'est affichée.

import { readFileSync } from 'node:fs'

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

const { cvIndexUid } = await import('../src/lib/search/meili')
const { applyCvIndexSync, planCvIndexSync } = await import('../src/lib/search/sync')

const plan = await planCvIndexSync()
console.log(`Projet ${env.APPWRITE_PROJECT_ID} — index « ${cvIndexUid()} » : ${plan.indexed} documents.`)
console.log(`CV classés à écrire : ${plan.docs.length}${plan.undated ? ` (${plan.undated} sans date de dépôt connue)` : ''}${plan.unreadable ? ` (${plan.unreadable} classification(s) illisible(s) ignorée(s))` : ''} · documents à retirer : ${plan.stale.length}`)
if (!apply) {
  console.log('Simulation : rien n\'est modifié. Ajoutez --apply pour le faire.')
  process.exit(0)
}

const { written, removed } = await applyCvIndexSync(plan, (done, total) => console.log(`… ${done} / ${total} écrits`))
console.log(`Terminé : réglages de l'index appliqués, ${written} écrits, ${removed} retirés.`)
