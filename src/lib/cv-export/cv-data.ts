import { z } from 'zod'
import type { CvData, CvLang, TemplateMap } from './types'

// Règles pures de l'export de CV au format ESN : validation des réponses de l'IA (donnée non fiable), identifiant,
// noms de fichiers, adaptation du contenu au template et compte rendu affiché à l'admin. Testées dans cv-data.test.ts.

export const TO_COMPLETE: Record<CvLang, string> = { fr: '[À COMPLÉTER]', en: '[TO BE COMPLETED]' }

// Caractères invisibles (zéro largeur, contrôle bidirectionnel, trait d'union conditionnel…) et de contrôle : ils
// cacheraient un nom ou un téléphone au contrôle des fuites, et un caractère de contrôle rend le .docx illisible.
const INVISIBLE = /[\p{Cf}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDFFF]/gu

export const stripInvisible = (s: string) => s.replace(INVISIBLE, '')
const clean = (v: string | number) => stripInvisible(String(v)).replace(/\s+/g, ' ').trim()

// Validation stricte : une rubrique d'un autre type que prévu (texte au lieu d'une liste, clé renommée…) fait refuser
// la réponse plutôt que disparaître du dossier. Aucune longueur maximale : la réponse entière est déjà bornée par
// maxTokens, et un texte coupé sans prévenir serait livré tel quel.
const scalar = z.union([z.string(), z.number()])
const requiredText = scalar.transform(clean)
const text = z.union([scalar, z.null()]).optional().transform(v => (v == null ? '' : clean(v)))
const textList = z.array(scalar).transform(list => list.map(clean).filter(Boolean))
const optionalTextList = textList.optional().transform(v => v ?? [])

const contentShape = {
  titre: requiredText,
  experience: requiredText,
  resume: textList,
  experiences: z.array(z.object({
    dates: text, client: text, role_lignes: optionalTextList, contexte: text, realisations: optionalTextList, environnement: text,
  })),
  formations: z.array(z.object({ annees: text, intitule: text, etablissement: text, details: optionalTextList })),
  certifications: z.array(z.object({ annee: text, intitule: text, organisme: text })),
  langues: z.array(z.object({ langue: text, niveau: text })),
  competences: z.array(z.object({ categorie: text, contenu: text })),
}

const ContentSchema = z.object(contentShape)
const ExtractionSchema = z.object({
  ...contentShape,
  langue: z.string().transform(v => v.trim().toLowerCase()).pipe(z.enum(['fr', 'en'])),
  termes_identifiants: textList,
  omis: textList,
})

/** Contenu d'une version du dossier, sans l'identifiant (calculé par le code, jamais par l'IA). */
export type CvContent = z.infer<typeof ContentSchema>
export type CvExtraction = z.infer<typeof ExtractionSchema>

/** Réponse coupée par la limite de longueur de l'IA : la redemander donnerait le même résultat. */
export class TruncatedAnswerError extends Error {}

/** Réponse de l'IA inutilisable (format, rubrique, traduction) : la redemander peut suffire. Message sans extrait du CV. */
export class InvalidAnswerError extends Error {}

