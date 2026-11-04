#!/usr/bin/env node
// Lancé par le Dockerfile juste après `next build` (ADR 0027).
//
// Le build de l'image de production n'a pas les secrets (seules les valeurs NEXT_PUBLIC_* lui sont données) : une page
// générée au build qui lit Appwrite y trouverait une erreur, souvent rattrapée en silence, et serait servie vide ou avec
// les réglages par défaut jusqu'au déploiement suivant. Ce contrôle fait échouer le build si une page autre que les
// fichiers sans données ci-dessous est générée au build. Solution : `export const dynamic = 'force-dynamic'` dans la
// page ou la route concernée (voir src/app/layout.tsx et src/app/sitemap.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WITHOUT_DATA = new Set(['/_global-error', '/favicon.ico', '/icon.png', '/robots.txt'])

const manifest = JSON.parse(readFileSync(join(process.cwd(), '.next', 'prerender-manifest.json'), 'utf8'))
const prerendered = Object.keys(manifest.routes ?? {})
const unexpected = prerendered.filter(route => !WITHOUT_DATA.has(route))

if (unexpected.length > 0) {
  console.error(`Pages générées au build, sans les secrets de production : ${unexpected.join(', ')}`)
  console.error("Ajoutez export const dynamic = 'force-dynamic' à ces pages (scripts/check-prerendered.mjs).")
  process.exit(1)
}
console.log(`Pages générées au build : ${prerendered.join(', ') || 'aucune'} (sans données).`)
