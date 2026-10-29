import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { AppwriteException } from 'node-appwrite'
import { zipSync } from 'fflate'
import { callLLM, LLMHttpError, LLMNotConfiguredError, LLMUnreachableError } from '@/lib/ai/llm-router'
import { claudeProblem, openAiProblem, type AiProblem } from '@/lib/ao/ai-failures'
import { createAdminClient } from '@/lib/appwrite/client'
import { BUCKETS, COLLECTIONS, DB_ID } from '@/lib/appwrite/config'
import { extractTextFromFile } from '@/lib/import-file-extract'
import {
  InvalidAnswerError, TruncatedAnswerError, contentOf, countToComplete, cvFileKind, exportBaseName, exportNotes, fitToTemplate,
  initialsOf, parseExtraction, parseTranslation, splitFullName, zipNameOf, type CvContent,
} from './cv-data'
import { findLeaks, identityTerms, leakMessage } from './leak-check'
import { extractionPrompt, translationPrompt } from './prompt'
import { renderCv } from './render'
import { ownsVivierCv } from './stored'
import type { EsnTemplate } from './templates'
import type { AnonymizationMode, CvLang } from './types'

// Export d'un candidat d'une CV Thèque, ou d'un CV du vivier d'un recruteur (ADR 0016), au format de l'ESN (ADR 0009,
// 0010) : CV lu dans le stockage, extrait et
// anonymisé par l'IA (ligne « Export CV » de Config IA, sans repli), traduit si besoin, rendu dans le modèle de
// l'organisation qui exporte (templates.ts), contrôlé (aucune donnée d'identité restante) puis livré. La route
// enregistre ensuite les fichiers (store.ts) pour qu'ils soient retéléchargés sans nouvel appel d'IA.

// Budget de la route (maxDuration = 300 s) : extraction, puis traduction si l'autre langue est demandée, le tout fini
// 265 s après le début pour laisser à la route le temps d'enregistrer la version (route.ts, SAVE_DEADLINE_MS).
const EXTRACTION_TIMEOUT_MS = 140_000
const TRANSLATION_TIMEOUT_MS = 120_000
const AI_DEADLINE_MS = 265_000
// En dessous, la traduction n'a aucune chance d'aboutir : inutile de la payer.
const MIN_TRANSLATION_MS = 30_000
// Un CV complet en JSON dépasse les 4 096 jetons par défaut de callLLM.
const MAX_ANSWER_TOKENS = 16_000
// Au-delà, le CV est coupé : 40 000 caractères couvrent un CV d'une dizaine de pages.
const MAX_CV_CHARS = 40_000
// En dessous, le PDF n'a pas de couche texte (scan, photo).
const MIN_CV_CHARS = 200

const LANG_SUFFIX: Record<CvLang, string> = { fr: 'FR', en: 'EN' }
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Échec à montrer tel quel à l'admin (message en français), avec le statut HTTP de la route. */
export class CvExportError extends Error {
  constructor(message: string, readonly status: number, options?: { cause?: unknown }) {
    super(message, options)
  }
}

export interface CvExportOptions {
  langs: CvLang[]
  mode: AnonymizationMode
}

/** Dossier d'une langue, tel que rendu et contrôlé. */
export interface CvExportDocx {
  lang: CvLang
  fileName: string
  bytes: Uint8Array
}

export interface CvExportResult {
  files: CvExportDocx[]
  notes: string[]
  /** CV lu pour cette génération : une version enregistrée tirée d'un CV remplacé depuis est signalée comme ancienne. */
  sourceCvFileId: string
}

/** Fichier livré à l'admin. */
export interface CvExportFile {
  fileName: string
  contentType: string
  bytes: Uint8Array
}

/** Personne dont le CV est exporté : candidat de la plateforme, ou CV du vivier d'un recruteur. */
interface Candidate {
  firstName: string
  lastName: string
  email: string
  phone: string
  cvFileId: string
  /** Bucket du fichier : celui des candidats, ou celui du vivier. */
  bucket: string
}

