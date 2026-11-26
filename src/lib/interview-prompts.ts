import { parseModelJson } from '@/lib/ai/model-json'
import { ROOM_LIMITS } from '@/lib/interview-room'
import type { aiQuestionPlan } from '@/lib/interview-rules'
import type { InterviewAnalysis, InterviewQuestion } from '@/app/recruiter/interviews/actions'
import type { InterviewDetail } from '@/app/admin/interviews/actions'

// Consignes envoyées à l'IA par les entretiens (module « Entretiens IA ») et lecture de ses réponses, en fonctions pures.
// Elles étaient écrites dans les actions ('use server', qui n'exportent que des fonctions async) et dans un module
// server-only : un script Node ne pouvait pas les reproduire. Le jeu d'exemples d'affinage doit envoyer au modèle
// exactement le même texte que l'application et juger une réponse comme elle : il passe par ces fonctions, les actions
// aussi. Changer un texte ici change donc aussi ce que l'affinage a appris (refaire l'export). Testé dans
// interview-prompts.test.ts.

/** Consigne (message système) et message de l'utilisateur d'un appel à callLLM. */
export interface InterviewPrompt {
  system: string
  user: string
}

/** Réplique d'une retranscription, telle que la lisent les consignes. */
export interface PromptTurn {
  role: 'interviewer' | 'candidate'
  content: string
}

/**
 * Réponse en texte libre où « null » veut dire « rien à dire » (réponse à la question du candidat, relances) : le texte
 * sans espaces autour, ou null pour « null » ou une réponse vide.
 */
export function nullableReply(content: string): string | null {
  const text = content.trim()
  return text === 'null' || text === '' ? null : text
}

// ── Salle du candidat (/interview/<session>) ─────────────────────

/**
 * Créneau « Avez-vous des questions ? » : une vraie question du candidat reçoit une réponse qui clôt l'échange, sans
 * nouvelle question (la relance générique faisait boucler l'entretien). Poste (200 caractères) et message
 * (ROOM_LIMITS.answer) coupés ici : la consigne de l'affinage est ainsi celle de la salle. Réponse : nullableReply.
 */
export function closingAnswerPrompt(input: { jobTitle: string; candidateMessage: string }): InterviewPrompt {
  const jobTitle = input.jobTitle.slice(0, 200)
  const message = input.candidateMessage.slice(0, ROOM_LIMITS.answer)
  return {
    system: `Tu es Alex, un recruteur IA bienveillant pour le poste de "${jobTitle}".
Si le message contient une vraie question du candidat, réponds-y brièvement et utilement (2-3 phrases maximum), sans poser de nouvelle question en retour.
Si le candidat n'a pas de question (ex: "non merci", "pas de question"), réponds exactement : null.
Réponds uniquement avec la réponse à donner au candidat (texte simple, sans guillemets), ou le mot "null".`,
    user: `Message du candidat en réponse à "Avez-vous des questions ?" : "${message}"`,
  }
}

/**
 * Relance après une réponse du candidat, dans sa salle : question de l'entretien (1 000 caractères) et réponse
 * (ROOM_LIMITS.answer), sans le reste de la retranscription. Réponse : nullableReply.
 */
export function candidateFollowUpPrompt(input: { question: string; answer: string }): InterviewPrompt {
  return {
    system: `Tu es un interviewer IA expert et bienveillant. Analyse la réponse du candidat.
Si la réponse est incomplète ou mérite d'être approfondie, génère UNE courte question de relance.
Si la réponse est complète, réponds exactement : null
Réponds soit avec la question de relance (texte simple, sans guillemets), soit avec le mot "null".`,
    user: `Question posée : "${input.question.slice(0, 1000)}"\nRéponse du candidat : "${input.answer.slice(0, ROOM_LIMITS.answer)}"`,
  }
}

// ── Espace recruteur (/recruiter/interviews) ─────────────────────
// Textes déjà bornés par les schémas de src/lib/interview-rules.ts (questionsInputSchema, followUpInputSchema,
// analysisInputSchema) : un appelant hors des actions doit les y faire passer pour obtenir le même texte.

