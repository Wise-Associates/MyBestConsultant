import { inflate } from 'node:zlib'
import { promisify } from 'node:util'

// Revue de sécurité du 2026-11-21 : pdf.js 1.10 (pdf-parse 1.1.1) garde en mémoire chaque flux décodé, sans limite. Un PDF
// de 1 Mo dont le contenu se décompresse en 1 Go prenait 1,6 Go de mémoire (2 Go par conteneur en production : redémarrage
// de l'application). Avant de confier un PDF à pdf.js, chaque flux est donc décompressé une fois par zlib avec un plafond
// (en tâche de fond, sans bloquer le serveur), et le PDF est refusé au-delà, ou s'il emploie un filtre dont la taille ne
// peut pas être mesurée. Testé dans pdf-inflate-guard.test.ts ; appliqué par extractTextFromFile (import-file-extract.ts).

const inflateAsync = promisify(inflate) as (data: Buffer, options: { maxOutputLength: number }) => Promise<Buffer>

/**
 * 64 Mo par flux, 192 Mo pour tout le document (un PDF de texte en fait quelques Mo ; une page scannée en couleur à
 * 300 dpi, environ 25 Mo) ; 4 couches de compression au plus.
 */
export const PDF_INFLATE_LIMITS = { perStreamBytes: 64 << 20, totalBytes: 192 << 20, nesting: 4 } as const

/** PDF refusé avant sa lecture : trop lourd une fois décompressé, ou dans un format qui ne peut pas être contrôlé. */
export class PdfRefusedError extends Error {}

// Filtres de flux que pdf.js décode et dont la taille décodée n'est pas mesurée ici : LZW (jusqu'à environ 2 700 fois la
// taille compressée), RunLength, et les encodages ASCII qui peuvent envelopper un flux Deflate. Rares dans les PDF actuels.
const UNMEASURED_FILTER = /\/(?:LZWDecode|LZW|RunLengthDecode|RL|ASCII85Decode|A85|ASCIIHexDecode|AHx)\b/
// Filtre donné par une référence (« /Filter 7 0 R ») : son nom n'est pas lisible dans le dictionnaire.
const INDIRECT_FILTER = /\/Filter\s+\d+\s+\d+\s+R\b/
// En-tête zlib, comme pdf.js le vérifie : méthode Deflate (8), fenêtre de 32 Ko au plus, somme de contrôle de l'en-tête.
// Toutes les tailles de fenêtre : un flux à fenêtre réduite (0x68…) serait sinon décodé par pdf.js sans être mesuré.
const isZlib = (data: Buffer) => data.length >= 2 && (data[0] & 0x0f) === 8 && data[0] >> 4 <= 7 && ((data[0] << 8) | data[1]) % 31 === 0

/** Dictionnaire d'un flux : le texte entre le début de son objet (« n 0 obj ») et le mot « stream », 4 Ko au plus. */
function streamDictionary(buffer: Buffer, streamAt: number): string {
  const before = buffer.toString('latin1', Math.max(0, streamAt - 4096), streamAt)
  const objectAt = before.lastIndexOf(' obj')
  return objectAt >= 0 ? before.slice(objectAt) : before
}

/** Taille décompressée de `data` (0 si ce n'est pas du Deflate, ex. une image JPEG), couches successives comprises. */
async function inflatedSize(data: Buffer, cap: number, layersLeft: number): Promise<number> {
  if (!isZlib(data)) return 0
  if (layersLeft === 0) throw new PdfRefusedError('PDF refusé : trop de couches de compression.')
  let out: Buffer
  try {
    out = await inflateAsync(data, { maxOutputLength: cap })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new PdfRefusedError('PDF trop lourd une fois décompressé.')
    // Flux abîmé ou tronqué : pdf.js le refusera ou l'ignorera lui-même.
    return 0
  }
  // Flux compressé deux fois (/Filter [/FlateDecode /FlateDecode]) : la sortie est encore du Deflate.
  return Math.max(out.length, await inflatedSize(out, cap, layersLeft - 1))
}

/**
 * Lève PdfRefusedError si un flux du PDF se décompresse au-delà de `perStreamBytes`, si l'ensemble dépasse `totalBytes`,
 * ou si un flux emploie un filtre non mesuré. Ne lit que la structure du fichier, sans l'interpréter.
 */
export async function assertPdfInflateBounded(buffer: Buffer, limits: { perStreamBytes: number; totalBytes: number; nesting: number } = PDF_INFLATE_LIMITS): Promise<void> {
  // PDF chiffré : pdf.js le déchiffre seul (mot de passe vide) puis décompresse ; les flux chiffrés ne peuvent pas être
  // mesurés ici. Un « PDF protégé » est donc refusé (le message invite à l'enregistrer de nouveau).
  if (buffer.indexOf('/Encrypt', 0, 'latin1') >= 0) throw new PdfRefusedError('PDF protégé : enregistrez-le de nouveau sans protection.')
  let total = 0
  let from = 0
  for (;;) {
    const at = buffer.indexOf('stream', from, 'latin1')
    if (at < 0) return
    from = at + 6
    // « endstream » contient « stream » : seule l'ouverture d'un flux compte.
    if (at >= 3 && buffer.toString('latin1', at - 3, at) === 'end') continue
    // Le mot « stream » d'un flux est suivi d'une fin de ligne (CR LF ou LF).
    let start = at + 6
    if (buffer[start] === 0x0d) start++
    if (buffer[start] !== 0x0a && start === at + 6) continue
    if (buffer[start] === 0x0a) start++
    const end = buffer.indexOf('endstream', start, 'latin1')
    if (end < 0) return
    from = end + 9

    const dict = streamDictionary(buffer, at)
    if (UNMEASURED_FILTER.test(dict) || INDIRECT_FILTER.test(dict)) {
      throw new PdfRefusedError('PDF dans un format ancien ou inhabituel, non pris en charge.')
    }
    const remaining = limits.totalBytes - total
    const size = await inflatedSize(buffer.subarray(start, end), Math.min(limits.perStreamBytes, remaining), limits.nesting)
    total += size > 0 ? size : end - start
    if (total > limits.totalBytes) throw new PdfRefusedError('PDF trop lourd une fois décompressé.')
  }
}
