import { officeTextExtractor } from './office'
import { RetryLater, SkipAttachment, type Attachment, type AttachmentExtractor, type ExtractionContext } from './types'
import { visionExtractor } from './vision'

/** Ordre d'essai : la lecture locale (gratuite) d'abord, l'IA seulement si elle ne rend rien. */
export const DEFAULT_EXTRACTORS: AttachmentExtractor[] = [officeTextExtractor, visionExtractor]

export interface AttachmentsText {
  /** Texte lu, par pièce jointe (dans l'ordre de l'e-mail). */
  parts: { filename: string; text: string; via: string }[]
  /** Pièces jointes non lues, avec la raison. */
  skipped: string[]
}

export async function readAttachments(
  files: Attachment[],
  ctx: ExtractionContext,
  extractors: AttachmentExtractor[] = DEFAULT_EXTRACTORS,
): Promise<AttachmentsText> {
  const result: AttachmentsText = { parts: [], skipped: [] }
  for (const file of files) {
    const candidates = extractors.filter(e => e.canRead(file))
    if (!candidates.length) {
      result.skipped.push(`${file.filename} (format non lu)`)
      continue
    }
    let reason = 'aucun texte'
    let read = false
    for (const extractor of candidates) {
      try {
        const text = (await extractor.read(file, ctx)).trim()
        if (text) {
          result.parts.push({ filename: file.filename, text, via: extractor.name })
          read = true
          break
        }
      } catch (err) {
        // Échec passager : tout l'e-mail sera repris (sync.ts).
        if (err instanceof RetryLater) throw err
        if (err instanceof SkipAttachment) {
          reason = err.message
        } else {
          // Fichier corrompu ou erreur inattendue : le reste de l'e-mail est quand même lu.
          // Ni nom de fichier ni contenu dans les journaux (données personnelles possibles).
          console.error('AO: lecture de pièce jointe impossible', extractor.name, err instanceof Error ? err.message : String(err))
          reason = 'illisible'
        }
      }
    }
    if (!read) result.skipped.push(`${file.filename} (${reason})`)
  }
  return result
}
