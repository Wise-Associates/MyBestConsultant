import { inflateRawSync } from 'node:zlib'
import { extractTextFromFile } from '@/lib/import-file-extract'
import { SkipAttachment, formatOf, type AttachmentExtractor } from './types'

// Documents bureautiques et PDF contenant du texte : lecture locale, sans IA (pdf-parse, mammoth,
// word-extractor, SheetJS, officeparser via extractTextFromFile). Un PDF scanné ne rend aucun texte :
// l'extracteur suivant (vision.ts) prend alors le relais.

/** Formats pour lesquels extractTextFromFile a un vrai lecteur (les autres renverraient du binaire). */
const READABLE = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'pptx', 'rtf', 'odt', 'ods', 'odp'])
/** Formats Office et OpenDocument : des archives zip, vérifiées avant lecture (bombes de décompression). */
const ZIP_FORMATS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'])
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
/** En dessous, un PDF est considéré comme scanné (en-têtes de page seuls, espaces). */
const MIN_PDF_TEXT_CHARS = 20

export const officeTextExtractor: AttachmentExtractor = {
  name: 'texte',
  canRead: file => READABLE.has(formatOf(file)),
  async read(file) {
    const format = formatOf(file)
    if (file.content.length > MAX_ATTACHMENT_BYTES) throw new SkipAttachment('plus de 10 Mo')
    if (ZIP_FORMATS.has(format) && !zipFitsWithin(file.content, MAX_UNCOMPRESSED_BYTES)) {
      throw new SkipAttachment('archive illisible ou trop volumineuse une fois décompressée')
    }
    // extractTextFromFile choisit son lecteur d'après l'extension : on la complète si le nom n'en a pas.
    const name = file.filename.toLowerCase().endsWith(`.${format}`) ? file.filename : `${file.filename}.${format}`
    const text = (await extractTextFromFile(file.content, name)).trim()
    return format === 'pdf' && text.replace(/\s+/g, '').length < MIN_PDF_TEXT_CHARS ? '' : text
  },
}

/**
 * Vrai si l'archive zip se décompresse en `maxBytes` au plus. Les tailles écrites dans l'archive ne sont
 * pas crues (l'expéditeur les choisit) : chaque fichier est réellement décompressé, avec une limite de
 * sortie qui interrompt la décompression dès qu'elle est dépassée. Archive illisible, zip64 ou
 * compression inconnue : faux.
 */
export function zipFitsWithin(zip: Buffer, maxBytes: number): boolean {
  try {
    // Fin du répertoire central : signature 0x06054b50, cherchée dans les 64 derniers Ko (commentaire possible).
    let eocd = -1
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return false
    const entries = zip.readUInt16LE(eocd + 10)
    let offset = zip.readUInt32LE(eocd + 16)
    let total = 0
    for (let n = 0; n < entries; n++) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) return false
      const method = zip.readUInt16LE(offset + 10)
      const compressedSize = zip.readUInt32LE(offset + 20)
      const local = zip.readUInt32LE(offset + 42)
      if (compressedSize === 0xffffffff || local === 0xffffffff || zip.readUInt32LE(local) !== 0x04034b50) return false
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + compressedSize)
      if (data.length !== compressedSize) return false
      if (method === 0) total += compressedSize
      else if (method === 8) total += inflateRawSync(data, { maxOutputLength: Math.max(1, maxBytes - total) }).length
      else return false
      if (total > maxBytes) return false
      offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
    }
    return true
  } catch {
    // Limite de sortie dépassée (ERR_BUFFER_TOO_LARGE), données corrompues ou lecture hors du fichier.
    return false
  }
}
