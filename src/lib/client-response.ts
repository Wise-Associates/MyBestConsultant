import { z } from 'zod'
import { alignToColumn, FUNNEL_LIMITS, hasReport, stepColumn, type FunnelStep } from './candidate-funnel'
import type { FunnelStage } from '@/types'

// Réponse client d'une offre (demande du 2026-11-17) : le recruteur envoie au client une sélection de candidats du funnel,
// chacun avec sa fiche (profil anonymisé, parcours, adéquation au poste, comptes rendus des étapes validées : client-sheet.ts).
// MBC n'envoie rien lui-même (choix du 2026-11-17) : il note l'envoi et donne les fiches à imprimer (PDF), que le recruteur
// transmet ; puis il enregistre la réponse du client.
// « Retenu » fait passer le candidat dans « Embauchés ». Stocké dans `applications.clientJson`. Règles pures, testées dans
// client-response.test.ts.

export const CLIENT_RESPONSES = ['pending', 'interview', 'rejected', 'retained'] as const
export type ClientResponse = (typeof CLIENT_RESPONSES)[number]
/** Réponses que le recruteur enregistre (« En attente » est l'état à l'envoi). */
export type ClientAnswer = Exclude<ClientResponse, 'pending'>

export const CLIENT_RESPONSE_LABEL: Record<ClientResponse, string> = {
  pending: 'En attente', interview: 'Entretien demandé', rejected: 'Refusé', retained: 'Retenu',
}
/** Colonne « Refusé » : ses candidats ne sont pas proposés au client. */
export const REJECTED_COLUMN = 'rejected'
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

/**
 * Client d'une offre (demande du 2026-11-17) : société, contact et e-mail, renseignés une fois dans « Réponse client ».
 * MBC n'écrit pas au client : « Écrire au client » ouvre la messagerie du recruteur, adresse, objet et texte préremplis
 * (`clientMailto`). Stocké dans la collection `job_clients` (src/lib/appwrite/job-clients.ts).
 */
export const jobClientSchema = z.object({
  company: z.string().trim().max(200),
  contactName: z.string().trim().max(120),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(254)]),
})
export type JobClient = z.infer<typeof jobClientSchema>
export const isEmptyClient = (c: JobClient) => !c.company && !c.contactName && !c.email

/** Lien « Écrire au client » : null sans e-mail. `count` : candidats proposés dans ce message (0 : message général). */
export function clientMailto(client: JobClient, jobTitle: string, count: number): string | null {
  if (!client.email) return null
  const subject = count > 0 ? `Candidats proposés : ${jobTitle}` : jobTitle
  const body = [
    `Bonjour${client.contactName ? ` ${client.contactName}` : ''},`,
    '',
    count > 0
      ? `Vous trouverez ci-joint ${count > 1 ? `les fiches des ${count} candidats` : 'la fiche du candidat'} que nous vous proposons pour le poste « ${jobTitle} ».`
      : `Je reviens vers vous au sujet du poste « ${jobTitle} ».`,
    '',
    'Cordialement,',
  ].join('\n')
  return `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

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
 * Envoi d'une candidature au client : tout candidat du funnel de l'offre, sauf un candidat refusé (choix du 2026-11-17 ; le
 * compte rendu n'est plus exigé : la fiche présente aussi le profil et l'adéquation au poste). Refusé s'il a déjà été envoyé.
 * Les étapes validées avec un compte rendu sont notées : elles forment la partie « comptes rendus » de la fiche.
 */
export function newSubmission(steps: FunnelStep[], column: string, existing: ClientSubmission | null, who: string, now: Date):
  { submission: ClientSubmission } | { error: string } {
  if (existing) return { error: 'déjà envoyé au client' }
  if (column === REJECTED_COLUMN) return { error: 'candidat refusé' }
  return { submission: { sentAt: now.toISOString(), sentBy: who.slice(0, 100), stepIds: synthesisSteps(steps).map(s => s.id), response: 'pending' } }
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
