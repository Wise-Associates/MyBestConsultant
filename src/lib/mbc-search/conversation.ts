import { z } from 'zod'
import { CRITERIA_LIMITS, jsonObjectIn, readCriteria, textList, type MbcCriteria } from './rules'

// Conversation de MBC Search (demande du 2026-11-13 : la recherche se fait en discutant). Avant de chercher, l'IA pose
// au plus 3 questions à choix sur le brief ; les réponses complètent le brief lu par l'IA ; une fois les profils
// affichés, chaque message du recruteur ajuste les critères. Règles pures, testées dans conversation.test.ts : lecture
// des réponses de l'IA (fail closed) et texte envoyé à l'IA à partir des réponses du recruteur.

export const QUESTION_LIMITS = { questions: 3, options: 4, question: 200, option: 80, answer: 500, reply: 400, message: 1000 } as const

/** Une question de l'IA avant la recherche, avec ses réponses proposées. */
export interface MbcQuestion {
  question: string
  options: string[]
}

/** Réponse du recruteur à une question : réponses proposées cochées et réponse libre (l'une ou l'autre peut manquer). */
export const answersSchema = z.array(z.object({
  question: z.string().trim().min(1).max(QUESTION_LIMITS.question),
  choices: z.array(z.string().trim().min(1).max(QUESTION_LIMITS.option)).max(QUESTION_LIMITS.options),
  text: z.string().trim().max(QUESTION_LIMITS.answer),
})).max(QUESTION_LIMITS.questions)
export type MbcAnswer = z.infer<typeof answersSchema>[number]

/** Message du recruteur pour ajuster la recherche affichée. */
export const refineMessageSchema = z.string().trim()
  .min(2, 'Écrivez ce qui ne va pas ou ce qui manque.')
  .max(QUESTION_LIMITS.message, `Message limité à ${QUESTION_LIMITS.message} caractères.`)

const replyOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, QUESTION_LIMITS.reply) : '')

/**
 * Questions de l'IA avant la recherche. Une question sans au moins 2 réponses proposées est écartée ; 3 questions et
 * 4 réponses au plus, textes coupés aux limites. null si la réponse n'est pas un objet JSON lisible ; aucune question
 * (brief assez précis) : `questions` vide.
 */
export function parseQuestionsAnswer(text: string): { reply: string; questions: MbcQuestion[] } | null {
  const obj = jsonObjectIn(text)
  if (!obj) return null
  const raw = Array.isArray(obj.questions) ? obj.questions : []
  const questions: MbcQuestion[] = []
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue
    const item = q as Record<string, unknown>
    const question = typeof item.question === 'string' ? item.question.trim().slice(0, QUESTION_LIMITS.question) : ''
    const options = textList(item.options, QUESTION_LIMITS.option, QUESTION_LIMITS.options)
    if (question && options.length >= 2) questions.push({ question, options })
    if (questions.length === QUESTION_LIMITS.questions) break
  }
  // Questions annoncées mais toutes écartées : la phrase de l'IA les annoncerait sans qu'elles s'affichent.
  return { reply: raw.length > 0 && questions.length === 0 ? '' : replyOf(obj.reply), questions }
}

/** Réponse d'une question en une ligne : réponses cochées puis réponse libre ; '' si la question a été passée. */
export function answerText(a: MbcAnswer): string {
  return [...a.choices, a.text].map(s => s.trim()).filter(Boolean).join(' ; ')
}

/**
 * Brief envoyé à l'IA qui en tire les critères : le brief du recruteur, puis ses réponses aux questions (les questions
 * passées sont omises). Borné : brief et réponses le sont déjà par leurs schémas.
 */
export function briefWithAnswers(brief: string, answers: MbcAnswer[]): string {
  const lines = answers.map(a => ({ q: a.question.trim(), r: answerText(a) })).filter(x => x.q && x.r).map(x => `- ${x.q} → ${x.r}`)
  return lines.length === 0 ? brief.trim() : `${brief.trim()}\n\nPrécisions du recruteur :\n${lines.join('\n')}`
}

/**
 * Critères ajustés par l'IA après un message du recruteur. Les filtres que l'IA ne règle pas (« e-mail disponible »,
 * « récent ») restent ceux de la recherche en cours. null si la réponse est illisible ou sans intitulé ni compétence.
 */
export function parseRefinement(text: string, current: MbcCriteria): { reply: string; criteria: MbcCriteria } | null {
  const obj = jsonObjectIn(text)
  const raw = obj?.criteria
  if (!obj || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const criteria = readCriteria(raw as Record<string, unknown>)
  if (!criteria) return null
  return { reply: replyOf(obj.reply), criteria: { ...criteria, emailOnly: current.emailOnly, recentOnly: current.recentOnly } }
}

/** Critères actuels, tels qu'envoyés à l'IA pour un ajustement (sans les filtres qu'elle ne règle pas). */
export function criteriaForAi(c: MbcCriteria): string {
  return JSON.stringify({
    titles: c.titles, locations: c.locations, seniorities: c.seniorities, skills: c.skills,
    requiredSkills: c.requiredSkills ?? [], sectors: c.sectors ?? [],
  })
}

/** Texte du brief borné pour l'IA : un brief vide (critères saisis à la main) est dit tel quel. */
export function briefForAi(brief: string): string {
  return brief.trim().slice(0, CRITERIA_LIMITS.brief) || '(pas de description : critères saisis à la main)'
}
