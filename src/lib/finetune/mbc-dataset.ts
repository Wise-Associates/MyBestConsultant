import { createHash } from 'node:crypto'
import { parseModelJson } from '../ai/model-json'
import type { AIModule } from '../ai/models'
import { parseCriteriaJudgements } from '../criteria-scoring'
import { offerCriteria, parseJudgements, parseTitleRelations, rolePairs, titleCheckPrompt, type ActiveScale, type MatchJudgements } from '../match-scoring'
import type { OfferCriteriaSet } from '../offer-criteria'
import { parseVivierMatching, type OfferToScore } from '../vivier-matching'
import { InvalidAnswerError, TruncatedAnswerError, contentOf, dominantLang, parseExtraction, parseTranslation, type CvContent } from '../cv-export/cv-data'
import { translationPrompt, translationRequest } from '../cv-export/prompt'
import type { AnonymizationMode, CvLang } from '../cv-export/types'
import { cleanAnswer } from '../../assistant/core/rules'
import { nullableReply, parseGeneratedQuestions, parseInterviewEndAnalysis, parseRecruiterAnalysis } from '../interview-prompts'
import { parseTunedQuestions } from '../interview-question-tuning'
import { parseJobDraftAnswer } from '../job-draft-prompts'
import { parseImprovedJobAnswer, parseJobImportAnswer, type ImprovableJobFields } from '../job-import-prompts'
import { parseOutreachAnswer } from '../outreach-prompt'
import { cleanRecommendationMessage } from '../recommendation-prompt'
import { cleanStepReport } from '../step-report-prompt'
import { parseCvProfileResponse } from '../cv-profile-prompt'
import { parseSocialCopy } from '../social-copy-prompt'
import type { JobLite } from '../social-content'
import { parsePublicationCopy } from '../ao/publication-copy'
import { parseCriteriaProposal } from '../ao/criteria-proposal'
import { cleanOutreachDraft, parseBriefCriteria, type MbcCriteria } from '../mbc-search/rules'
import { briefForAi, criteriaForAi, parseQuestionsAnswer, parseRefinement } from '../mbc-search/conversation'
import { parseStrategies } from '../mbc-search/strategies'
import { refinePrompt, strategiesPrompt } from '../mbc-search/prompts'
import type { OfferCriteria } from '../match-scoring'

// Jeu d'affinage multi-tâches du 3B (ADR 0063) : pour chaque tâche d'IA de MBC, les consignes et le message exacts que
// l'application envoie (construits par ses propres fonctions), la réponse d'un modèle enseignant (Claude Sonnet 5.5),
// gardée seulement si la lecture de l'application l'accepte. Règles pures, testées dans mbc-dataset.test.ts ; lecture des
// données et appels : scripts/finetune-mbc-dataset.mts.

/** Une tâche d'IA de MBC : un appel à callLLM, avec ses consignes et sa lecture de la réponse. */
export type TaskId =
  | 'scoring-matching' | 'scoring-final' | 'scoring-criteria' | 'vivier-batch' | 'title-check'
  | 'cv-export-extract' | 'cv-export-translate'
  | 'assistant'
  | 'interview-closing' | 'interview-followup-candidate' | 'interview-followup-recruiter' | 'interview-questions'
  | 'interview-tuning' | 'interview-analysis-recruiter' | 'interview-analysis-end'
  | 'job-draft' | 'job-improve' | 'job-import' | 'job-import-improve' | 'step-report' | 'recommendation' | 'outreach'
  | 'cv-profile' | 'social-copy' | 'ao-publication' | 'ao-criteria'
  | 'mbc-brief-criteria' | 'mbc-questions' | 'mbc-strategies' | 'mbc-refine' | 'mbc-outreach' | 'mbc-evaluation'

export interface TaskSpec {
  label: string
  /** Ligne de Config IA qui choisit le modèle de cette tâche ('default' : modèle par défaut). */
  module: AIModule | 'default'
  /** Longueur maximale de la réponse dans l'application (maxTokens de callLLM) : celle de l'élève. */
  appMaxTokens: number
  /** Réflexion de l'enseignant : plus de réflexion, meilleures réponses, plus de jetons facturés. */
  effort: 'low' | 'medium' | 'high'
  /** Jetons de sortie attendus de l'enseignant (réponse + réflexion), pour l'estimation du coût. */
  expectedOutputTokens: number
}

