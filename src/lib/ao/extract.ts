import { callLLM } from '@/lib/ai/llm-router'
import { extractTextFromFile } from '@/lib/import-file-extract'
import type { InboxMessage } from './imap'
import { parseOffersJson, type ParsedOffers } from './parse'
import { AO_EMAIL_ADDENDUM, AO_EXTRACTION_PROMPT } from './prompt'

// Préparation du texte d'un e-mail (corps + pièces jointes lisibles) et extraction des offres par l'IA.

/** Formats pour lesquels extractTextFromFile a un vrai lecteur (les autres renverraient du binaire). */
const READABLE = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'pptx', 'rtf', 'odt', 'ods', 'odp'])
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Formats Office et OpenDocument : des archives zip, vérifiées avant lecture (bombes de décompression). */
const ZIP_FORMATS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'])
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
/** Taille maximale du texte envoyé à l'IA (même limite que l'import manuel d'appels d'offres). */
const MAX_PROMPT_CHARS = 40_000

export interface EmailContent {
  text: string
  /** Pièces jointes effectivement lues. */
  attachments: string[]
  /** Pièces jointes ignorées, avec la raison (format, taille, fichier illisible). */
  skipped: string[]
}

export async function buildEmailContent(message: InboxMessage): Promise<EmailContent> {
  const parts = [`Objet : ${message.subject}`, message.text]
  const attachments: string[] = []
  const skipped: string[] = []
  for (const file of message.attachments) {
    const ext = file.filename.split('.').pop()?.toLowerCase() ?? ''
    if (!READABLE.has(ext)) { skipped.push(`${file.filename} (format non lu)`); continue }
    if (file.content.length > MAX_ATTACHMENT_BYTES) { skipped.push(`${file.filename} (plus de 10 Mo)`); continue }
    if (ZIP_FORMATS.has(ext) && !(zipUncompressedSize(file.content) <= MAX_UNCOMPRESSED_BYTES)) {
      skipped.push(`${file.filename} (archive illisible ou trop volumineuse une fois décompressée)`)
      continue
    }
    try {
      const text = (await extractTextFromFile(file.content, file.filename)).trim()
      if (!text) { skipped.push(`${file.filename} (aucun texte)`); continue }
      parts.push(`--- Pièce jointe : ${file.filename} ---\n${text}`)
      attachments.push(file.filename)
    } catch {
      // Une pièce jointe corrompue ne doit pas empêcher de traiter le reste de l'e-mail.
      skipped.push(`${file.filename} (illisible)`)
    }
  }
  return { text: parts.filter(Boolean).join('\n\n').slice(0, MAX_PROMPT_CHARS), attachments, skipped }
}

/**
 * Taille totale décompressée d'une archive zip, lue dans son répertoire central (sans rien décompresser).
 * Infinity si l'archive est illisible ou au format zip64 (fichiers de plus de 4 Go).
 */
export function zipUncompressedSize(zip: Buffer): number {
  // Fin du répertoire central : signature 0x06054b50, cherchée dans les 64 derniers Ko (commentaire possible).
  if (zip.length < 22) return Infinity
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return Infinity
  const entries = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  let total = 0
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) return Infinity
    const size = zip.readUInt32LE(offset + 24)
    if (size === 0xffffffff) return Infinity
    total += size
    offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
  }
  return total
}

/**
 * Appelle l'IA configurée dans Admin → Config IA (avec repli automatique) et valide sa réponse.
 * `timeoutMs` borne l'attente pour rester dans la durée d'exécution du passage planifié.
 */
export async function extractOffersFromEmail(content: string, timeoutMs: number): Promise<ParsedOffers> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Pas de réponse de l'IA après ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
  })
  try {
    const { content: raw } = await Promise.race([
      callLLM(
        [{ role: 'user', content: `Voici l'e-mail reçu (corps et pièces jointes) :\n\n${content}` }],
        AO_EXTRACTION_PROMPT + AO_EMAIL_ADDENDUM,
      ),
      timeout,
    ])
    return parseOffersJson(raw)
  } finally {
    clearTimeout(timer)
  }
}
