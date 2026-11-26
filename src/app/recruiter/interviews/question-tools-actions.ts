'use server'

import { z } from 'zod'
import { callLLMForModule } from '@/lib/ai/llm-router'
import { releaseDailySlot, takeDailySlotId } from '@/lib/ao/state'
import { takeAllSlots } from '@/lib/daily-slots'
import { aiInterviewRecruiter, takeInterviewAiSlot } from '@/lib/interview-access'
import { INTERVIEW_IMPORT_DAILY_LIMITS, INTERVIEW_INPUT_LIMITS, questionsInputSchema } from '@/lib/interview-rules'
import { PdfRefusedError } from '@/lib/pdf-inflate-guard'
import { IMPORT_LIMITS, parseInterviewQuestions } from '@/lib/interview-question-parser'
import { parseTunedQuestions, tuningSystemPrompt, tuningUserMessage } from '@/lib/interview-question-tuning'
import type { InterviewQuestion } from './actions'

// Questions d'un entretien IA écrites par le recruteur (ADR 0054) : import d'un fichier PDF ou TXT, et « Ajuster avec
// l'IA ». Mêmes contrôles que la génération des questions : recruteur dont la formule comprend les entretiens IA ;
// l'ajustement prend une place sur le quota du jour de l'IA des entretiens, l'import sur le sien (adresse vérifiée exigée).

const callLLM = callLLMForModule('interview')
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_CHARS = 60_000

/** Texte d'un fichier TXT : UTF-8, sinon Windows-1252 (Bloc-notes d'un ancien Windows), sans marque d'ordre des octets. */
function textOfTxt(buffer: Buffer): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer)
  }
  return text.replace(/^﻿/, '').slice(0, MAX_TEXT_CHARS)
}

/** Questions lues dans le fichier `file` du formulaire (PDF ou TXT, 2 Mo au plus), à relire avant l'envoi. */
export async function importInterviewQuestionsFile(form: FormData): Promise<{ questions: InterviewQuestion[]; truncated: boolean } | { error: string }> {
  const me = await aiInterviewRecruiter()
  if ('error' in me) return { error: me.error }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choisissez un fichier PDF ou TXT.' }
  if (file.size > MAX_FILE_BYTES) return { error: 'Fichier trop lourd : 2 Mo au plus.' }
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'pdf' && ext !== 'txt') return { error: 'Format non pris en charge : PDF ou TXT seulement.' }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Contenu vérifié par ses octets : un autre fichier renommé en « .pdf » ou « .txt » n'est pas lu.
  if (ext === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'Ce fichier n’est pas un PDF valide.' }
  if (ext === 'txt' && buffer.includes(0)) return { error: 'Ce fichier n’est pas un fichier texte.' }

  // Inscription libre : adresse vérifiée et quotas du jour (organisation, plateforme) avant de lire le fichier.
  if (!me.user.emailVerification) return { error: 'Vérifiez votre adresse e-mail pour importer des questions.' }
  const now = new Date()
  const L = INTERVIEW_IMPORT_DAILY_LIMITS
  try {
    const { ok } = await takeAllSlots([
      ['interviewImportOrg', me.tenantId, L.organisation],
      ['interviewImportAll', 'platform', L.allOrganisations],
    ] as const, ([counter, key, limit]) => takeDailySlotId(counter, key, now, limit), releaseDailySlot)
    if (!ok) return { error: `Limite de ${L.organisation} fichiers importés par jour atteinte : réessayez demain, ou ajoutez vos questions à la main.` }
  } catch (err) {
    console.error('[entretiens] quota des imports illisible', err instanceof Error ? err.message : err)
    return { error: 'Import impossible pour le moment : réessayez dans quelques instants.' }
  }

  let text: string
  if (ext === 'txt') {
    text = textOfTxt(buffer)
  } else {
    try {
      const { extractTextFromFile } = await import('@/lib/import-file-extract')
      text = await extractTextFromFile(buffer, 'questions.pdf', { strict: true, maxChars: MAX_TEXT_CHARS })
    } catch (err) {
      console.error('[entretiens] PDF de questions illisible', err instanceof Error ? err.message : err)
      // PDF refusé avant sa lecture (trop lourd une fois décompressé, protégé, format ancien) : la raison est dite.
      if (err instanceof PdfRefusedError) return { error: `${err.message} Enregistrez-le de nouveau depuis Word ou LibreOffice, ou utilisez un fichier TXT.` }
      return { error: 'PDF illisible (protégé ou abîmé). Enregistrez-le de nouveau en PDF ou en TXT, puis réessayez.' }
    }
  }

  const { questions, truncated } = parseInterviewQuestions(text)
  if (questions.length === 0) {
    return { error: 'Aucune question trouvée : numérotez vos questions ou terminez-les par « ? ». Un PDF scanné (une image, sans texte) ne peut pas être lu.' }
  }
  const stamp = Date.now().toString(36)
  return {
    questions: questions.map((q, i) => ({ id: `imp-${stamp}-${i}`, text: q.text, category: q.category, aiGenerated: false })),
    truncated,
  }
}

