import type { AnonymizationMode, CvLang } from './types'

// Versions enregistrées de l'export au format ESN (ADR 0009, 0010) : une par organisation, candidat, anonymisation et
// langue (chaque organisation exporte dans son propre modèle), remplacée à chaque nouvelle génération et supprimée avec
// le compte du candidat. Règles pures, sans dépendance (la fenêtre d'export les
// importe aussi), testées dans stored.test.ts ; lecture et écriture dans store.ts.

/** Taille de l'attribut `notes` de la collection (scripts/setup-cv-export-storage.mjs). */
export const NOTES_MAX_LENGTH = 4000

/** Identifiant de document Appwrite : vérifié avant toute requête avec un identifiant reçu du navigateur. */
export const CANDIDATE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/

/**
 * Clé des versions d'un CV du vivier d'un recruteur, à la place de l'identifiant d'un candidat (attribut de 36
 * caractères). Le « : » la rend inaccessible aux routes des candidats (CANDIDATE_ID), qui ne vérifient pas qui a
 * importé le CV : seule la route du vivier, qui le vérifie, lit et écrit ces versions. null : identifiant invalide.
 */
export function vivierExportKey(cvId: string): string | null {
  const key = `vivier:${cvId}`
  return CANDIDATE_ID.test(cvId) && key.length <= 36 ? key : null
}

/**
 * Seul le recruteur qui a importé un CV du vivier l'exporte ou relit ses versions, comme seul il le voit dans son vivier
 * (ownVivierDoc, src/app/recruiter/vivier/actions.ts) : même organisation et même recruteur.
 */
export function ownsVivierCv(doc: { tenantId?: unknown; recruiterId?: unknown }, owner: { tenantId: string; userId: string }): boolean {
  return !!owner.tenantId && !!owner.userId && doc.tenantId === owner.tenantId && doc.recruiterId === owner.userId
}

export type LangChoice = 'both' | 'fr' | 'en'

export const LANGS_OF: Record<LangChoice, CvLang[]> = { both: ['fr', 'en'], fr: ['fr'], en: ['en'] }

export interface StoredCvExport {
  id: string
  /** Organisation qui a généré la version (« admin » : la plateforme) : seule elle la voit. */
  tenantId: string
  candidateId: string
  mode: AnonymizationMode
  lang: CvLang
  fileId: string
  fileName: string
  /** CV du candidat d'où vient cette version : s'il a été remplacé depuis, la version est ancienne. */
  sourceCvFileId: string
  notes: string[]
  generatedAt: string
}

/** Ce que la fenêtre d'export reçoit d'une version : ni fichier ni identifiant. */
export interface CvExportVersion {
  mode: AnonymizationMode
  lang: CvLang
  generatedAt: string
  /** Version dépassée : le candidat a remplacé son CV (« cv ») ou l'organisation son modèle (« template ») depuis. */
  stale: 'cv' | 'template' | null
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function parseNotes(raw: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(str(raw) || '[]')
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    // Écrit par serializeNotes, donc illisible seulement après une modification à la main : la version reste
    // téléchargeable, seul le rappel des champs à compléter manque.
    return []
  }
}

/** Document Appwrite → version enregistrée ; null si le document est incomplet (modifié à la main). */
export function parseStoredExport(doc: Record<string, unknown>): StoredCvExport | null {
  const { mode, lang } = doc
  if (mode !== 'standard' && mode !== 'renforcee') return null
  if (lang !== 'fr' && lang !== 'en') return null
  const [id, tenantId, candidateId, fileId, fileName, generatedAt] = [doc.$id, doc.tenantId, doc.candidateId, doc.fileId, doc.fileName, doc.generatedAt].map(str)
  if (!id || !tenantId || !candidateId || !fileId || !fileName || !generatedAt) return null
  return { id, tenantId, candidateId, mode, lang, fileId, fileName, sourceCvFileId: str(doc.sourceCvFileId), notes: parseNotes(doc.notes), generatedAt }
}

/** Compte rendu enregistré avec la version : les dernières remarques sont abandonnées si elles dépassent l'attribut. */
export function serializeNotes(notes: string[]): string {
  const kept = [...notes]
  while (kept.length > 0 && JSON.stringify(kept).length > NOTES_MAX_LENGTH) kept.pop()
  return JSON.stringify(kept)
}

/** Versions qui répondent à la demande, dans l'ordre des langues demandées ; null s'il en manque une. */
export function storedFor<T extends { mode: AnonymizationMode; lang: CvLang }>(versions: T[], mode: AnonymizationMode, langs: CvLang[]): T[] | null {
  const found = langs.map(lang => versions.find(v => v.mode === mode && v.lang === lang))
  return found.every((v): v is T => v !== undefined) ? found : null
}

/** `templateUploadedAt` : dépôt du modèle de l'organisation ; vide pour le modèle Wise Associates du dépôt (plateforme). */
export function versionView(stored: StoredCvExport, currentCvFileId: string, templateUploadedAt = ''): CvExportVersion {
  const stale = stored.sourceCvFileId !== currentCvFileId ? 'cv'
    : templateUploadedAt && Date.parse(stored.generatedAt) < Date.parse(templateUploadedAt) ? 'template'
      : null
  return { mode: stored.mode, lang: stored.lang, generatedAt: stored.generatedAt, stale }
}

/**
 * Choix proposé à l'ouverture de la fenêtre : celui de la version la plus récente (les deux langues si les deux sont
 * enregistrées pour son anonymisation), pour que « Télécharger » soit proposé d'emblée ; sinon français + anglais standard.
 */
export function initialChoice(versions: CvExportVersion[]): { langs: LangChoice; mode: AnonymizationMode } {
  const latest = [...versions].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
  if (!latest) return { langs: 'both', mode: 'standard' }
  return { langs: storedFor(versions, latest.mode, ['fr', 'en']) ? 'both' : latest.lang, mode: latest.mode }
}
