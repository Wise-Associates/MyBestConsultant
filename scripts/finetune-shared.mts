// Outils communs aux scripts d'export d'exemples d'affinage (finetune-cv-dataset.mts, finetune-mbc-dataset.mts) : lecture
// d'un fichier .env et dossier de sortie privé, hors de tout dépôt git (les exemples contiennent des données personnelles).
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideDir } from '../src/lib/finetune/cv-classification-dataset'

/** Lecture d'un fichier .env : fins de ligne Windows, guillemets simples ou doubles, commentaire en fin de valeur. */
export function readEnv(path: string): Record<string, string> {
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

/**
 * Arrête le script si `outDir` est dans ce dépôt ou dans n'importe quel dépôt git (celui du déployeur par exemple), où un
 * « git add . » publierait les données personnelles. Racine du dépôt d'après ce fichier, pas le dossier courant.
 */
export function refuseGitOutDir(outDir: string) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let ancestor = outDir
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
  const inGit = spawnSync('git', ['-C', ancestor, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8' }).stdout.trim() === 'true'
  if (isInsideDir(repoRoot, outDir) || inGit) {
    console.error(`--out ${outDir} : choisissez un dossier hors de tout dépôt git (les exemples contiennent des données personnelles).`)
    process.exit(1)
  }
}

/**
 * Fichier lisible par son seul propriétaire, écrit d'un coup : créé à part (refusé s'il existe déjà, sans suivre de
 * lien), puis renommé ; un fichier ou un lien préparé par quelqu'un d'autre n'est jamais réutilisé.
 */
export function writePrivate(path: string, content: string) {
  const tmp = `${path}.${process.pid}.tmp`
  const fd = openSync(tmp, 'wx', 0o600)
  try { writeSync(fd, content) } finally { closeSync(fd) }
  renameSync(tmp, path)
}

/** Dossier de sortie à soi seul (0700) : sinon un autre utilisateur du poste pourrait lire ou remplacer les fichiers. */
export function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = lstatSync(dir)
  const mine = process.platform === 'win32' || (st.uid === process.getuid?.() && (st.mode & 0o077) === 0)
  if (!st.isDirectory() || st.isSymbolicLink() || !mine) {
    console.error(`--out ${dir} : dossier partagé ou lien ; prenez un dossier neuf, à vous seul (chmod 700).`)
    process.exit(1)
  }
}