async function loadCandidate(candidateId: string): Promise<Candidate> {
  const { databases } = createAdminClient()
  let doc: Record<string, unknown>
  try {
    doc = await databases.getDocument(DB_ID, COLLECTIONS.USERS, candidateId)
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) throw new CvExportError('Candidat introuvable.', 404)
    throw err
  }
  // Même périmètre que la CV Thèque admin : les candidats de la plateforme, pas les autres comptes.
  if (doc.role !== 'candidate') throw new CvExportError('Candidat introuvable.', 404)
  const cvFileId = typeof doc.cvFileId === 'string' ? doc.cvFileId : ''
  if (!cvFileId) throw new CvExportError('Ce candidat n\'a pas de CV.', 404)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return { firstName: str(doc.firstName), lastName: str(doc.lastName), email: str(doc.email), phone: str(doc.phone), cvFileId, bucket: BUCKETS.CVS }
}

/** Recruteur qui exporte un CV de son vivier : organisation et compte lus dans la session. */
export interface VivierOwner {
  tenantId: string
  userId: string
}

/**
 * CV du vivier d'un recruteur : seul celui qui l'a importé l'exporte, comme seul il le voit dans son vivier
 * (ownVivierDoc, src/app/recruiter/vivier/actions.ts). Le CV d'un autre est « introuvable », comme s'il n'existait pas.
 */
export async function loadOwnVivierCv(cvId: string, owner: VivierOwner): Promise<Candidate> {
  const { databases } = createAdminClient()
  let doc: Record<string, unknown>
  try {
    doc = await databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, cvId)
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) throw new CvExportError('CV introuvable.', 404)
    throw err
  }
  if (!ownsVivierCv(doc, owner)) throw new CvExportError('CV introuvable.', 404)
  const cvFileId = typeof doc.cvFileId === 'string' ? doc.cvFileId : ''
  if (!cvFileId) throw new CvExportError('Ce profil n\'a pas de fichier CV.', 404)
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return { ...splitFullName(str(doc.candidateName)), email: str(doc.candidateEmail), phone: str(doc.candidatePhone), cvFileId, bucket: BUCKETS.VIVIER_CVS }
}

/** CV du vivier encore présent : supprimé pendant une génération, sa version n'est pas gardée (saveCvExports). */
export async function vivierCvExists(cvId: string): Promise<boolean> {
  try {
    await createAdminClient().databases.getDocument(DB_ID, COLLECTIONS.VIVIER_CVS, cvId)
    return true
  } catch (err) {
    if (err instanceof AppwriteException && err.type === 'document_not_found') return false
    throw err
  }
}

async function readCvText(logId: string, bucket: string, cvFileId: string): Promise<{ text: string; truncated: boolean }> {
  const { storage } = createAdminClient()
  let bytes: ArrayBuffer
  try {
    bytes = await storage.getFileDownload(bucket, cvFileId)
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) throw new CvExportError('Le fichier du CV est introuvable dans le stockage.', 404)
    throw err
  }
  const buffer = Buffer.from(bytes)
  const kind = cvFileKind(buffer)
  if (!kind) throw new CvExportError('Format du CV non pris en charge : PDF, DOCX ou DOC attendu.', 422)
  let text: string
  try {
    // Lecture stricte : un fichier illisible lève une erreur au lieu de renvoyer ses octets bruts, qui partiraient à
    // l'IA. Un caractère de plus que la limite pour savoir si le CV a été coupé.
    text = await extractTextFromFile(buffer, `cv.${kind}`, { maxChars: MAX_CV_CHARS + 1, strict: true })
  } catch (err) {
    console.warn('[cv-export] CV illisible', logId, kind, err instanceof Error ? err.constructor.name : typeof err)
    throw new CvExportError('Le CV n\'a pas pu être lu (fichier protégé par mot de passe, abîmé, ou d\'un autre format que PDF / Word) : demandez une autre version au candidat.', 422, { cause: err })
  }
  if (text.replace(/\s/g, '').length < MIN_CV_CHARS) {
    throw new CvExportError('Le CV ne contient pas de texte lisible (document scanné ?) : demandez au candidat une version PDF texte ou Word.', 422)
  }
  return { text: text.slice(0, MAX_CV_CHARS), truncated: text.length > MAX_CV_CHARS }
}

const PROBLEM_MESSAGE: Record<AiProblem, string> = {
  credits: 'Crédits épuisés chez le fournisseur d\'IA : rechargez-les, ou choisissez un autre modèle pour « Export CV (format cabinet) » dans Config IA.',
  access: 'Clé d\'API refusée par le fournisseur d\'IA : vérifiez-la dans Config IA.',
  model: 'Modèle d\'IA introuvable ou non autorisé : choisissez-en un autre pour « Export CV (format cabinet) » dans Config IA.',
  config: 'IA non configurée pour « Export CV (format cabinet) » : voir Config IA.',
  outage: 'Service d\'IA saturé ou indisponible : réessayez dans quelques minutes.',
}

