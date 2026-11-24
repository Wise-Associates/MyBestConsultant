#!/usr/bin/env -S npx tsx
// Exemples d'entraînement pour affiner un modèle open source sur la classification des CV (ADR 0058) : pour chaque CV
// classé par l'IA, le texte que MBC lui a envoyé (CV lu pour la notation : coordonnées masquées ; ici aussi le nom et les
// coordonnées que ce masquage laisse passer) et
// la classification enregistrée comme réponse attendue. Lecture seule : rien n'est écrit dans Appwrite, aucun appel d'IA.
// Le dossier de sortie contient des données personnelles : hors du dépôt, supprimé après l'entraînement.
//   npm run finetune:cv-dataset -- collect .env --out <dossier>             → DEV : raw-<projet>.jsonl
//   npm run finetune:cv-dataset -- collect .env --prod --out <dossier>      → production (fichier .env de production)
//   npm run finetune:cv-dataset -- split --out <dossier>                    → train.jsonl, validation.jsonl, test.jsonl,
//                                                                              test-review.csv (relecture des réponses du test)
// Aucune donnée de CV ni valeur secrète n'est affichée : seulement des nombres.

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideDir } from '../src/lib/finetune/cv-classification-dataset'

const DEV_PROJECT_ID = 'bestconsultant-dev'
/** CV lus en même temps dans le stockage : comme cv:classify. */
const CONCURRENCY = 4

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