export const TASKS: Record<TaskId, TaskSpec> = {
  'scoring-matching': { label: 'Notation matching (CV × offre)', module: 'matching', appMaxTokens: 8000, effort: 'medium', expectedOutputTokens: 3500 },
  'scoring-final': { label: 'Notation score final (candidature)', module: 'matching', appMaxTokens: 8000, effort: 'medium', expectedOutputTokens: 3500 },
  'scoring-criteria': { label: 'Notation sur critères de l’offre', module: 'matching', appMaxTokens: 8000, effort: 'medium', expectedOutputTokens: 3000 },
  'vivier-batch': { label: 'Vivier général (CV × 5 offres)', module: 'matching', appMaxTokens: 8000, effort: 'medium', expectedOutputTokens: 7000 },
  'title-check': { label: 'Comparaison des intitulés', module: 'matching', appMaxTokens: 2000, effort: 'low', expectedOutputTokens: 400 },
  'cv-export-extract': { label: 'Export CV : lecture du CV', module: 'cvExport', appMaxTokens: 16000, effort: 'medium', expectedOutputTokens: 7000 },
  'cv-export-translate': { label: 'Export CV : traduction', module: 'cvExport', appMaxTokens: 16000, effort: 'low', expectedOutputTokens: 6000 },
  assistant: { label: 'Assistant IA', module: 'assistant', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 700 },
  'interview-closing': { label: 'Entretien : réponse à la question du candidat', module: 'interview', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 400 },
  'interview-followup-candidate': { label: 'Entretien : relance (salle candidat)', module: 'interview', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 300 },
  'interview-followup-recruiter': { label: 'Entretien : relance (salle recruteur)', module: 'interview', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 300 },
  'interview-questions': { label: 'Entretien : génération des questions', module: 'interview', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 1800 },
  'interview-tuning': { label: 'Entretien : ajustement des questions', module: 'interview', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 1800 },
  'interview-analysis-recruiter': { label: 'Entretien : analyse (salle recruteur)', module: 'interview', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 2000 },
  'interview-analysis-end': { label: 'Entretien : analyse de fin', module: 'interview', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 2000 },
  'job-draft': { label: 'Offre : rédaction depuis un besoin', module: 'default', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 1800 },
  'job-improve': { label: 'Offre : amélioration', module: 'default', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 1800 },
  'job-import': { label: 'Import d’offres (texte, fichier)', module: 'default', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 2200 },
  'job-import-improve': { label: 'Import : amélioration d’une offre', module: 'default', appMaxTokens: 4096, effort: 'medium', expectedOutputTokens: 1800 },
  'step-report': { label: 'Compte rendu d’étape', module: 'default', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 600 },
  recommendation: { label: 'Demande de recommandation', module: 'default', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 300 },
  outreach: { label: 'Message d’approche d’un candidat', module: 'default', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 500 },
  'cv-profile': { label: 'Profil extrait d’un CV', module: 'default', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 1500 },
  'social-copy': { label: 'Publication sociale d’une offre', module: 'default', appMaxTokens: 4096, effort: 'low', expectedOutputTokens: 600 },
  'ao-publication': { label: 'AO : version publique anonyme', module: 'aoPublication', appMaxTokens: 8000, effort: 'low', expectedOutputTokens: 2500 },
  'ao-criteria': { label: 'AO : critères de matching proposés', module: 'matching', appMaxTokens: 4000, effort: 'medium', expectedOutputTokens: 1500 },
  'mbc-brief-criteria': { label: 'MBC Search : critères d’un besoin', module: 'matching', appMaxTokens: 600, effort: 'low', expectedOutputTokens: 500 },
  'mbc-questions': { label: 'MBC Search : questions de précision', module: 'matching', appMaxTokens: 700, effort: 'low', expectedOutputTokens: 500 },
  'mbc-strategies': { label: 'MBC Search : stratégies de recherche', module: 'matching', appMaxTokens: 800, effort: 'low', expectedOutputTokens: 600 },
  'mbc-refine': { label: 'MBC Search : critères ajustés', module: 'matching', appMaxTokens: 800, effort: 'low', expectedOutputTokens: 600 },
  'mbc-outreach': { label: 'MBC Search : message d’approche', module: 'matching', appMaxTokens: 700, effort: 'low', expectedOutputTokens: 500 },
  'mbc-evaluation': { label: 'MBC Search : évaluation d’un profil', module: 'matching', appMaxTokens: 8000, effort: 'medium', expectedOutputTokens: 3000 },
}

