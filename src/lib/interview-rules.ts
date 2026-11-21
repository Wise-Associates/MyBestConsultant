import { z } from 'zod'

// Entretiens IA et screening des CV : bornes des textes envoyés à l'IA et quotas du jour (revue de sécurité du
// 2026-11-13 : ces appels n'avaient ni quota ni borne, un compte gratuit pouvait faire travailler l'IA sans limite).
// Règles pures, testées dans interview-rules.test.ts ; appliquées par src/lib/interview-access.ts et les actions.

export const INTERVIEW_INPUT_LIMITS = {
  title: 300, longText: 30_000, skills: 50, skill: 100, questionsMin: 3, questionsMax: 15, question: 1000, answer: 8000, turn: 4000, turns: 200,
} as const
const L = INTERVIEW_INPUT_LIMITS

/** Texte venu du navigateur, coupé à `max` caractères : une description d'offre importée peut être longue (60 000). */
const clipped = (max: number) => z.string().transform(s => s.slice(0, max))

/** Génération des questions d'un entretien. */
export const questionsInputSchema = z.object({
  jobTitle: clipped(L.title),
  jobDescription: clipped(L.longText),
  jobSkills: z.array(clipped(L.skill)).transform(list => list.slice(0, L.skills)),
  cvSummary: clipped(L.longText),
  questionCount: z.number().int().min(L.questionsMin).max(L.questionsMax),
})

/** Retranscription enregistrée sur l'entretien : l'attribut `interviews.transcript` tient 67 000 caractères. */
export const TRANSCRIPT_MAX_JSON = 60_000

const turnSchema = z.object({
  role: z.enum(['interviewer', 'candidate']),
  content: clipped(L.turn),
  timestamp: z.string().max(40),
  audioFileId: z.string().max(36).optional(),
})

const questionSchema = z.object({
  id: z.string().max(40),
  text: clipped(L.question),
  category: z.enum(['intro', 'technical', 'behavioral', 'motivation', 'closing']),
  aiGenerated: z.boolean(),
})

/** Relance pendant un entretien : seules les 4 dernières répliques sont lues par l'IA. */
export const followUpInputSchema = z.object({
  transcript: z.array(turnSchema).max(L.turns).transform(list => list.slice(-4)),
  currentQuestion: questionSchema,
  candidateAnswer: clipped(L.answer),
})

/**
 * Retranscription envoyée par la salle d'entretien : 200 répliques au plus, et assez courte pour être enregistrée (avant :
 * jusqu'à 800 000 caractères envoyés à l'IA pour une seule analyse, puis refusés par la base sans message).
 */
export const transcriptTurnsSchema = z.array(turnSchema).max(L.turns)
export const transcriptSchema = transcriptTurnsSchema
  .refine(list => JSON.stringify(list).length <= TRANSCRIPT_MAX_JSON, 'Retranscription trop longue.')

/** Analyse d'un entretien terminé (retranscription enregistrée avec l'analyse). */
export const analysisInputSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{1,36}$/),
  transcript: transcriptSchema,
  jobTitle: clipped(L.title),
  jobSkills: z.array(clipped(L.skill)).transform(list => list.slice(0, L.skills)),
})

/** Session d'entretien créée par un recruteur (texte affiché au candidat et repris dans son invitation). */
export const sessionInputSchema = z.object({
  candidateName: z.string().trim().max(120),
  // Vide pour une candidature dont le profil n'a pas d'adresse (vivier d'un chasseur) : l'invitation passe par la candidature.
  candidateEmail: z.union([z.literal(''), z.string().trim().email().max(254)]),
  jobTitle: z.string().trim().min(1).max(200),
  questions: z.array(questionSchema).min(1).max(30),
})

type QuestionCategory = 'intro' | 'technical' | 'behavioral' | 'motivation' | 'closing'

/**
 * Questions à faire écrire par l'IA pour un entretien de `total` questions, dont `defaults` sont les questions par défaut
 * de l'organisation (leurs catégories). Le nombre choisi est celui de tout l'entretien : avant le 2026-11-21, les questions
 * par défaut s'ajoutaient au nombre choisi (8 demandées, 13 obtenues). Répartition par catégorie, sans refaire une
 * introduction ou une clôture déjà posées ; 0 : l'IA n'est pas appelée.
 */
export function aiQuestionPlan(total: number, defaults: readonly QuestionCategory[]): { count: number; mix: Partial<Record<QuestionCategory, number>> } {
  const count = Math.max(0, total - defaults.length)
  if (count === 0) return { count, mix: {} }
  const has = (category: QuestionCategory) => defaults.includes(category)
  const intro = !has('intro') && count >= 3 ? 1 : 0
  const closing = !has('closing') && count >= 3 ? 1 : 0
  const rest = count - intro - closing
  const motivation = has('motivation') ? 0 : Math.round(rest * 0.2)
  const behavioral = Math.round((rest - motivation) * (has('behavioral') ? 0.25 : 0.4))
  const technical = rest - motivation - behavioral
  const mix: Partial<Record<QuestionCategory, number>> = {}
  for (const [category, n] of Object.entries({ intro, technical, behavioral, motivation, closing }) as [QuestionCategory, number][]) {
    if (n > 0) mix[category] = n
  }
  return { count, mix }
}

/** Invitations à un entretien envoyées par jour (UTC) et par organisation : chacune part du domaine de la plateforme. */
export const INTERVIEW_INVITE_DAILY_LIMIT = 100

/**
 * Fichiers de questions d'entretien importés par jour (ADR 0054), par organisation et pour toutes : chaque lecture d'un PDF
 * coûte au serveur (revue de sécurité du 2026-11-21 ; l'inscription est libre).
 */
export const INTERVIEW_IMPORT_DAILY_LIMITS = { organisation: 50, allOrganisations: 1000 } as const

/** Candidatures analysées en une demande de screening (écran du screening, pipeline). */
export const SCREENING_BATCH_MAX = 100

/** Identifiants de candidatures d'une demande de screening : valides, sans doublon, 100 au plus ; null si invalides. */
export function screeningBatch(appIds: unknown): string[] | null {
  const parsed = z.array(z.string().regex(/^[\w-]{1,36}$/)).max(SCREENING_BATCH_MAX * 2).safeParse(appIds)
  return parsed.success ? [...new Set(parsed.data)].slice(0, SCREENING_BATCH_MAX) : null
}

/**
 * Appels à l'IA des entretiens et du screening manuel par jour (UTC) : par organisation (quota de la formule,
 * `interviewAi`, plans.ts) et pour toutes ensemble. Le screening automatique d'une candidature reçue n'est pas compté.
 */
export const INTERVIEW_AI_DAILY_LIMITS = { allOrganisations: 5000 } as const

export const INTERVIEW_AI_REFUSAL = {
  unverified: 'Vérifiez votre adresse e-mail (lien reçu à l\'inscription) pour utiliser les entretiens IA et le screening.',
  organisation: (limit: number) => `Limite de ${limit} analyses par l'IA (entretiens et screening) par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop d\'analyses par l\'IA aujourd\'hui sur la plateforme : réessayez demain.',
} as const