const tuneInputSchema = questionsInputSchema.extend({
  // Questions du recruteur visées après l'ajustement : le nombre choisi moins les questions par défaut de la liste.
  questionCount: z.number().int().min(0).max(IMPORT_LIMITS.maxQuestions),
  questions: z.array(z.object({
    id: z.string().max(40),
    text: z.string().trim().min(1).max(INTERVIEW_INPUT_LIMITS.question),
    category: z.enum(['intro', 'technical', 'behavioral', 'motivation', 'closing']),
    aiGenerated: z.boolean(),
  })).min(1).max(IMPORT_LIMITS.maxQuestions),
})

/**
 * « Ajuster avec l'IA » : les questions du recruteur reformulées (sens et ordre gardés, catégorie donnée), complétées
 * jusqu'à `questionCount` (ses questions visées, questions par défaut déduites) si elles sont moins nombreuses. Chaque question retravaillée garde son identifiant ; une
 * réponse de l'IA qui en perd une est refusée (parseTunedQuestions), les questions restent alors inchangées.
 */
export async function tuneInterviewQuestions(input: {
  questions: InterviewQuestion[]
  jobTitle: string
  jobDescription: string
  jobSkills: string[]
  cvSummary: string
  questionCount: number
}): Promise<{ questions: InterviewQuestion[] } | { error: string }> {
  try {
    const me = await aiInterviewRecruiter()
    if ('error' in me) return { error: me.error }
    const parsed = tuneInputSchema.safeParse(input)
    if (!parsed.success) return { error: 'Demande invalide : gardez de 1 à 30 questions.' }
    const refused = await takeInterviewAiSlot(me)
    if (refused) return { error: refused }
    const ask = parsed.data

    const { content } = await callLLM([{ role: 'user', content: tuningUserMessage({ ...ask, targetCount: ask.questionCount }) }], tuningSystemPrompt(), { feature: 'interview-questions-tune', tenantId: me.tenantId })
    const tuned = parseTunedQuestions(content, ask.questions.length, ask.questionCount)
    if (!tuned) return { error: 'L’IA n’a pas rendu une liste exploitable : vos questions sont inchangées, réessayez.' }

    const stamp = Date.now().toString(36)
    return {
      questions: tuned.map((q, i) => {
        const original = ask.questions[i]
        return original
          ? { ...original, text: q.text, category: q.category }
          : { id: `ai-${stamp}-${i}`, text: q.text, category: q.category, aiGenerated: true }
      }),
    }
  } catch (e) {
    console.error('[entretiens] ajustement des questions en échec', e instanceof Error ? e.message : e)
    return { error: 'Ajustement impossible pour le moment : vos questions sont inchangées, réessayez dans quelques instants.' }
  }
}
