// Consignes du compte rendu d'étape proposé par l'IA dans le funnel d'un candidat (pipeline d'une offre, « Rédiger le
// compte rendu »). Pur (aucun accès base ni session) : l'action generateStepReportAction
// (src/app/recruiter/pipeline/[jobId]/actions.ts) l'appelle, et un script d'exemples d'affinage peut reproduire à
// l'octet près ce qui est envoyé au modèle, puis nettoyer une réponse comme l'application.
import { STEP_TYPES, type FunnelStep, type StepResult } from './candidate-funnel'

const REPORT_SYSTEM = `Tu es un assistant de recrutement. Rédige un COMPTE RENDU D'ÉTAPE en français, factuel et professionnel, de 80 à 140 mots, en 3 courts paragraphes : « Synthèse », « Points forts », « Points de vigilance ». Termine par une ligne « Recommandation : » (favorable, réservée ou défavorable) cohérente avec le résultat indiqué.
Appuie-toi UNIQUEMENT sur les éléments fournis. N'invente aucun fait. S'il y a peu d'éléments, rédige un compte rendu court et termine par « À compléter par le recruteur ». Pas de markdown, pas d'emoji.`

/** Analyse d'un entretien IA telle que lue dans `interviews.analysis` (JSON) : seuls ces champs entrent dans la demande. */
export interface InterviewAnalysisFacts {
  overallScore?: number
  summary?: string
  recommendation?: string
}

export interface StepReportInput {
  /** Intitulé de l'offre ; absent si l'offre est introuvable. */
  jobTitle?: string
  /** Étape dont on rédige le compte rendu. */
  step: Pick<FunnelStep, 'label' | 'type'>
  /** Toutes les étapes du funnel du candidat : les comptes rendus des étapes validées servent de contexte (3 derniers). */
  funnelSteps: Pick<FunnelStep, 'label' | 'status' | 'report'>[]
  /** Résultat choisi par le recruteur dans la fenêtre (pas encore enregistré). */
  result?: StepResult
  /** Notes saisies par le recruteur dans la fenêtre (pas encore enregistrées). */
  notes?: string
  /** Note de la candidature (`applications.note`). */
  applicationNote?: string | null
  /** Screening IA de la candidature (`applications.aiScore`, `applications.aiSummary`). */
  aiScore?: number | null
  aiSummary?: string | null
  /** Analyses des derniers entretiens IA de la candidature, du plus récent au plus ancien (3 au plus). */
  interviewAnalyses: (InterviewAnalysisFacts | null)[]
}

/** Demande du compte rendu : ce que l'on sait du candidat, chaque bloc coupé pour garder une demande courte. */
export function stepReportPrompt(input: StepReportInput): { system: string; user: string } {
  // Ce que l'on sait déjà : screening IA et derniers entretiens IA analysés
  const facts: string[] = []
  if (typeof input.aiScore === 'number') facts.push(`Screening IA : score ${input.aiScore}/100. ${input.aiSummary ?? ''}`.trim())
  for (const a of input.interviewAnalyses) {
    if (a?.summary) facts.push(`Entretien IA : score ${a.overallScore ?? '?'}/100, recommandation ${a.recommendation ?? '?'}. ${a.summary}`)
  }
  const prior = input.funnelSteps.filter(s => s.status === 'validated' && s.report).map(s => `${s.label} : ${s.report}`).slice(-3)
  const resultLabel = input.result === 'positive' ? 'favorable' : input.result === 'neutral' ? 'réservé' : input.result === 'negative' ? 'défavorable' : 'non précisé'
  const notes = input.notes?.trim()

  const user = [
    `Poste : ${input.jobTitle ?? ''}`,
    `Étape : ${input.step.label} (${STEP_TYPES[input.step.type].description})`,
    `Résultat indiqué par le recruteur : ${resultLabel}`,
    notes ? `Notes du recruteur : ${notes.slice(0, 800)}` : '',
    input.applicationNote ? `Note sur la candidature : ${input.applicationNote.slice(0, 400)}` : '',
    facts.length ? `Éléments connus :\n${facts.join('\n').slice(0, 1800)}` : '',
    prior.length ? `Comptes rendus des étapes précédentes :\n${prior.join('\n').slice(0, 900)}` : '',
  ].filter(Boolean).join('\n')
  return { system: REPORT_SYSTEM, user }
}

/** Réponse du modèle : texte libre, sans gras markdown, 1 200 caractères au plus. Vide : rien d'utilisable. */
export function cleanStepReport(text: string): string {
  return text.replace(/\*\*/g, '').trim().slice(0, 1200)
}