function parseJsonObject(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0) throw new InvalidAnswerError('Réponse IA invalide : aucun objet JSON')
  try {
    if (end < start) throw new SyntaxError('objet non refermé')
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    // JSON illisible et réponse qui ne se termine pas par l'objet : elle a été coupée en cours de route.
    if (!/\}\s*(```)?\s*$/.test(raw.trim())) throw new TruncatedAnswerError('Réponse IA tronquée : CV trop long pour une seule réponse')
    // Pas le message de JSON.parse : il cite un extrait de la réponse, donc du CV, qui finirait dans les journaux.
    throw new InvalidAnswerError('Réponse IA invalide : JSON illisible')
  }
}

/** Rubrique en cause d'un échec de validation (clés et rangs seulement, jamais de valeur). */
function invalidPart(error: z.ZodError): string {
  const path = error.issues[0]?.path.map(String).join('.')
  return `Réponse IA invalide : format inattendu pour « ${path || 'la réponse'} »`
}

/** Réponse de l'extraction : contenu dans la langue du CV, termes d'identité retirés, contenus sans rubrique. */
export function parseExtraction(raw: string): CvExtraction {
  const parsed = ExtractionSchema.safeParse(parseJsonObject(raw))
  if (!parsed.success) throw new InvalidAnswerError(invalidPart(parsed.error))
  if (parsed.data.titre.length < 2) throw new InvalidAnswerError('Réponse IA invalide : intitulé du CV absent')
  // Un CV contient au moins le nom du candidat : une liste vide priverait le contrôle des fuites de ce que l'IA a retiré.
  if (parsed.data.termes_identifiants.length === 0) throw new InvalidAnswerError('Réponse IA invalide : termes d\'identité absents')
  return parsed.data
}

/**
 * Premier écart entre l'original et sa traduction (chemin « experiences.2.client »), ou null : mêmes listes de même
 * longueur, et chaque texte rempli dans l'original l'est aussi dans la traduction.
 */
export function structureGap(source: unknown, translated: unknown, path = ''): string | null {
  const at = (key: string | number) => (path ? `${path}.${key}` : String(key))
  if (Array.isArray(source)) {
    if (!Array.isArray(translated) || translated.length !== source.length) return path || 'la réponse'
    for (let i = 0; i < source.length; i++) {
      const gap = structureGap(source[i], translated[i], at(i))
      if (gap) return gap
    }
    return null
  }
  if (source !== null && typeof source === 'object') {
    if (translated === null || typeof translated !== 'object' || Array.isArray(translated)) return path || 'la réponse'
    for (const [key, value] of Object.entries(source)) {
      const gap = structureGap(value, (translated as Record<string, unknown>)[key], at(key))
      if (gap) return gap
    }
    return null
  }
  if (typeof source === 'string' && source !== '' && (typeof translated !== 'string' || translated === '')) return path
  return null
}

/**
 * Réponse de la traduction : même structure que l'original (structureGap) et réellement traduite. Une traduction qui
 * fusionne, vide ou supprime des éléments est refusée plutôt que livrée incomplète.
 */
export function parseTranslation(raw: string, source: CvContent): CvContent {
  const parsed = ContentSchema.safeParse(parseJsonObject(raw))
  if (!parsed.success) throw new InvalidAnswerError(invalidPart(parsed.error))
  const gap = structureGap(source, parsed.data)
  if (gap) throw new InvalidAnswerError(`Traduction incomplète : « ${gap} » manquant ou vide`)
  if (JSON.stringify(parsed.data) === JSON.stringify(source)) throw new InvalidAnswerError('Traduction absente : texte renvoyé identique à l\'original')
  return parsed.data
}

/** Contenu seul (sans langue, termes d'identité ni omissions), tel qu'envoyé à la traduction. */
export function contentOf(extraction: CvExtraction): CvContent {
  const { titre, experience, resume, experiences, formations, certifications, langues, competences } = extraction
  return { titre, experience, resume, experiences, formations, certifications, langues, competences }
}

/** Initiales « J.M. » (« Jean-Marc Dupont » → « J.M.D. ») ; sans nom connu, champ à compléter. */
export function initialsOf(firstName: string, lastName: string, lang: CvLang): string {
  const letters = `${firstName} ${lastName}`.split(/[\s\-'’.]+/).filter(Boolean).map(part => part[0].toUpperCase())
  return letters.length > 0 ? `${letters.join('.')}.` : TO_COMPLETE[lang]
}

/**
 * Contenu sans rubrique dans le template : les certifications rejoignent la formation quand le template n'a pas de
 * section dédiée (cas du template Wise Associates, « FORMATION – LANGUES »), plutôt que d'être perdues.
 */
export function fitToTemplate(data: CvData, map: TemplateMap): { data: CvData; certificationsMerged: boolean } {
  const sections = map.sections ?? []
  const hasSection = (key: string) => sections.length === 0 || sections.includes(key)
  if (data.certifications.length === 0 || hasSection('certifications') || !hasSection('education')) {
    return { data, certificationsMerged: false }
  }
  const asFormations = data.certifications.map(c => ({ annees: c.annee, intitule: c.intitule, etablissement: c.organisme, details: [] }))
  return { data: { ...data, formations: [...data.formations, ...asFormations], certifications: [] }, certificationsMerged: true }
}

/**
 * Nombre de champs restés à compléter (information attendue mais absente du CV), dans l'une ou l'autre langue : une
 * traduction peut avoir laissé « [À COMPLÉTER] » dans la version anglaise.
 */
export function countToComplete(data: CvData): number {
  const markers = Object.values(TO_COMPLETE)
  const count = (v: unknown): number =>
    typeof v === 'string' ? markers.reduce((n, marker) => n + v.split(marker).length - 1, 0)
      : Array.isArray(v) ? v.reduce((n: number, x) => n + count(x), 0)
        : v && typeof v === 'object' ? Object.values(v).reduce((n: number, x) => n + count(x), 0) : 0
  return count(data)
}

/** Compte rendu pour l'admin (fenêtre d'export), en français. */
export function exportNotes(input: { toComplete: number; omitted: string[]; certificationsMerged: boolean; cvTruncated: boolean }): string[] {
  const notes: string[] = []
  if (input.cvTruncated) {
    notes.push('CV très long : seul son début a été lu, les expériences les plus anciennes peuvent manquer. Comparez avec le CV d\'origine.')
  }
  if (input.toComplete > 0) {
    notes.push(`${input.toComplete} champ${input.toComplete > 1 ? 's' : ''} « [À COMPLÉTER] » : information absente du CV, à saisir dans Word.`)
  }
  if (input.certificationsMerged) notes.push('Certifications ajoutées à la rubrique Formation (le modèle n\'a pas de rubrique dédiée).')
  if (input.omitted.length > 0) notes.push(`Non repris faute de rubrique dans le modèle : ${input.omitted.join(' ; ')}.`)
  return notes
}

const slug = (s: string, max: number) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')

/** « CV_Wise-Associates_JM_Architecte-Data_FR » : nom de base des fichiers téléchargés (ASCII, sans espace). */
export function exportBaseName(esn: string, identifiant: string, titre: string): string {
  // Un champ « [À COMPLÉTER] » ne va pas dans un nom de fichier.
  const bare = (s: string) => s.replace(/\[[^\]]*\]/g, '')
  return ['CV', slug(esn, 40), slug(bare(identifiant), 12) || 'candidat', slug(bare(titre), 40)].filter(Boolean).join('_')
}

/** « CV_…_FR.docx » → « CV_….zip » : nom du .zip qui réunit les deux langues. */
export function zipNameOf(docxName: string): string {
  return `${docxName.replace(/(_(FR|EN))?\.docx$/i, '')}.zip`
}

export type CvFileKind = 'pdf' | 'docx' | 'doc'

/** Format du CV d'après ses premiers octets (le nom du fichier envoyé par le candidat n'est pas fiable). */
export function cvFileKind(bytes: Uint8Array): CvFileKind | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'pdf' // %PDF
  if (starts([0x50, 0x4b, 0x03, 0x04])) return 'docx' // archive zip (Office Open XML)
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc' // OLE2 (Word 97-2003)
  return null
}
