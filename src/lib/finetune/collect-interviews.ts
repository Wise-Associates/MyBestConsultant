import { createHash } from 'node:crypto'
import { Query, type Models } from 'node-appwrite'
import { createAdminClient } from '../appwrite/client'
import { COLLECTIONS, DB_ID } from '../appwrite/config'
import { listAllDocuments } from '../appwrite/list-all'
import {
  candidateFollowUpPrompt, closingAnswerPrompt, interviewEndAnalysisPrompt, questionGenerationPrompt, recruiterAnalysisPrompt,
  recruiterFollowUpPrompt, type PromptTurn,
} from '../interview-prompts'
import { tuningSystemPrompt, tuningUserMessage } from '../interview-question-tuning'
import { DEFAULT_GENERIC_QUESTIONS, INTERVIEW_INPUT_LIMITS, aiQuestionPlan, questionsInputSchema } from '../interview-rules'
import type { CollectStats } from './collect-scoring'
import { maskLeftoverContacts, textKey } from './cv-classification-dataset'
import { itemId, type DatasetItem, type TaskContext } from './mbc-dataset'
import { keepsRealName, personFromFullName, pseudonymize, type Person } from './pseudonymize'

// Demandes des entretiens IA (ADR 0063) : retranscriptions réelles (`interviews.transcript`), nom du candidat remplacé
// par un nom inventé et coordonnées masquées dans chaque réplique ; génération des questions d'après les offres et le
// résumé de screening des candidatures. Mêmes constructeurs que les actions (interview-prompts.ts).

type Category = 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing'
const CATEGORIES = new Set<Category>(['intro', 'technical', 'behavioral', 'motivation', 'closing'])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const rank = (seed: string, id: string) => createHash('sha256').update(`${seed}:${id}`).digest('hex')
const pick = <T,>(items: T[], n: number, seed: string) => items.map((x, i) => ({ x, r: rank(seed, String(i)) })).sort((a, b) => a.r.localeCompare(b.r)).slice(0, n).map(e => e.x)

