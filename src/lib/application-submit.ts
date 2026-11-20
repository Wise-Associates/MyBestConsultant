// Candidature à une offre depuis sa page publique (fenêtre « Postuler », route /api/apply) : règles pures, partagées par
// le navigateur (contrôles avant l'envoi, message affiché) et le serveur (mêmes contrôles, offre ouverte). Testé dans
// application-submit.test.ts.
//
// Échecs reproduits sur DEV le 2026-11-20 : offres partagées de la plateforme (tenantId '') refusées, images et fichiers
// sans extension refusés par le bucket après coup, messages d'Appwrite en anglais, réponse sans JSON (corps trop lourd
// coupé par le proxy) affichée comme une erreur de code.

/** Extensions acceptées par le bucket des CV (`cvs`, appwrite.config.json), pour le CV comme pour les pièces jointes. */
export const APPLY_EXTENSIONS = ['pdf', 'doc', 'docx'] as const
/** Valeur de l'attribut `accept` des champs de fichier. */
export const APPLY_ACCEPT = APPLY_EXTENSIONS.map(e => `.${e}`).join(',')
/** Taille maximale d'un fichier : celle du bucket `cvs` (10 Mo). */
export const APPLY_MAX_FILE_BYTES = 10 * 1024 * 1024
/**
 * Taille maximale de l'envoi complet : Caddy coupe à 12 Mo (deploy/caddy/Caddyfile) ; la marge couvre le message et
 * l'enveloppe multipart.
 */
export const APPLY_MAX_TOTAL_BYTES = 11 * 1024 * 1024
export const APPLY_MAX_DOCS = 5
export const APPLY_MAX_LETTER = 2500

export interface FileLike {
  name: string
  size: number
}

const MB = 1024 * 1024
const megabytes = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} Mo`.replace('.', ',')

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Problème d'un fichier (CV ou pièce jointe), dans les termes du candidat ; null s'il peut être envoyé. */
export function fileProblem(file: FileLike, label: 'Le CV' | 'Le document'): string | null {
  const ext = extensionOf(file.name)
  if (!(APPLY_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext
      ? `${label} « ${file.name} » n’est pas au bon format : PDF, DOC ou DOCX seulement.`
      : `${label} « ${file.name} » n’a pas d’extension : enregistrez-le en PDF, DOC ou DOCX, puis ajoutez-le de nouveau.`
  }
  if (file.size === 0) return `${label} « ${file.name} » est vide.`
  if (file.size > APPLY_MAX_FILE_BYTES) {
    return `${label} « ${file.name} » pèse ${megabytes(file.size)} : 10 Mo au plus par fichier.`
  }
  return null
}

/** Premier problème de l'ensemble des fichiers envoyés (CV éventuel et pièces jointes) ; null si tout peut partir. */
export function filesProblem(cv: FileLike | null, docs: FileLike[]): string | null {
  if (docs.length > APPLY_MAX_DOCS) return `${APPLY_MAX_DOCS} documents complémentaires au plus.`
  const each = (cv ? fileProblem(cv, 'Le CV') : null) ?? docs.map(d => fileProblem(d, 'Le document')).find(Boolean) ?? null
  if (each) return each
  const total = (cv?.size ?? 0) + docs.reduce((sum, d) => sum + d.size, 0)
  if (total > APPLY_MAX_TOTAL_BYTES) {
    return `Vos fichiers pèsent ${megabytes(total)} ensemble : 11 Mo au plus. Retirez un document ou réduisez la taille du CV.`
  }
  return null
}

export type ApplyRefusal = 'introuvable' | 'fermee'

/** L'offre peut-elle recevoir une candidature ? Elle doit exister, être active et ne pas avoir expiré. */
export function applyRefusal(job: { isActive: boolean; expiresAt?: string } | null, now: Date): ApplyRefusal | null {
  if (!job) return 'introuvable'
  if (!job.isActive) return 'fermee'
  if (job.expiresAt && Date.parse(job.expiresAt) <= now.getTime()) return 'fermee'
  return null
}

export const APPLY_REFUSAL_MESSAGE: Record<ApplyRefusal, string> = {
  introuvable: 'Cette offre n’existe plus.',
  fermee: 'Cette offre n’accepte plus de candidatures.',
}

/** Message d'une erreur d'envoi d'Appwrite (type de l'erreur), jamais son texte anglais. */
export function storageErrorMessage(type: unknown): string | null {
  if (type === 'storage_file_type_unsupported') return 'Un fichier n’est pas au bon format : PDF, DOC ou DOCX seulement.'
  if (type === 'storage_invalid_file_size') return 'Un fichier dépasse 10 Mo.'
  return null
}

export const APPLY_SESSION_EXPIRED = 'Votre session a expiré. Reconnectez-vous pour envoyer votre candidature.'
export const APPLY_GENERIC_ERROR = 'Votre candidature n’a pas pu être envoyée. Réessayez dans un instant ; si cela continue, contactez le support.'

/**
 * Message à afficher pour une réponse en échec de /api/apply. Le corps peut ne pas être du JSON : un envoi trop lourd est
 * coupé par le proxy (413, corps vide ou HTML), un serveur indisponible renvoie une page d'erreur.
 */
export function applyErrorMessage(status: number, bodyText: string): string {
  if (status === 401) return APPLY_SESSION_EXPIRED
  if (status === 413) return 'Vos fichiers sont trop lourds pour être envoyés : 11 Mo au plus en tout.'
  try {
    const parsed: unknown = JSON.parse(bodyText)
    const error = (parsed as { error?: unknown } | null)?.error
    if (typeof error === 'string' && error.trim()) return error
  } catch {
    // Corps sans JSON (page d'erreur du proxy) : message général ci-dessous.
  }
  return APPLY_GENERIC_ERROR
}
