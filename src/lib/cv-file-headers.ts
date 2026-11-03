// En-têtes d'un CV servi sur l'origine du site (/api/cv, /api/vivier-cv). Le fichier vient d'un candidat ou d'un
// recruteur, et le bucket ne vérifie que l'extension : une page HTML renommée « cv.pdf », servie avec le type
// enregistré et affichée dans le navigateur, exécuterait ses scripts avec la session du recruteur qui l'ouvre. Le type
// est donc lu dans les premiers octets du fichier ; seul un vrai PDF s'affiche, le reste se télécharge. Testé dans
// cv-file-headers.test.ts.

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b)

function typeOf(bytes: Uint8Array): { contentType: string; inline: boolean } {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { contentType: 'application/pdf', inline: true } // %PDF
  // Archive zip : un .docx (le seul format zip accepté par les buckets de CV).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { contentType: 'application/msword', inline: false } // .doc
  return { contentType: 'application/octet-stream', inline: false }
}

export function cvFileHeaders(bytes: Uint8Array, name: string): Record<string, string> {
  const { contentType, inline } = typeOf(bytes)
  // Nom ASCII de repli sans guillemet ni retour à la ligne (en-tête), nom exact en UTF-8 pour les navigateurs récents.
  const ascii = name.replace(/[^A-Za-z0-9._-]/g, '_')
  return {
    'Content-Type': contentType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    // Pas de sandbox pour un PDF : le lecteur de PDF du navigateur ne s'ouvrirait plus.
    ...(inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
    'Cache-Control': 'private, max-age=300',
  }
}