/** Ce que la lecture de la réponse d'une tâche doit connaître (offre, CV lu…). */
export type TaskContext =
  | { task: 'scoring-matching' | 'scoring-final'; scale: ActiveScale; skills: string[]; description: string; cvText: string }
  | { task: 'scoring-criteria'; set: OfferCriteriaSet; cvText: string }
  | { task: 'vivier-batch'; offers: OfferToScore[]; cvText: string }
  | { task: 'title-check'; count: number }
  | { task: 'cv-export-extract'; mode: AnonymizationMode }
  | { task: 'cv-export-translate'; source: CvContent; target: CvLang }
  /** `followUp` : question suivante, posée après la réponse (conversation à deux tours). */
  | { task: 'assistant'; role: 'candidate' | 'recruiter'; followUp?: string }
  | { task: 'interview-closing' | 'interview-followup-candidate' | 'interview-followup-recruiter' | 'interview-analysis-recruiter' | 'interview-analysis-end' }
  | { task: 'interview-questions'; count: number }
  | { task: 'interview-tuning'; given: number; target: number }
  | { task: 'job-draft' | 'job-improve' | 'job-import' | 'step-report' | 'recommendation' }
  | { task: 'job-import-improve'; job: ImprovableJobFields }
  | { task: 'outreach'; jobTitle: string }
  | { task: 'cv-profile' | 'ao-publication' | 'mbc-questions' | 'mbc-outreach' }
  | { task: 'social-copy'; job: JobLite }
  | { task: 'ao-criteria'; fallback: OfferCriteriaSet }
  /** `brief` : besoin d'origine, repris par les demandes qui suivent (stratégies, ajustement). */
  | { task: 'mbc-brief-criteria'; brief: string; refineMessage: string }
  | { task: 'mbc-strategies' | 'mbc-refine'; criteria: MbcCriteria }
  | { task: 'mbc-evaluation'; judged: OfferCriteria; cvText: string }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Une demande à l'enseignant : exactement ce que MBC enverrait au modèle de la tâche. */
export interface DatasetItem {
  id: string
  /** Regroupement pour la répartition : un même CV (ou une même source) n'est jamais à la fois en entraînement et en test. */
  group: string
  /** Projet Appwrite d'origine (DEV ou production), pour les comptes. */
  project: string
  system: string
  messages: ChatMessage[]
  ctx: TaskContext
}

/** Identifiant stable d'une demande : même tâche, mêmes sources, même identifiant (reprise après un arrêt). */
export const itemId = (task: TaskId, ...sources: string[]) =>
  `${task}:${createHash('sha256').update(sources.join('\u0000')).digest('hex').slice(0, 24)}`

/** Premier objet (ou tableau) JSON de la réponse, lu comme l'application le lit ; null s'il est illisible. */
function jsonIn(raw: string, open: '{' | '['): unknown {
  const match = raw.match(open === '{' ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/)
  if (!match) return null
  try { return parseModelJson(match[0]) } catch { return null }
}

export type TeacherVerdict = { answer: string } | { reason: string }

/** Date de référence de la lecture d'un profil de CV dans les exemples (durées), fixe pour des exports identiques. */
const PROFILE_REFERENCE_DATE = new Date('2026-11-25T00:00:00Z')

/** Lecture de l'application qui lève sur un JSON illisible (là où elle attrape l'erreur) : null. */
function readSafely<T>(read: () => T): T | null {
  try { return read() } catch { return null }
}

/**
 * Réponse de l'enseignant lue par la lecture même de l'application : refusée si l'application ne la lirait pas (pas de
 * JSON, jugement manquant, offre du lot sans jugement…) ; sinon réécrite en JSON compact, la forme que l'élève apprend.
 */
