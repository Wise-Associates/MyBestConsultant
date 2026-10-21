import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Chiffrement des secrets enregistrés en base (mots de passe des boîtes AO des organisations) : AES-256-GCM, qui
// chiffre ET authentifie. Le « contexte » (identifiant du document) est authentifié avec : un texte modifié en base, ou
// recopié vers un autre document, est refusé au déchiffrement.
// Format : « v1.<iv>.<étiquette>.<texte chiffré> » en base64url ; « v1 » permettra de changer d'algorithme.

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

/** Clé de 32 octets encodée en base64 (générée par `openssl rand -base64 32`) ; erreur explicite sinon. */
export function keyFromBase64(encoded: string | undefined, name: string): Buffer {
  const key = Buffer.from(encoded?.trim() ?? '', 'base64')
  if (key.length !== 32) throw new Error(`${name} manquante ou invalide : 32 octets encodés en base64 attendus (openssl rand -base64 32).`)
  return key
}

/** Chiffre `plain` ; seul `unseal` avec la même clé et le même `context` le relira. */
export function seal(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

/** Déchiffre un texte produit par `seal` ; erreur s'il a été altéré, ou si la clé ou le contexte diffèrent. */
export function unseal(sealed: string, key: Buffer, context: string): string {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Secret chiffré illisible (format inconnu).')
  // authTagLength : une étiquette tronquée serait sinon acceptée, et l'authentification affaiblie.
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES })
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
