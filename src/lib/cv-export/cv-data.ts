import { z } from 'zod'
import type { CvData, CvLang, TemplateMap } from './types'

// Règles pures de l'export de CV au format ESN : validation des réponses de l'IA (donnée non fiable), identifiant,
// noms de fichiers, adaptation du contenu au template et compte rendu affiché à l'admin. Testées dans cv-data.test.ts.

export const TO_COMPLETE: Record<CvLang, string> = { fr: '[À COMPLÉTER]', en: '[TO BE COMPLETED]' }

// Caractères invisibles (zéro largeur, contrôle bidirectionnel, trait d'union conditionnel…) et de contrôle : ils
// cacheraient un nom ou un téléphone au contrôle des fuites, et un caractère de contrôle rend le .docx illisible.
const INVISIBLE = /[\p{Cf}]|[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDFFF]/gu

export const stripInvisible = (s: string) => s.replace(INVISIBLE, '')

// Sous-titre parmi les réalisations d'une expérience (« Pilotage budgétaire et portefeuille » au-dessus de ses puces,
// demande du 2026-11-12 : rien du CV ne se perd) : l'IA le recopie comme un élément précédé de « ## » (prompt.ts), le
// rendu l'affiche sans puce et en gras (render.ts).
const SUBHEADING_MARK = /^##\s*/
export const subheadingText = (text: string) => text.replace(SUBHEADING_MARK, '')
export const isSubheading = (text: string) => SUBHEADING_MARK.test(text) && subheadingText(text) !== ''
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
  return { ...parsed.data, competences: groupRepeatedSkills(parsed.data.competences, parsed.data.langue) }
}

// « Libellé : suite » en tête d'une ligne de compétences (libellé de 80 caractères au plus, sans « : »).
const OWN_LABEL = /^([^:]{2,80}?)\s*:\s+(\S.*)$/
const SKILL_SEPARATOR: Record<CvLang, string> = { fr: ' ; ', en: '; ' }

/**
 * Compétences sans libellé répété (demande du 2026-11-03 : « IT & FINANCE CERTIFICATIONS : » devant chacune de trois
 * lignes). Des éléments qui se suivent avec la même "categorie" (le titre de leur rubrique) prennent chacun le libellé
 * qui ouvre leur texte (« Finance & Risk: … ») s'ils en ont tous un ; sinon ils ne font qu'un élément, textes séparés
 * par « ; ». Le texte lui-même n'est pas modifié.
 */
export function groupRepeatedSkills(skills: CvContent['competences'], lang: CvLang): CvContent['competences'] {
  const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const out: CvContent['competences'] = []
  for (let i = 0; i < skills.length;) {
    let end = i + 1
    while (skills[i].categorie && end < skills.length && key(skills[end].categorie) === key(skills[i].categorie)) end++
    const run = skills.slice(i, end)
    const labelled = run.map(s => OWN_LABEL.exec(s.contenu))
    if (run.length === 1) out.push(run[0])
    else if (labelled.every((m): m is RegExpExecArray => m !== null)) out.push(...labelled.map(m => ({ categorie: m[1].trim(), contenu: m[2] })))
    else out.push({ categorie: run[0].categorie, contenu: run.map(s => s.contenu).filter(Boolean).join(SKILL_SEPARATOR[lang]) })
    i = end
  }
  return out
}

// Mots-outils propres à chaque langue (absents de l'autre : ni « on » ni « an ») : un texte qui en contient plusieurs
// est écrit dans cette langue.
const FUNCTION_WORDS: Record<CvLang, ReadonlySet<string>> = {
  fr: new Set(['le', 'la', 'les', 'des', 'du', 'de', 'et', 'pour', 'avec', 'dans', 'sur', 'une', 'aux', 'par', 'est', 'sont', 'ces', 'leur', 'leurs']),
  en: new Set(['the', 'and', 'of', 'with', 'for', 'to', 'in', 'by', 'from', 'is', 'are', 'its', 'their', 'this', 'that', 'across', 'through']),
}
// Noms, outils, dates et niveaux : gardés tels quels d'une langue à l'autre, ils ne disent rien de la langue du texte.
const NAME_KEYS = new Set(['client', 'etablissement', 'organisme', 'intitule', 'environnement', 'dates', 'annees', 'annee', 'langue', 'niveau'])

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)

/** Textes rédigés d'un contenu (ni noms, ni outils, ni dates), avec leur chemin (« experiences.0.realisations.2 »). */
function proseOf(value: unknown, path = '', key = ''): [string, string][] {
  if (typeof value === 'string') return NAME_KEYS.has(key) ? [] : [[path, value]]
  if (Array.isArray(value)) return value.flatMap((v, i) => proseOf(v, `${path}.${i}`, key))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => proseOf(v, path ? `${path}.${k}` : k, k))
  return []
}

/**
 * Langue du CV d'après ses phrases, ou null si elles ne tranchent pas. Décide de ce qui est traduit, à la place de la
 * langue annoncée par l'IA : un CV anglais annoncé « fr » sortait non traduit en français.
 */