function parseJsonArray(raw: unknown): unknown[] {
  try { const v = JSON.parse(str(raw) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Répliques d'une retranscription enregistrée, nom remplacé et coordonnées masquées ; null si un vrai nom reste. */
function turnsOf(doc: Models.Document, person: Person): PromptTurn[] | null {
  const turns = parseJsonArray(doc.transcript).flatMap(t => {
    const role = (t as { role?: unknown })?.role
    const content = str((t as { content?: unknown })?.content).slice(0, INTERVIEW_INPUT_LIMITS.turn).trim()
    return (role === 'interviewer' || role === 'candidate') && content ? [{ role, content: maskLeftoverContacts(pseudonymize(content, [person])) } as PromptTurn] : []
  })
  return turns.some(t => keepsRealName(t.content, person)) ? null : turns
}

export async function collectInterviews(project: string): Promise<{ items: DatasetItem[]; stats: CollectStats }> {
  const { databases } = createAdminClient()
  const [interviews, apps, jobDocs, users] = await Promise.all([
    listAllDocuments(databases, DB_ID, COLLECTIONS.INTERVIEWS, [Query.select(['$id', 'jobTitle', 'candidateName', 'transcript', 'questions', 'applicationId'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.APPLICATIONS, [Query.select(['$id', 'jobId', 'candidateId', 'aiSummary'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.JOBS, [Query.select(['$id', 'title', 'description', 'skills'])]),
    listAllDocuments(databases, DB_ID, COLLECTIONS.USERS, [Query.equal('role', 'candidate'), Query.select(['$id', 'firstName', 'lastName'])]),
  ])
  const jobs = new Map(jobDocs.map(j => [j.$id, j]))
  const appsById = new Map(apps.map(a => [a.$id, a]))
  const people = new Map(users.map(u => [u.$id, { first: str(u.firstName), last: str(u.lastName) }]))
  const stats: CollectStats = { tasks: {}, info: [] }
  const note = (task: string, reason?: string) => {
    const s = (stats.tasks[task] ??= { kept: 0, skipped: {} })
    if (reason) s.skipped[reason] = (s.skipped[reason] ?? 0) + 1
    else s.kept++
  }
  const items: DatasetItem[] = []
  const add = (ctx: TaskContext, group: string, prompt: { system?: string; user: string }, ...sources: string[]) => {
    items.push({ id: itemId(ctx.task, ...sources), group, project, system: prompt.system ?? '', messages: [{ role: 'user', content: prompt.user }], ctx })
    note(ctx.task)
  }

  for (const doc of interviews) {
    const person = personFromFullName(str(doc.candidateName))
    if (!person.first.trim() && !person.last.trim()) { note('interview-analysis-end', 'candidat sans nom'); continue }
    const turns = turnsOf(doc, person)
    if (!turns) { note('interview-analysis-end', 'nom resté après remplacement'); continue }
    const jobTitle = str(doc.jobTitle).slice(0, INTERVIEW_INPUT_LIMITS.title)
    const group = `entretien:${textKey(turns.map(t => t.content).join('\n') || doc.$id)}`
    const key = textKey(JSON.stringify(turns))

    if (turns.filter(t => t.role === 'candidate').length >= 3) {
      add({ task: 'interview-analysis-end' }, group, interviewEndAnalysisPrompt({ jobTitle, transcript: turns }), key)
      // La salle du recruteur envoie la retranscription bornée (analysisInputSchema) et aucune compétence.
      add({ task: 'interview-analysis-recruiter' }, group, recruiterAnalysisPrompt({ jobTitle, jobSkills: [], transcript: turns.slice(0, INTERVIEW_INPUT_LIMITS.turns) }), key)
    }
    // Relances : question de l'interviewer suivie de la réponse du candidat ; deux par entretien et par salle.
    const pairs = turns.flatMap((t, i) => (t.role === 'interviewer' && turns[i + 1]?.role === 'candidate' ? [i] : []))
    for (const i of pick(pairs, 2, `cand:${key}`)) {
      add({ task: 'interview-followup-candidate' }, group, candidateFollowUpPrompt({ question: turns[i].content, answer: turns[i + 1].content }), key, String(i))
    }
    for (const i of pick(pairs, 2, `rec:${key}`)) {
      add({ task: 'interview-followup-recruiter' }, group, recruiterFollowUpPrompt({ question: turns[i].content, answer: turns[i + 1].content.slice(0, INTERVIEW_INPUT_LIMITS.answer), recentTurns: turns.slice(Math.max(0, i - 4), i) }), key, String(i))
    }
    // Question du candidat après la dernière question (« Avez-vous des questions ? ») : la réponse d'Alex.
    const last = turns.length - 1
    if (last > 0 && turns[last].role === 'candidate' && turns[last - 1].role === 'interviewer') {
      add({ task: 'interview-closing' }, group, closingAnswerPrompt({ jobTitle, candidateMessage: turns[last].content }), key)
    }
    // Ajustement : les questions écrites par le recruteur (non générées), comme dans l'éditeur de questions.
    const given = parseJsonArray(doc.questions).flatMap(q => {
      const o = q as { text?: unknown; category?: unknown; aiGenerated?: unknown }
      const text = str(o?.text).trim().slice(0, INTERVIEW_INPUT_LIMITS.question)
      return text && !o?.aiGenerated && CATEGORIES.has(o?.category as Category) ? [{ text, category: o.category as Category }] : []
    }).slice(0, 10)
    const job = jobs.get(str(appsById.get(str(doc.applicationId))?.jobId))
    if (given.length >= 3 && job) {
      const target = Math.min(INTERVIEW_INPUT_LIMITS.questionsMax, given.length + 2)
      add({ task: 'interview-tuning', given: given.length, target }, group, {
        system: tuningSystemPrompt(),
        user: tuningUserMessage({ jobTitle: str(job.title), jobSkills: (job.skills as string[] | undefined) ?? [], jobDescription: maskLeftoverContacts(str(job.description)), cvSummary: '', questions: given, targetCount: target }),
      }, key, 'tuning')
    }
  }

  // Génération des questions : offre et résumé de screening d'une candidature, questions par défaut de l'organisation.
  const defaults = DEFAULT_GENERIC_QUESTIONS.filter(q => q.enabled)
  const withSummary = apps.filter(a => str(a.aiSummary).trim() && jobs.has(str(a.jobId)))
  for (const app of pick(withSummary, 60, `questions:${project}`)) {
    const job = jobs.get(str(app.jobId))
    const person = people.get(str(app.candidateId)) ?? { first: '', last: '' }
    const summary = maskLeftoverContacts(pseudonymize(str(app.aiSummary), [person]))
    if (keepsRealName(summary, person)) { note('interview-questions', 'nom resté après remplacement'); continue }
    const total = [8, 10, 12][parseInt(rank('total', app.$id).slice(0, 2), 16) % 3]
    const input = questionsInputSchema.parse({
      jobTitle: str(job?.title), jobDescription: maskLeftoverContacts(str(job?.description)), jobSkills: (job?.skills as string[] | undefined) ?? [],
      cvSummary: summary, questionCount: total,
    })
    const plan = aiQuestionPlan(input.questionCount, defaults.map(q => q.category))
    add({ task: 'interview-questions', count: plan.count }, `candidature:${textKey(summary)}`, questionGenerationPrompt({ ...input, defaultQuestions: defaults, plan }), textKey(summary), str(app.jobId), String(total))
  }
  return { items, stats }
}