/**
 * Questions écrites par l'IA pour compléter les questions par défaut de l'organisation (`defaultQuestions`, qu'elle ne
 * doit pas répéter) jusqu'au nombre choisi : `plan` est aiQuestionPlan(nombre choisi, catégories des questions par
 * défaut). Réponse : parseGeneratedQuestions.
 */
export function questionGenerationPrompt(input: {
  jobTitle: string
  jobSkills: readonly string[]
  jobDescription: string
  cvSummary: string
  defaultQuestions: readonly { text: string }[]
  plan: ReturnType<typeof aiQuestionPlan>
}): InterviewPrompt {
  const { plan } = input
  const mix = Object.entries(plan.mix).map(([category, n]) => `- ${n} ${category}`).join('\n')
  const system = `Tu es un expert RH spécialisé dans les entretiens IT et conseil.
Génère des questions d'entretien pertinentes et retourne un JSON valide.

Réponds UNIQUEMENT avec un tableau JSON :
[
  {
    "id": "q1",
    "text": "string — question claire et précise",
    "category": "intro"|"technical"|"behavioral"|"motivation"|"closing"
  }
]

Répartition des ${plan.count} questions :
${mix}

Adapte les questions techniques aux compétences requises.
Utilise la méthode STAR pour les questions comportementales.`

  const already = input.defaultQuestions.length > 0
    ? `\n\nQUESTIONS DÉJÀ POSÉES (ne les répète pas) :\n${input.defaultQuestions.map(q => `- ${q.text}`).join('\n')}`
    : ''
  return {
    system,
    user: `POSTE : ${input.jobTitle}\nCompétences : ${input.jobSkills.join(', ')}\nDescription : ${input.jobDescription}\n\nRÉSUMÉ CV : ${input.cvSummary}${already}\n\nGénère exactement ${plan.count} questions.`,
  }
}

/**
 * Questions de la réponse de l'IA (du premier « [ » au dernier « ] »), `count` au plus, marquées aiGenerated et
 * numérotées q1, q2… quand l'IA n'a pas mis d'identifiant ; null sans tableau. Un JSON illisible lève l'erreur de
 * parseModelJson (l'action rend son message). Le contenu des questions n'est pas vérifié.
 */
export function parseGeneratedQuestions(content: string, count: number): InterviewQuestion[] | null {
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return null
  // L'IA peut en rendre plus que demandé : l'entretien garde exactement le nombre choisi.
  return (parseModelJson(jsonMatch[0]) as InterviewQuestion[]).slice(0, count).map((q: InterviewQuestion, i: number) => ({
    ...q,
    id: q.id ?? `q${i + 1}`,
    aiGenerated: true,
  }))
}

/**
 * Relance pendant un entretien mené par le recruteur : question, réponse et `recentTurns`, les 4 dernières répliques
 * (followUpInputSchema les coupe). Réponse : nullableReply.
 */
export function recruiterFollowUpPrompt(input: { question: string; answer: string; recentTurns: readonly PromptTurn[] }): InterviewPrompt {
  const lastAnswers = input.recentTurns.map(t => `${t.role === 'interviewer' ? 'Q' : 'R'}: ${t.content}`).join('\n')
  return {
    system: `Tu es un interviewer IA expert. Analyse la réponse du candidat.
Si la réponse est incomplète, vague ou mérite d'être approfondie, génère UNE question de relance courte et précise.
Si la réponse est complète et satisfaisante, réponds exactement : null

Réponds soit avec la question de relance (texte simple), soit avec le mot "null".`,
    user: `Question posée : "${input.question}"\nRéponse du candidat : "${input.answer}"\n\nContexte récent :\n${lastAnswers}`,
  }
}