export function dominantLang(content: CvContent): CvLang | null {
  const prose = proseOf(content)
  const count = (lang: CvLang) => prose.reduce((n, [, text]) => n + wordsOf(text).filter(w => FUNCTION_WORDS[lang].has(w)).length, 0)
  const fr = count('fr')
  const en = count('en')
  if (fr >= 10 && fr >= 2 * en) return 'fr'
  if (en >= 10 && en >= 2 * fr) return 'en'
  return null
}

/** Au moins 6 mots, dont 3 mots-outils différents de cette langue : une phrase écrite dans cette langue. */
function readsAs(text: string, lang: CvLang): boolean {
  const words = wordsOf(text)
  return words.length >= 6 && new Set(words.filter(w => FUNCTION_WORDS[lang].has(w))).size >= 3
}

/**
 * Phrases que la traduction a rendues telles quelles, encore dans la langue du CV : signalées dans le compte rendu.
 * Les noms, sigles et intitulés de certification, gardés à juste titre, ne comptent pas.
 */
export function untranslatedCount(source: CvContent, translated: CvContent, sourceLang: CvLang): number {
  const after = new Map(proseOf(translated))
  return proseOf(source).filter(([path, text]) => after.get(path) === text && readsAs(text, sourceLang)).length
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
  return withSourceSubheadings(parsed.data, source)
}

/** Sous-titres de la traduction repris de l'original, élément par élément : un « ## » perdu ou ajouté par l'IA est corrigé. */
function withSourceSubheadings(translated: CvContent, source: CvContent): CvContent {
  return {
    ...translated,
    experiences: translated.experiences.map((exp, i) => ({
      ...exp,
      realisations: exp.realisations.map((text, j) => (isSubheading(source.experiences[i].realisations[j]) ? `## ${subheadingText(text)}` : subheadingText(text))),
    })),
  }
}

// Seuil du compte rendu : une copie fidèle reprend 98 % des mots du CV (identité, libellés « Réalisations : » et titres
// de rubrique retirés), le dossier du 2026-11-12, qui avait perdu trois expériences et la moitié des puces, 31 %.
export const MIN_CONTENT_COVERAGE = 0.9

// Mots de 3 caractères ou plus, sans casse ni accents : ni les mots-outils courts, ni les lettres des titres espacés
// (« S K I L L S »), que l'IA recopie attachées.
const coverageWords = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3)

const stringsOf = (value: unknown): string[] =>
  typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(stringsOf)
      : value !== null && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : []

/**
 * Part des mots du CV retrouvés dans le dossier (0 à 1), chaque occurrence comptée : le dossier recopie le CV mot pour
 * mot (ADR 0024), un écart signale un passage perdu par l'IA, qui sinon passerait inaperçu.
 */
export function contentCoverage(cvText: string, content: CvContent): number {
  const available = new Map<string, number>()
  for (const word of coverageWords(stringsOf(content).join(' '))) available.set(word, (available.get(word) ?? 0) + 1)
  const words = coverageWords(cvText)
  if (words.length === 0) return 1
  let found = 0
  for (const word of words) {
    const left = available.get(word) ?? 0
    if (left > 0) {
      found++
      available.set(word, left - 1)
    }
  }
  return found / words.length
}

/** Contenu seul (sans langue, termes d'identité ni omissions), tel qu'envoyé à la traduction. */
export function contentOf(extraction: CvExtraction): CvContent {
  const { titre, experience, resume, experiences, formations, certifications, langues, competences } = extraction
  return { titre, experience, resume, experiences, formations, certifications, langues, competences }
}

/**
 * Nom complet d'un CV du vivier (lu par l'IA à l'import, sans prénom ni nom séparés) : le dernier mot pour nom, le reste
 * pour prénom. Le contrôle des fuites cherche chacun seul : « Dupont » reste détecté dans « Jean Pierre Dupont ».
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  return words.length < 2 ? { firstName: words[0] ?? '', lastName: '' } : { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] }
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
export function exportNotes(input: {
  toComplete: number; omitted: string[]; certificationsMerged: boolean; cvTruncated: boolean; untranslated: { lang: CvLang; count: number }[]
  /** contentCoverage du dossier dans la langue du CV. */
  coverage: number
}): string[] {
  const notes: string[] = []
  if (input.cvTruncated) {
    notes.push('CV très long : seul son début a été lu, les expériences les plus anciennes peuvent manquer. Comparez avec le CV d\'origine.')
  }
  if (input.coverage < MIN_CONTENT_COVERAGE) {
    // Arrondi vers le bas : 89,6 % ne s'affiche pas « 90 % », sous le seuil.
    notes.push(`Le dossier ne reprend qu'environ ${Math.floor(input.coverage * 100)} % du texte du CV : des passages manquent. Comparez-le avec le CV d'origine, ou générez une nouvelle version.`)
  }
  if (input.toComplete > 0) {
    notes.push(`${input.toComplete} champ${input.toComplete > 1 ? 's' : ''} « [À COMPLÉTER] » : information absente du CV, à saisir dans Word.`)
  }
  for (const { lang, count } of input.untranslated) {
    const s = count > 1 ? 's' : ''
    notes.push(`Version ${lang === 'en' ? 'anglaise' : 'française'} : ${count} passage${s} resté${s} en ${lang === 'en' ? 'français' : 'anglais'}, à traduire dans Word.`)
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