/** Échec de l'IA traduit pour l'admin ; null si l'erreur ne vient pas de l'appel au modèle. */
function aiFailure(err: unknown): CvExportError | null {
  const options = { cause: err }
  if (err instanceof LLMNotConfiguredError) {
    return new CvExportError(`IA non configurée pour « Export CV (format cabinet) » : ${err.message}`, 503, options)
  }
  if (err instanceof LLMUnreachableError || err instanceof Anthropic.APIConnectionError) {
    const timedOut = err instanceof LLMUnreachableError ? err.timedOut : err instanceof Anthropic.APIConnectionTimeoutError
    return new CvExportError(timedOut
      ? 'L\'IA n\'a pas répondu à temps. Réessayez ; si cela se répète, choisissez un modèle plus rapide pour « Export CV » dans Config IA.'
      : 'Service IA injoignable. Réessayez dans quelques minutes.', 504, options)
  }
  if (err instanceof Anthropic.APIError || err instanceof LLMHttpError) {
    // Crédits, clé, modèle, panne : chacun son action ; un autre refus (souvent une réponse demandée trop longue pour ce
    // modèle) ne se règle pas en réessayant.
    const problem = err instanceof LLMHttpError ? openAiProblem(err.status, err.body) : claudeProblem(err)
    return new CvExportError(problem ? PROBLEM_MESSAGE[problem]
      : `Requête refusée par le modèle d'IA (erreur ${err.status ?? 'inconnue'}) : la réponse demandée est peut-être trop longue pour ce modèle. Choisissez-en un autre pour « Export CV (format cabinet) » dans Config IA.`, 502, options)
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Levée par le SDK avant tout envoi, par exemple pour un ancien modèle qui exige la diffusion progressive au-delà de 8 192 jetons.
    return new CvExportError('Le modèle Claude choisi ne peut pas produire une réponse aussi longue : choisissez un modèle récent (Claude Sonnet) pour « Export CV (format cabinet) » dans Config IA.', 502, options)
  }
  if (err instanceof TruncatedAnswerError) {
    return new CvExportError('CV trop long pour une seule réponse de l\'IA : condensez-le ou exportez-le en une seule langue.', 422, options)
  }
  return null
}

async function askModel<T>(system: string, content: string, timeoutMs: number, parse: (raw: string) => T): Promise<T> {
  try {
    const answer = await callLLM([{ role: 'user', content }], system, {
      module: 'cvExport', strict: true, maxTokens: MAX_ANSWER_TOKENS, timeoutMs,
    })
    return parse(answer.content)
  } catch (err) {
    const failure = aiFailure(err)
    if (failure) throw failure
    if (err instanceof InvalidAnswerError) throw new CvExportError(`${err.message}. Réessayez.`, 502, { cause: err })
    throw err
  }
}

/**
 * Dossier de compétences anonymisé d'un candidat, dans le modèle de l'organisation : un .docx par langue demandée.
 * `beforeAi` s'exécute juste avant le premier appel d'IA (quota du jour) : un CV introuvable ou illisible ne le consomme pas.
 */
export async function exportCandidateCv(candidateId: string, options: CvExportOptions, template: EsnTemplate, beforeAi?: () => Promise<void>): Promise<CvExportResult> {
  return exportCv(candidateId, await loadCandidate(candidateId), options, template, beforeAi)
}

/** Même dossier pour un CV du vivier de `owner` (vérifié : seul celui qui l'a importé l'exporte). */
export async function exportVivierCv(cvId: string, owner: VivierOwner, options: CvExportOptions, template: EsnTemplate, beforeAi?: () => Promise<void>): Promise<CvExportResult> {
  const cv = await loadOwnVivierCv(cvId, owner)
  // Sans nom connu, seule l'IA qui rédige le dossier dirait quel nom retirer : le contrôle des fuites, qui cherche le
  // nom indépendamment d'elle, n'aurait rien à chercher. Refusé avant le quota et l'IA.
  if (!cv.firstName && !cv.lastName) {
    throw new CvExportError('Nom du candidat inconnu pour ce CV (profil non créé ou nom non lu) : l\'anonymisation ne peut pas être vérifiée. Relancez l\'analyse du CV, ou ajoutez-le à la CV Thèque.', 422)
  }
  return exportCv(cvId, cv, options, template, beforeAi)
}