export function teacherAnswer(ctx: TaskContext, raw: string): TeacherVerdict {
  switch (ctx.task) {
    case 'scoring-matching':
    case 'scoring-final': {
      const answer = jsonIn(raw, '{')
      if (answer === null) return { reason: 'pas d’objet JSON lisible' }
      if (!parseJudgements(answer, offerCriteria(ctx.skills, ctx.description), ctx.cvText, ctx.scale)) return { reason: 'jugements illisibles pour l’application' }
      return { answer: JSON.stringify(answer) }
    }
    case 'scoring-criteria': {
      const answer = jsonIn(raw, '{')
      if (answer === null) return { reason: 'pas d’objet JSON lisible' }
      if (!parseCriteriaJudgements(answer, ctx.set, ctx.cvText)) return { reason: 'jugements des critères illisibles pour l’application' }
      return { answer: JSON.stringify(answer) }
    }
    case 'vivier-batch': {
      const judged = parseVivierMatching(raw, ctx.offers, ctx.cvText)
      if (!judged) return { reason: 'pas de tableau JSON lisible' }
      // L'application garde une réponse partielle ; l'élève n'apprend que des réponses qui jugent toutes les offres.
      if (judged.length !== ctx.offers.length) return { reason: `${ctx.offers.length - judged.length} offre(s) sans jugement lisible` }
      return { answer: JSON.stringify(jsonIn(raw, '[')) }
    }
    case 'title-check': {
      const relations = parseTitleRelations(raw, ctx.count, true)
      if (relations.some(r => r === null)) return { reason: 'relation manquante ou illisible' }
      return { answer: JSON.stringify(relations) }
    }
    case 'assistant': {
      // Comme l'assistant (turn.ts) : réponse nettoyée et bornée, refusée si vide.
      const answer = cleanAnswer(raw)
      return answer ? { answer } : { reason: 'réponse vide' }
    }
    case 'interview-closing':
    case 'interview-followup-candidate':
    case 'interview-followup-recruiter':
      // Texte libre ; « null » veut dire « rien à dire » (nullableReply) : appris tel quel.
      if (!raw.trim()) return { reason: 'réponse vide' }
      return { answer: nullableReply(raw) ?? 'null' }
    case 'interview-questions': {
      const questions = readSafely(() => parseGeneratedQuestions(raw, ctx.count))
      if (!questions?.length) return { reason: 'questions illisibles pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '[')) }
    }
    case 'interview-tuning':
      if (!parseTunedQuestions(raw, ctx.given, ctx.target)) return { reason: 'questions ajustées refusées par l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '[')) }
    case 'interview-analysis-recruiter':
      if (!readSafely(() => parseRecruiterAnalysis(raw, 'enseignant'))) return { reason: 'analyse illisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'interview-analysis-end': {
      // L'application enregistre l'objet tel quel, sans en vérifier la forme : l'élève apprend au moins un objet JSON.
      const analysis = readSafely(() => parseInterviewEndAnalysis(raw))
      const object = jsonIn(raw, '{')
      if (!analysis || !object || typeof object !== 'object') return { reason: 'analyse illisible pour l’application' }
      return { answer: JSON.stringify(object) }
    }
    case 'job-draft':
    case 'job-improve': {
      const result = readSafely(() => parseJobDraftAnswer(raw))
      if (!result || 'error' in result) return { reason: 'offre illisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    }
    case 'job-import': {
      const result = parseJobImportAnswer(raw)
      if ('error' in result || result.jobs.length === 0) return { reason: 'aucune offre lisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '[')) }
    }
    case 'job-import-improve': {
      const result = readSafely(() => parseImprovedJobAnswer(raw, ctx.job))
      if (!result || 'error' in result) return { reason: 'offre améliorée illisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    }
    case 'outreach': {
      const result = readSafely(() => parseOutreachAnswer(raw, ctx.jobTitle))
      if (!result || result.error) return { reason: 'message illisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    }
    case 'step-report':
    case 'recommendation': {
      // Texte libre nettoyé comme l'application le nettoie (gras retiré, longueur, guillemets) : la forme apprise.
      const text = ctx.task === 'step-report' ? cleanStepReport(raw) : cleanRecommendationMessage(raw)
      return text ? { answer: text } : { reason: 'réponse vide' }
    }
    case 'cv-profile':
      // Date fixe : la lecture ne s'en sert que pour des durées, pas pour accepter ou refuser la réponse.
      if (!readSafely(() => parseCvProfileResponse(raw, PROFILE_REFERENCE_DATE))) return { reason: 'profil illisible pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'social-copy': {
      // L'application remplace une réponse illisible par un texte par défaut : l'élève n'apprend que des réponses lues.
      const object = jsonIn(raw, '{')
      if (!object || !readSafely(() => parseSocialCopy(raw, ctx.job))) return { reason: 'publication illisible pour l’application' }
      return { answer: JSON.stringify(object) }
    }
    case 'ao-publication':
      if (!parsePublicationCopy(raw)) return { reason: 'version publique refusée par l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'ao-criteria':
      if (!parseCriteriaProposal(raw, ctx.fallback)) return { reason: 'critères refusés par l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'mbc-brief-criteria':
      if (!parseBriefCriteria(raw)) return { reason: 'critères illisibles pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'mbc-questions':
      if (!parseQuestionsAnswer(raw)) return { reason: 'questions illisibles pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'mbc-strategies':
      // Toujours au moins la recherche de base : une réponse lue en ajoute d'autres.
      if (parseStrategies(raw, ctx.criteria).length <= 1) return { reason: 'aucune stratégie lisible' }
      return { answer: JSON.stringify(jsonIn(raw, '{') ?? jsonIn(raw, '[')) }
    case 'mbc-refine':
      if (!parseRefinement(raw, ctx.criteria)) return { reason: 'critères ajustés illisibles pour l’application' }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    case 'mbc-outreach': {
      const text = cleanOutreachDraft(raw)
      return text ? { answer: text } : { reason: 'réponse vide' }
    }
    case 'mbc-evaluation': {
      const answer = jsonIn(raw, '{')
      if (!answer || !parseJudgements(answer, ctx.judged, ctx.cvText, 'matching')) return { reason: 'jugements illisibles pour l’application' }
      return { answer: JSON.stringify(answer) }
    }
    case 'cv-export-extract':
    case 'cv-export-translate': {
      try {
        if (ctx.task === 'cv-export-extract') parseExtraction(raw)
        else parseTranslation(raw, ctx.source)
      } catch (err) {
        if (err instanceof InvalidAnswerError || err instanceof TruncatedAnswerError) return { reason: `dossier refusé par l'export : ${err.message.slice(0, 80)}` }
        throw err
      }
      return { answer: JSON.stringify(jsonIn(raw, '{')) }
    }
  }
}

/** Jugements d'une réponse de notation déjà acceptée (pour la comparaison des intitulés qui la suit dans l'application). */
function judgementsOf(item: DatasetItem, answer: string): Pick<MatchJudgements, 'roles'>[] {
  const ctx = item.ctx
  if (ctx.task === 'scoring-matching' || ctx.task === 'scoring-final') {
    const j = parseJudgements(JSON.parse(answer), offerCriteria(ctx.skills, ctx.description), ctx.cvText, ctx.scale)
    return j ? [j] : []
  }
  if (ctx.task === 'scoring-criteria') {
    const j = parseCriteriaJudgements(JSON.parse(answer), ctx.set, ctx.cvText)
    return j ? [j] : []
  }
  if (ctx.task === 'vivier-batch') return (parseVivierMatching(answer, ctx.offers, ctx.cvText) ?? []).map(v => v.judgements)
  if (ctx.task === 'mbc-evaluation') {
    const j = parseJudgements(JSON.parse(answer), ctx.judged, ctx.cvText, 'matching')
    return j ? [j] : []
  }
  return []
}

/**
 * Comparaison des intitulés qui suit une notation dans l'application (withCheckedTitles : une question pour toutes les
 * paires de la notation) ; null quand la notation n'a aucun métier à vérifier.
 */
export function titleCheckItem(item: DatasetItem, answer: string): DatasetItem | null {
  const pairs = judgementsOf(item, answer).flatMap(rolePairs)
  if (pairs.length === 0) return null
  const { system, user } = titleCheckPrompt(pairs)
  return {
    id: itemId('title-check', item.id), group: item.group, project: item.project,
    system, messages: [{ role: 'user', content: user }], ctx: { task: 'title-check', count: pairs.length },
  }
}

/** Traduction qui suit la lecture d'un CV dans l'export : le dossier lu, vers l'autre langue (comme exportCv). */
export function translationItem(item: DatasetItem, answer: string): DatasetItem | null {
  if (item.ctx.task !== 'cv-export-extract') return null
  const extraction = parseExtraction(answer)
  const source = contentOf(extraction)
  const target: CvLang = (dominantLang(source) ?? extraction.langue) === 'fr' ? 'en' : 'fr'
  return {
    id: itemId('cv-export-translate', item.id), group: item.group, project: item.project,
    system: translationPrompt(target), messages: [{ role: 'user', content: translationRequest(source) }],
    ctx: { task: 'cv-export-translate', source, target },
  }
}

/** Seconde question d'une conversation avec l'assistant, après sa première réponse (historique comme turn.ts). */
export function assistantFollowUpItem(item: DatasetItem, answer: string): DatasetItem | null {
  if (item.ctx.task !== 'assistant' || !item.ctx.followUp) return null
  return {
    id: itemId('assistant', item.id, item.ctx.followUp), group: item.group, project: item.project, system: item.system,
    messages: [...item.messages, { role: 'assistant', content: answer }, { role: 'user', content: item.ctx.followUp }],
    ctx: { task: 'assistant', role: item.ctx.role },
  }
}

/**
 * Après les critères d'un besoin (MBC Search) : les stratégies de recherche, puis un ajustement demandé par le recruteur
 * dans la conversation — chaque fois sur les critères que l'application aurait lus.
 */
export function mbcFollowUpItems(item: DatasetItem, answer: string): DatasetItem[] {
  if (item.ctx.task !== 'mbc-brief-criteria') return []
  const criteria = parseBriefCriteria(answer)
  if (!criteria) return []
  const { brief, refineMessage } = item.ctx
  const strategies = strategiesPrompt({ brief, criteria })
  const refine = refinePrompt({ brief: briefForAi(brief), criteria: criteriaForAi(criteria), message: refineMessage })
  return [
    { id: itemId('mbc-strategies', item.id), group: item.group, project: item.project, system: strategies.system, messages: [{ role: 'user', content: strategies.user }], ctx: { task: 'mbc-strategies', criteria } },
    { id: itemId('mbc-refine', item.id), group: item.group, project: item.project, system: refine.system, messages: [{ role: 'user', content: refine.user }], ctx: { task: 'mbc-refine', criteria } },
  ]
}

/** Demandes qui suivent une réponse acceptée dans l'application : comparaison des intitulés, traduction, question suivante… */
export function followUpItems(item: DatasetItem, answer: string): DatasetItem[] {
  return [
    titleCheckItem(item, answer), translationItem(item, answer), assistantFollowUpItem(item, answer), ...mbcFollowUpItems(item, answer),
  ].filter((x): x is DatasetItem => x !== null)
}

// ── Coût ─────────────────────────────────────────────────────────────────────

/** Claude Sonnet 5.5 : prix par million de jetons (skill claude-api, tarifs du 2026-11-03) ; lots à moitié prix. */
export const TEACHER = { model: 'claude-sonnet-5-5', inputPerMTok: 2, outputPerMTok: 10, batchDiscount: 0.5 } as const

/** Jetons d'un texte français, estimés large (3,2 caractères par jeton) : le compte exact vient de l'API à l'envoi. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2)

export interface CostLine {
  task: TaskId
  items: number
  inputTokens: number
  outputTokens: number
  usd: number
}

/** Coût estimé des demandes à l'enseignant, par tâche, en lots (Batch API). */
export function estimateCost(items: DatasetItem[]): CostLine[] {
  const byTask = new Map<TaskId, CostLine>()
  for (const item of items) {
    const task = item.ctx.task
    const line = byTask.get(task) ?? { task, items: 0, inputTokens: 0, outputTokens: 0, usd: 0 }
    line.items++
    line.inputTokens += estimateTokens(item.system) + item.messages.reduce((n, m) => n + estimateTokens(m.content), 0)
    line.outputTokens += TASKS[task].expectedOutputTokens
    byTask.set(task, line)
  }
  return [...byTask.values()].map(line => ({
    ...line,
    usd: ((line.inputTokens * TEACHER.inputPerMTok + line.outputTokens * TEACHER.outputPerMTok) / 1e6) * TEACHER.batchDiscount,
  }))
}

// ── Répartition et exemples ──────────────────────────────────────────────────

export type Split = 'train' | 'validation' | 'test'

/** Part d'un groupe, tirée de son empreinte : 80 % entraînement, 10 % contrôle, 10 % test, la même à chaque export. */
export function splitOf(group: string): Split {
  const n = parseInt(createHash('sha256').update(`split:${group}`).digest('hex').slice(0, 8), 16) % 10
  return n === 0 ? 'test' : n === 1 ? 'validation' : 'train'
}

/**
 * Exemple d'entraînement (format du déployeur : seule la dernière réponse est apprise). Sans consignes (analyse de fin
 * d'entretien), pas de message système : l'application n'en envoie pas.
 */
export function chatExample(item: DatasetItem, answer: string) {
  const system = item.system ? [{ role: 'system' as const, content: item.system }] : []
  return { messages: [...system, ...item.messages, { role: 'assistant' as const, content: answer }] }
}
