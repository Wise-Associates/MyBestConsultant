#!/usr/bin/env node
// Crée le bucket des photos d'affiches des publications sur les réseaux (ADR 0015) dans un projet Appwrite
// (idempotent : l'existant est conservé). Même fonctionnement que scripts/setup-cv-export-storage.mjs.
//
//   npm run social:setup -- .env.dev                → affiche ce qui manque, ne modifie rien
//   npm run social:setup -- .env.dev --apply        → crée ce qui manque (projet DEV)
//   npm run social:setup -- .env --prod             → simulation sur la production
//   npm run social:setup -- .env --prod --apply     → production (à lancer par un humain)
//
// Le fichier d'environnement fournit APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID et APPWRITE_API_KEY.
// Ensuite, ajoutez dans ce même environnement (fichier local ET variables Vercel) :
//   APPWRITE_STORAGE_SOCIAL_SCENES=social_scenes
// Aucune permission client : seule la clé API serveur y accède (src/lib/social-poster/store.ts) ; l'affiche publique
// est dessinée par la route /api/social/poster, qui lit la photo côté serveur.
import { Client, Storage } from 'node-appwrite'
import { readFileSync } from 'fs'

function readEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.error('Usage : npm run social:setup -- <fichier .env> [--apply] [--prod]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const env = readEnv(file)
for (const key of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']) {
  if (!env[key]) { console.error(`${key} manquant dans ${file}`); process.exit(1) }
}
// Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
if (env.APPWRITE_PROJECT_ID !== 'bestconsultant-dev' && !flags.includes('--prod')) {
  console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
  process.exit(1)
}
const storage = new Storage(new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_API_KEY))

// Photos JPEG (ou PNG) d'environ 300 Ko à 1 Mo renvoyées par OpenAI ; 10 Mo laisse de la marge.
const BUCKET = { id: 'social_scenes', name: 'Social scenes (affiches réseaux)', maxFileSize: 10 * 1024 * 1024, extensions: ['jpg', 'png'] }

console.log(`Projet ${env.APPWRITE_PROJECT_ID} — ${apply ? 'CRÉATION' : 'simulation (ajoutez --apply pour créer)'}`)
const bucket = await storage.getBucket(BUCKET.id).catch(e => { if (e.code === 404) return null; throw e })
if (!bucket) {
  console.log(`+ bucket ${BUCKET.id} (privé, ${BUCKET.extensions.join(' / ')}, ${BUCKET.maxFileSize / 1024 / 1024} Mo max)`)
  // permissions [] + fileSecurity true sans permission sur les fichiers : aucun accès client, clé API seulement.
  if (apply) await storage.createBucket(BUCKET.id, BUCKET.name, [], true, true, BUCKET.maxFileSize, BUCKET.extensions, 'none', false, false)
} else {
  // Bucket créé à la main : il doit être fermé aux clients et accepter les photos.
  const problems = [
    bucket.$permissions.length > 0 && `permissions client (${bucket.$permissions.join(', ')})`,
    !bucket.fileSecurity && 'fileSecurity désactivé',
    !bucket.enabled && 'bucket désactivé',
    bucket.allowedFileExtensions.length > 0 && BUCKET.extensions.some(x => !bucket.allowedFileExtensions.includes(x)) && `extensions ${BUCKET.extensions.join(' / ')} non toutes acceptées`,
    bucket.maximumFileSize < BUCKET.maxFileSize && `taille maximale ${bucket.maximumFileSize} o < ${BUCKET.maxFileSize} o`,
  ].filter(Boolean)
  if (problems.length > 0) {
    console.error(`bucket ${BUCKET.id} : ${problems.join(' ; ')}. À corriger dans la console Appwrite avant de définir la variable.`)
    process.exitCode = 1
  } else {
    console.log(`  bucket ${BUCKET.id} : présent, sans permission client`)
  }
}

if (process.exitCode) console.error(apply ? 'Terminé avec des erreurs : voir ci-dessus.' : 'Simulation : erreurs à corriger, voir ci-dessus.')
else console.log(apply ? 'Terminé.' : 'Rien n\'a été modifié.')
console.log('Variable à définir : APPWRITE_STORAGE_SOCIAL_SCENES=social_scenes (portée Preview d\'abord ; Production après --prod --apply)')
