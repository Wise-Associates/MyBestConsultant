// Texte d'un CV tel que l'extraction du profil (cv-profile-extract.ts) l'envoie à l'IA, tiré des octets du fichier
// enregistré. Sans Appwrite ni IA : un script le reproduit sur un fichier (exemples d'affinage). Le type est lu dans les
// premiers octets du fichier, jamais dans son nom. Lecture propre à cette extraction, distincte d'extractTextFromFile
// (import-file-extract.ts : autres bornes, copies superposées des PDF retirées).

/** Au-delà, le texte du CV n'est pas envoyé à l'IA. */
export const CV_PROFILE_MAX_CHARS = 8000

/**
 * PDF (« %P ») : texte de pdf-parse, chaque suite de 3 blancs ou plus remplacée par un retour à la ligne ; '' s'il fait
 * 30 caractères ou moins (PDF scanné). DOCX (« PK ») : texte brut de mammoth. Autre : octets lus en UTF-8, caractères
 * hors ASCII imprimable et latin étendu remplacés par une espace ; '' s'il fait 50 caractères ou moins. Lève si pdf-parse
 * ou mammoth ne lisent pas le fichier : extractCvProfile n'a alors pas de profil.
 */
export async function cvProfileTextFromBuffer(buffer: Buffer): Promise<string> {
  const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50
  const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B

  if (isPdf) {
    if (typeof globalThis.DOMMatrix === 'undefined') {
      // pdf-parse (pdf.js) attend DOMMatrix, absent de Node : bouchon minimal.
      Object.assign(globalThis, { DOMMatrix: class DOMMatrix { constructor() { return this } } })
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fichier interne de pdf-parse (son index lit un PDF d'exemple au chargement), sans types
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
    const data = await pdfParse(buffer)
    const text = data.text.replace(/\s{3,}/g, '\n').trim()
    return text.length > 30 ? text.slice(0, CV_PROFILE_MAX_CHARS) : ''
  }

  if (isDocx) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value.slice(0, CV_PROFILE_MAX_CHARS).trim()
  }

  const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\tÀ-ɏ]/g, ' ').replace(/\s{3,}/g, '\n').trim()
  return text.length > 50 ? text.slice(0, CV_PROFILE_MAX_CHARS) : ''
}
