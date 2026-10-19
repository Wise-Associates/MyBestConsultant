// Lecture des pièces jointes des appels d'offres : une chaîne d'extracteurs, essayés dans l'ordre pour
// chaque fichier (le premier qui rend du texte l'emporte). Ajouter un format = ajouter un extracteur
// dans DEFAULT_EXTRACTORS (chain.ts), sans toucher au reste du traitement.

export interface Attachment {
  filename: string
  /** Type MIME annoncé par l'expéditeur : sert à reconnaître le format quand le nom n'a pas d'extension. */
  contentType: string
  content: Buffer
}

export interface ExtractionContext {
  /** Heure (ms epoch) au-delà de laquelle aucune lecture coûteuse ne doit commencer. */
  deadline: number
  /** true si l'e-mail peut être repris au passage suivant (il n'est pas le premier du passage). */
  canDefer: boolean
  /** Réserve une lecture par l'IA (limites par e-mail et par jour) ; false si le budget est épuisé. */
  reserveVisionCall(): Promise<boolean>
}

/** Fichier volontairement non lu, avec la raison affichée à l'admin (format, taille, configuration…). */
export class SkipAttachment extends Error {}

/**
 * Lecture impossible pour l'instant (service IA saturé, délai dépassé…) : tout l'e-mail est repris à un
 * passage suivant. `countsAsAttempt` : false si l'e-mail n'y est pour rien (manque de temps dans ce passage).
 */
export class RetryLater extends Error {
  constructor(message: string, readonly countsAsAttempt = true) {
    super(message)
  }
}

export interface AttachmentExtractor {
  /** Nom court, pour le diagnostic. */
  readonly name: string
  /** Le format du fichier relève de cet extracteur (sans le lire). */
  canRead(file: Attachment): boolean
  /** Texte du fichier ; '' si rien de lisible (l'extracteur suivant est essayé) ; SkipAttachment pour l'écarter. */
  read(file: Attachment, ctx: ExtractionContext): Promise<string>
}

const FORMAT_OF_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'text/csv': 'csv',
  'text/plain': 'txt',
}

/** Format du fichier : son extension, sinon celui de son type MIME ('' si inconnu). */
export function formatOf(file: Pick<Attachment, 'filename' | 'contentType'>): string {
  const ext = file.filename.includes('.') ? file.filename.split('.').pop()?.toLowerCase() ?? '' : ''
  return ext || FORMAT_OF_MIME[file.contentType.toLowerCase().split(';')[0].trim()] || ''
}
