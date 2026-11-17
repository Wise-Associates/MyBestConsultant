import { z } from 'zod'
import { alignToColumn, FUNNEL_LIMITS, hasReport, stepColumn, type FunnelStep } from './candidate-funnel'
import type { FunnelStage } from '@/types'

// Réponse client d'une offre (demande du 2026-11-17) : le recruteur envoie au client une sélection de candidats, avec la
// synthèse des comptes rendus des étapes validées de leur funnel. MBC n'envoie rien lui-même (choix du 2026-11-17) : il
// note l'envoi et donne la synthèse à imprimer (PDF), que le recruteur transmet ; puis il enregistre la réponse du client.
// « Retenu » fait passer le candidat dans « Embauchés ». Stocké dans `applications.clientJson`. Règles pures, testées dans
// client-response.test.ts.

export const CLIENT_RESPONSES = ['pending', 'interview', 'rejected', 'retained'] as const
export type ClientResponse = (typeof CLIENT_RESPONSES)[number]
/** Réponses que le recruteur enregistre (« En attente » est l'état à l'envoi). */
export type ClientAnswer = Exclude<ClientResponse, 'pending'>

export const CLIENT_RESPONSE_LABEL: Record<ClientResponse, string> = {
  pending: 'En attente', interview: 'Entretien demandé', rejected: 'Refusé', retained: 'Retenu',
}
/** Commentaire du client ; candidats envoyés en une fois. */
export const CLIENT_LIMITS = { comment: 500, batch: 50 } as const

const submissionSchema = z.object({
  sentAt: z.string().max(40),
  sentBy: z.string().max(100),
  /** Étapes envoyées : validées, donc figées (customizedFunnel) ; la synthèse reste celle envoyée même si le funnel avance. */
  stepIds: z.array(z.string().max(8)).max(FUNNEL_LIMITS.steps),
  response: z.enum(CLIENT_RESPONSES),
  comment: z.string().max(CLIENT_LIMITS.comment).optional(),
  respondedAt: z.string().max(40).optional(),
  respondedBy: z.string().max(100).optional(),
})
export type ClientSubmission = z.infer<typeof submissionSchema>

/** Envoi enregistré d'une candidature ; null si elle n'a pas été envoyée (ou si la valeur est illisible). */
export function parseClientSubmission(raw: unknown): ClientSubmission | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = submissionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null // valeur abîmée : traitée comme non envoyée, elle peut être renvoyée
  }
}

export const serializeClientSubmission = (submission: ClientSubmission) => JSON.stringify(submission)

/** Étapes d'une synthèse : validées et avec un compte rendu, dans l'ordre du funnel. */
export const synthesisSteps = (steps: FunnelStep[]) => steps.filter(s => s.status === 'validated' && hasReport(s))

/**
 * Synthèse envoyée au client : les étapes notées à l'envoi, dans l'ordre du funnel. Toujours validées (une étape validée
 * ne se modifie plus : customizedFunnel) ; le filtre le vérifie encore.
 */
export const sentSteps = (steps: FunnelStep[], submission: ClientSubmission) =>
  synthesisSteps(steps).filter(s => submission.stepIds.includes(s.id))

/**
 * Envoi d'une candidature au client : refusé si elle l'a déjà été, ou si aucune étape de son funnel n'est validée avec un
 * compte rendu (choix du 2026-11-17 : la synthèse n'est jamais vide).
 */
export function newSubmission(steps: FunnelStep[], existing: ClientSubmission | null, who: string, now: Date):
  { submission: ClientSubmission } | { error: string } {
  if (existing) return { error: 'déjà envoyé au client' }
  const sent = synthesisSteps(steps)
  if (sent.length === 0) return { error: 'aucune étape validée avec un compte rendu' }
  return { submission: { sentAt: now.toISOString(), sentBy: who.slice(0, 100), stepIds: sent.map(s => s.id), response: 'pending' } }
}

/** Réponse du client et son commentaire (facultatif), enregistrés sur l'envoi. */
export function withResponse(submission: ClientSubmission, response: ClientAnswer, comment: string, who: string, now: Date): ClientSubmission {
  const text = comment.replace(/\s+/g, ' ').trim().slice(0, CLIENT_LIMITS.comment)
  return { ...submission, response, comment: text || undefined, respondedAt: now.toISOString(), respondedBy: who.slice(0, 100) }
}

/**
 * Candidat retenu par le client : il passe dans la colonne de l'étape « Embauché » de son funnel (« accepted » s'il n'en
 * a pas, son parcours étant alors clos). Les étapes non faites avant elle sont « passées » et l'embauche est validée, avec la réponse du client comme
 * compte rendu : la décision vient du client, la règle du compte rendu (stepBlockingMove) ne la bloque pas.
 */
export function retainedFunnel(steps: FunnelStep[], stages: Pick<FunnelStage, 'slug' | 'autoAction'>[], comment: string, who: string, now: Date):
  { steps: FunnelStep[]; column: string } {
  const hired = steps.find(s => s.type === 'hired')
  // Sans étape d'embauche, le parcours est clos : les étapes non faites sont « passées », sinon l'étape en cours (sans
  // compte rendu) bloquerait toute sortie d'« Embauchés » (stepBlockingMove).
  if (!hired) return { steps: steps.map(s => (s.status === 'validated' || s.status === 'skipped' ? s : { ...s, status: 'skipped' as const })), column: 'accepted' }
  const column = stepColumn(hired, stages)
  if (hired.status === 'validated') return { steps, column }
  const text = comment.replace(/\s+/g, ' ').trim()
  const report = `Retenu par le client${text ? ` : « ${text} »` : '.'}`.slice(0, FUNNEL_LIMITS.report)
  return {
    column,
    steps: alignToColumn(steps, column).map(s => s.id === hired.id
      ? { ...s, status: 'validated' as const, result: 'positive' as const, report, reportBy: 'manual' as const, validatedAt: now.toISOString(), validatedBy: who.slice(0, 100) }
      : s),
  }
}