/** Analyse demandée par le recruteur à la fin d'un entretien qu'il a mené. Réponse : parseRecruiterAnalysis. */
export function recruiterAnalysisPrompt(input: { jobTitle: string; jobSkills: readonly string[]; transcript: readonly PromptTurn[] }): InterviewPrompt {
  const transcriptText = input.transcript
    .map(t => `[${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDAT'}] ${t.content}`)
    .join('\n')
  return {
    system: `Tu es un expert RH analysant la retranscription d'un entretien. Retourne un JSON valide uniquement.

{
  "overallScore": number (0-100),
  "communicationScore": number (0-100),
  "technicalScore": number (0-100),
  "motivationScore": number (0-100),
  "culturalFitScore": number (0-100),
  "recommendation": "hire"|"consider"|"reject",
  "keyInsights": ["string"] (max 5 observations clés positives),
  "redFlags": ["string"] (max 3 signaux d'alerte),
  "summary": "string (3-4 phrases de synthèse)",
  "nextSteps": ["string"] (2-3 recommandations d'actions)
}`,
    user: `POSTE : ${input.jobTitle}\nCompétences requises : ${input.jobSkills.join(', ')}\n\nRETRANSCRIPTION :\n${transcriptText}`,
  }
}

const score = (value: unknown) => Math.min(100, Math.max(0, Number(value) || 0))

/**
 * Analyse de la réponse de l'IA (du premier « { » au dernier « } ») : notes ramenées entre 0 et 100 (0 si absentes),
 * listes coupées (5 points forts, 3 alertes, 3 étapes), « consider » sans recommandation ; `analysedBy` est le modèle
 * qui a répondu. null sans objet ; un JSON illisible lève l'erreur de parseModelJson (l'action rend son message).
 */
export function parseRecruiterAnalysis(content: string, analysedBy: string): InterviewAnalysis | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  const parsed = parseModelJson(jsonMatch[0]) as Partial<InterviewAnalysis>
  return {
    overallScore: score(parsed.overallScore),
    communicationScore: score(parsed.communicationScore),
    technicalScore: score(parsed.technicalScore),
    motivationScore: score(parsed.motivationScore),
    culturalFitScore: score(parsed.culturalFitScore),
    recommendation: parsed.recommendation ?? 'consider',
    keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights.slice(0, 5) : [],
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.slice(0, 3) : [],
    summary: String(parsed.summary ?? ''),
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.slice(0, 3) : [],
    analysedBy,
  }
}

// ── Analyse automatique à la fin d'un entretien (src/lib/interview-analysis.ts) ──

/**
 * Analyse lancée à la fin de l'entretien du candidat (ou par « Analyser » côté admin) : pas de message système, tout est
 * dans le message de l'utilisateur. Retranscription entière, telle qu'enregistrée sur l'entretien. Réponse :
 * parseInterviewEndAnalysis.
 */
export function interviewEndAnalysisPrompt(input: { jobTitle: string; transcript: readonly PromptTurn[] }): { user: string } {
  const convo = input.transcript.map(t =>
    `${t.role === 'interviewer' ? 'Alex (recruteur)' : 'Candidat'}: ${t.content}`
  ).join('\n\n')
  return {
    user: `Tu es un expert RH. Analyse cette transcription d'entretien pour le poste "${input.jobTitle}".

TRANSCRIPTION:
${convo}

Réponds UNIQUEMENT avec ce JSON valide (sans markdown, sans commentaires):
{
  "overallScore": <0-100>,
  "communicationScore": <0-100>,
  "technicalScore": <0-100>,
  "motivationScore": <0-100>,
  "culturalFitScore": <0-100>,
  "recommendation": <"hire"|"consider"|"reject">,
  "summary": "<résumé en 2-3 phrases>",
  "keyInsights": ["<point fort 1>", "<point fort 2>", "<point fort 3>"],
  "redFlags": ["<point attention 1>"],
  "nextSteps": ["<étape 1>", "<étape 2>"],
  "analysedBy": "Claude AI"
}`,
  }
}

/**
 * JSON de la réponse, sans les balises de code Markdown qui l'entourent parfois. Un JSON illisible lève l'erreur de
 * parseModelJson ; la forme n'est pas vérifiée (enregistrée telle quelle sur l'entretien).
 */
export function parseInterviewEndAnalysis(content: string): InterviewDetail['analysis'] {
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  return parseModelJson(raw) as InterviewDetail['analysis']
}