/** `logId` : identifiant du candidat ou du CV du vivier, dans les journaux seulement. */
async function exportCv(logId: string, candidate: Candidate, options: CvExportOptions, template: EsnTemplate, beforeAi?: () => Promise<void>): Promise<CvExportResult> {
  const deadline = Date.now() + AI_DEADLINE_MS
  const cv = await readCvText(logId, candidate.bucket, candidate.cvFileId)

  await beforeAi?.()
  const cutNotice = cv.truncated ? 'Le CV est trop long : sa fin manque ci-dessous. N\'invente rien pour la compléter.\n' : ''
  const extraction = await askModel(extractionPrompt(options.mode), `${cutNotice}<cv>\n${cv.text}\n</cv>`,
    Math.min(EXTRACTION_TIMEOUT_MS, deadline - Date.now()), parseExtraction)
  const source = contentOf(extraction)
  const contents = new Map<CvLang, CvContent>([[extraction.langue, source]])
  for (const lang of options.langs) {
    if (contents.has(lang)) continue
    const remaining = deadline - Date.now()
    if (remaining < MIN_TRANSLATION_MS) {
      throw new CvExportError('La lecture du CV a pris trop de temps pour le traduire dans la même demande : exportez une seule langue, ou réessayez.', 504)
    }
    const translated = await askModel(translationPrompt(lang), `<dossier>\n${JSON.stringify(source)}\n</dossier>`,
      Math.min(TRANSLATION_TIMEOUT_MS, remaining), raw => parseTranslation(raw, source))
    contents.set(lang, translated)
  }

  const identity = identityTerms(candidate, extraction.termes_identifiants)
  const files = options.langs.map(lang => {
    const content = contents.get(lang)
    if (!content) throw new Error(`Contenu ${lang} absent après traduction`)
    const fitted = fitToTemplate({ ...content, identifiant: initialsOf(candidate.firstName, candidate.lastName, lang) }, template.map)
    let bytes: Uint8Array
    try {
      bytes = renderCv(template.bytes, template.map, fitted.data, lang)
    } catch (err) {
      // Modèle vérifié au dépôt (checkTemplate) : un échec ici vient d'un fichier modifié ou du moteur, pas du candidat.
      throw new CvExportError('Le modèle Word de l\'organisation est inutilisable : déposez-le à nouveau (bouton « Modèle CV » de la CV Thèque).', 500, { cause: err })
    }
    // Comparé au modèle de l'organisation : son bloc contact commercial lui appartient.
    const leaks = findLeaks(bytes, template.bytes, identity, template.map.esn)
    if (leaks.length > 0) {
      // Journal : types seulement, jamais les valeurs (données personnelles).
      console.warn('[cv-export] export bloqué : fuite détectée', logId, lang, leaks.map(l => l.kind).join(','))
      throw new CvExportError(leakMessage(leaks), 422)
    }
    return { lang, bytes, data: fitted.data, certificationsMerged: fitted.certificationsMerged }
  })

  const first = files[0]
  const notes = exportNotes({
    // Le plus grand nombre de champs à compléter parmi les langues : une traduction peut en avoir laissé davantage.
    toComplete: Math.max(...files.map(f => countToComplete(f.data))),
    omitted: extraction.omis,
    certificationsMerged: first.certificationsMerged,
    cvTruncated: cv.truncated,
  })
  // Titre de la version rendue et contrôlée (celui de la langue du CV n'est pas rendu si seule l'autre langue est demandée).
  const baseName = exportBaseName(template.map.esn, first.data.identifiant, first.data.titre)
  return {
    files: files.map(f => ({ lang: f.lang, fileName: `${baseName}_${LANG_SUFFIX[f.lang]}.docx`, bytes: f.bytes })),
    notes,
    sourceCvFileId: candidate.cvFileId,
  }
}

/** Le .docx d'une seule langue, ou un .zip des deux (fraîchement générés ou relus dans les versions enregistrées). */
export function bundleCvExport(files: CvExportDocx[]): CvExportFile {
  if (files.length === 1) return { fileName: files[0].fileName, contentType: DOCX_TYPE, bytes: files[0].bytes }
  // Le .zip ne contient que les .docx, prêts à envoyer au client ; le compte rendu reste dans la fenêtre d'export.
  const zip = zipSync(Object.fromEntries(files.map(f => [f.fileName, f.bytes])))
  return { fileName: zipNameOf(files[0].fileName), contentType: 'application/zip', bytes: zip }
}