const USAGE = 'Usage : npm run finetune:cv-dataset -- collect <fichier .env> [--prod] --out <dossier> | split --out <dossier>'
const [command, ...args] = process.argv.slice(2)
const outAt = args.indexOf('--out')
if (!['collect', 'split'].includes(command ?? '') || outAt < 0 || !args[outAt + 1]) {
  console.error(USAGE)
  process.exit(1)
}
const outDir = resolve(args[outAt + 1])
// Données personnelles : jamais dans un dépôt, où un « git add . » les publierait. Racine de ce dépôt d'après ce
// fichier (pas le dossier courant, qui varie), puis n'importe quel dépôt git (celui du déployeur par exemple).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let ancestor = outDir
while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
const inGit = spawnSync('git', ['-C', ancestor, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8' }).stdout.trim() === 'true'
if (isInsideDir(repoRoot, outDir) || inGit) {
  console.error(`--out ${outDir} : choisissez un dossier hors de tout dépôt git (les exemples contiennent des CV).`)
  process.exit(1)
}

/**
 * Fichier lisible par son seul propriétaire, écrit d'un coup : créé à part (refusé s'il existe déjà, sans suivre de
 * lien), puis renommé ; un fichier ou un lien préparé par quelqu'un d'autre n'est jamais réutilisé.
 */
function writePrivate(path: string, content: string) {
  const tmp = `${path}.${process.pid}.tmp`
  const fd = openSync(tmp, 'wx', 0o600)
  try { writeSync(fd, content) } finally { closeSync(fd) }
  renameSync(tmp, path)
}

/** Dossier de sortie à soi seul (0700) : sinon un autre utilisateur du poste pourrait lire ou remplacer les fichiers. */
function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = lstatSync(dir)
  const mine = process.platform === 'win32' || (st.uid === process.getuid?.() && (st.mode & 0o077) === 0)
  if (!st.isDirectory() || st.isSymbolicLink() || !mine) {
    console.error(`--out ${dir} : dossier partagé ou lien ; prenez un dossier neuf, à vous seul (chmod 700).`)
    process.exit(1)
  }
}

interface RawExample {
  key: string
  project: string
  kind: 'candidate' | 'vivier'
  sourceId: string
  model: string
  family: string
  textKey: string
  cvText: string
  classification: import('../src/lib/cv-classification').CvClassification
}

if (command === 'collect') {
  const file = args.find((a, i) => !a.startsWith('--') && i !== outAt + 1)
  if (!file) { console.error(USAGE); process.exit(1) }
  const env = readEnv(file)
  const required = [
    'APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DB_ID', 'APPWRITE_COLLECTION_USERS',
    'APPWRITE_COLLECTION_VIVIER_CVS', 'APPWRITE_COLLECTION_CV_CLASSIFICATIONS', 'APPWRITE_STORAGE_CVS', 'APPWRITE_STORAGE_VIVIER_CVS',
  ]
  const missing = required.filter(name => !env[name])
  if (missing.length) { console.error(`Variables manquantes dans ${file} : ${missing.join(', ')}.`); process.exit(1) }
  // Garde sur le projet visé, pas sur le nom du fichier : une copie renommée du .env de production ne passe pas.
  if (env.APPWRITE_PROJECT_ID !== DEV_PROJECT_ID && !args.includes('--prod')) {
    console.error(`Projet ${env.APPWRITE_PROJECT_ID} : ce n'est pas le projet de développement, ajoutez --prod pour confirmer.`)
    process.exit(1)
  }
  Object.assign(process.env, env)

  const { Query } = await import('node-appwrite')
  const { createAdminClient } = await import('../src/lib/appwrite/client')
  const { DB_ID, COLLECTIONS, BUCKETS } = await import('../src/lib/appwrite/config')
  const { listAllDocuments } = await import('../src/lib/appwrite/list-all')
  const { classificationId } = await import('../src/lib/appwrite/cv-classifications')
  const { profileText, sourceKeyOf } = await import('../src/lib/cv-classify')
  const { isUpToDate } = await import('../src/lib/cv-classification')
  const { readCvForScoring } = await import('../src/lib/sourcing-core')
  const { mapLimit } = await import('../src/lib/concurrency')
  const { maskClassification, maskLeftoverContacts, maskPersonName, textKey } = await import('../src/lib/finetune/cv-classification-dataset')
  const { createHash } = await import('node:crypto')

  const { databases } = createAdminClient()
  const [users, viviers, stored] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', ['candidate', 'hunter_profile']), Query.select(['$id', 'cvFileId', 'cvProfileJson', 'firstName', 'lastName'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.VIVIER_CVS, [Query.select(['$id', 'cvFileId', 'cvProfileJson', 'candidateName'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.CV_CLASSIFICATIONS, [Query.select(['$id', 'kind', 'sourceId', 'sourceKey', 'version', 'model', 'data'])]),
  ])
  const sources = new Map<string, { kind: 'candidate' | 'vivier'; doc: Record<string, unknown> }>()
  for (const d of users) sources.set(classificationId('candidate', d.$id), { kind: 'candidate', doc: d })
  for (const d of viviers) sources.set(classificationId('vivier', d.$id), { kind: 'vivier', doc: d })

  const counts = { classified: stored.length, noSource: 0, stale: 0, unreadable: 0, noText: 0, noName: 0, nameNotFound: 0, kept: 0 }
  const usable = stored.flatMap(s => {
    const source = sources.get(s.$id)
    if (!source) { counts.noSource++; return [] }
    // Réponse de l'IA pour la version actuelle du CV seulement (ni règles, ni CV remplacé depuis) : sinon le texte et la
    // réponse ne vont pas ensemble.
    const key = sourceKeyOf(source.doc)
    const meta = { sourceKey: String(s.sourceKey ?? ''), version: Number(s.version ?? 0), model: String(s.model ?? '') }
    if (!key || !isUpToDate(meta, key)) { counts.stale++; return [] }
    try {
      const classification = JSON.parse(String(s.data ?? '')) as RawExample['classification']
      if (typeof classification?.jobFamily !== 'string') throw new Error('classification sans famille')
      return [{ id: s.$id, ...source, model: meta.model, classification }]
    } catch {
      counts.unreadable++
      return []
    }
  })

  const examples = (await mapLimit(usable, CONCURRENCY, async (u): Promise<RawExample | null> => {
    const doc = u.doc
    const fileId = typeof doc.cvFileId === 'string' ? doc.cvFileId : ''
    // Même texte que le classement (classifySource, cv-classify.ts) : fichier lu pour la notation, sinon le profil.
    const text = fileId ? await readCvForScoring(fileId, u.kind === 'vivier' ? BUCKETS.VIVIER_CVS : BUCKETS.CVS) : profileText(doc.cvProfileJson)
    if (!text) { counts.noText++; return null }
    const names = (u.kind === 'vivier' ? [String(doc.candidateName ?? '')] : [String(doc.firstName ?? ''), String(doc.lastName ?? '')]).filter(n => n.trim())
    // Nom inconnu : rien à masquer, le CV garderait le nom de la personne ; écarté.
    if (!names.length) { counts.noName++; return null }
    const cvText = maskLeftoverContacts(maskPersonName(text, names))
    // Nom absent du texte (CV déjà anonymisé, nom écrit autrement) : gardé, mais compté pour qu'on le voie.
    if (!cvText.includes('[NOM]')) counts.nameNotFound++
    const classification = maskClassification(u.classification, names)
    counts.kept++
    return {
      key: createHash('sha256').update(`${env.APPWRITE_PROJECT_ID}:${u.id}`).digest('hex').slice(0, 24),
      project: env.APPWRITE_PROJECT_ID, kind: u.kind, sourceId: String(doc.$id), model: u.model,
      family: classification.jobFamily, textKey: textKey(cvText), cvText, classification,
    }
  })).filter((e): e is RawExample => e !== null)

  ensurePrivateDir(outDir)
  const out = join(outDir, `raw-${env.APPWRITE_PROJECT_ID}.jsonl`)
  writePrivate(out, examples.map(e => JSON.stringify(e)).join('\n') + '\n')
  console.log(`Projet ${env.APPWRITE_PROJECT_ID} : ${counts.classified} classifications, ${counts.kept} exemples écrits dans ${out}.`)
  console.log(`Écartées : ${counts.noSource} sans CV, ${counts.stale} faites sur une autre version du CV ou par les règles, ${counts.unreadable} illisibles, ${counts.noText} sans texte lisible, ${counts.noName} sans nom connu (impossible à masquer).`)
  console.log(`Gardés dont le nom n'apparaît pas dans le texte (CV anonymisé ou nom écrit autrement) : ${counts.nameNotFound}.`)
} else {
  ensurePrivateDir(outDir)
  const { assignSplits, chatExample, csvCell } = await import('../src/lib/finetune/cv-classification-dataset')
  const files = readdirSync(outDir).filter(f => /^raw-.+\.jsonl$/.test(f)).sort()
  if (!files.length) { console.error(`Aucun fichier raw-*.jsonl dans ${outDir} : lancez d'abord « collect ».`); process.exit(1) }
  const raw: RawExample[] = files.flatMap(f => readFileSync(join(outDir, f), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as RawExample))
  // Même CV dans DEV et en production (copie de données) : gardé une fois, sinon il pourrait finir à la fois dans
  // l'entraînement et dans le test.
  const seen = new Set<string>()
  const unique = [...raw].sort((a, b) => a.key.localeCompare(b.key)).filter(e => !seen.has(e.textKey) && seen.add(e.textKey))
  const splits = assignSplits(unique.map(e => ({ key: e.key, family: e.family })))
  const bySplit = { train: [] as RawExample[], validation: [] as RawExample[], test: [] as RawExample[] }
  for (const e of unique) bySplit[splits.get(e.key) ?? 'train'].push(e)
  for (const [name, list] of Object.entries(bySplit)) {
    writePrivate(join(outDir, `${name}.jsonl`), list.map(e => JSON.stringify(chatExample(e.cvText, e.classification))).join('\n') + '\n')
  }
  // Relecture humaine des réponses du test (ADR 0058) : la mesure finale se fait contre des réponses vérifiées.
  const review = [
    ['cle', 'projet', 'source', 'identifiant', 'famille', 'metiers', 'competences', 'famille_corrigee', 'commentaire'].join(';'),
    ...bySplit.test.map(e => [e.key, e.project, e.kind, e.sourceId, e.family, e.classification.roles.join(', '),
      e.classification.skills.slice(0, 10).join(', '), '', ''].map(csvCell).join(';')),
  ]
  writePrivate(join(outDir, 'test-review.csv'), '﻿' + review.join('\n') + '\n')
  const families = (list: RawExample[]) => Object.entries(list.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.family]: (acc[e.family] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ')
  console.log(`${raw.length} exemples lus, ${raw.length - unique.length} doublons écartés.`)
  for (const [name, list] of Object.entries(bySplit)) console.log(`${name} : ${list.length} (${families(list)})`)
  console.log(`Fichiers écrits dans ${outDir} (lisibles par vous seul). test-review.csv : réponses du test à relire.`)
}
