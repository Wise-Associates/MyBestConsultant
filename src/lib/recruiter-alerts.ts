import { createHash } from 'node:crypto'

// Alertes « profil idéal » du recruteur (ADR 0045, demande du 2026-11-18) : un candidat noté IDEAL_SCORE ou plus pour une
// offre déclenche un e-mail au recruteur concerné, une seule fois par candidat et par offre, et une ligne dans la page
// « Alertes » (/recruiter/alertes). Règles et contenu de l'e-mail purs, testés dans recruiter-alerts.test.ts ; lecture,
// écriture et envoi : recruiter-alerts-store.ts.

/** Seuil du « profil idéal » : le niveau « top » des recommandations (recommendationFor, match-scoring.ts). */
export const IDEAL_SCORE = 85

/**
 * D'où vient le score : une candidature reçue (sujet = candidature), un candidat de la base (sujet = profil du candidat),
 * un CV d'un vivier, de l'offre ou général (sujet = CV du vivier).
 */
export type JobAlertSource = 'candidature' | 'base' | 'vivier'

/** Alerte d'une offre (score) ou d'une recherche enregistrée de la CV Thèque (ADR 0046, sujet = profil du candidat). */
export type AlertSource = JobAlertSource | 'recherche'

export const ALERT_SOURCE_LABEL: Record<AlertSource, string> = {
  candidature: 'Candidature',
  base: 'Base candidats',
  vivier: 'Vivier',
  recherche: 'Recherche enregistrée',
}

/**
 * État de l'e-mail : en cours (alerte enregistrée, e-mail pas encore confirmé — resté ainsi, l'envoi a été interrompu),
 * envoyé, en échec (journalisé), ou non envoyé parce que le recruteur a coupé ses alertes.
 */
export type AlertEmailStatus = 'pending' | 'sent' | 'failed' | 'off'

export const ALERT_EMAIL_STATUS_LABEL: Record<AlertEmailStatus, string> = {
  pending: 'E-mail non confirmé',
  sent: 'E-mail envoyé',
  failed: 'E-mail non envoyé',
  off: 'Sans e-mail',
}

export const parseAlertEmailStatus = (value: unknown): AlertEmailStatus =>
  value === 'sent' || value === 'failed' || value === 'off' ? value : 'pending'

export const parseAlertSource = (value: unknown): AlertSource | null =>
  value === 'candidature' || value === 'base' || value === 'vivier' || value === 'recherche' ? value : null

export interface IdealCandidate {
  jobId: string
  source: JobAlertSource
  /** Candidature, profil du candidat de la base, ou CV du vivier, selon `source`. */
  subjectId: string
  /** Profil du candidat d'une candidature : une même personne ne déclenche qu'une alerte, qu'elle postule ou soit dans la base. */
  candidateId?: string
  score: number
  /** Profil (users.$id) du recruteur à prévenir ; absent : le recruteur affecté à l'offre, sinon son auteur. */
  recipientId?: string
}

export const isIdealScore = (score: unknown): score is number => typeof score === 'number' && Number.isFinite(score) && score >= IDEAL_SCORE

/** Personne visée : un candidat de la plateforme (candidature ou base) ou un CV du vivier. */
export function alertSubjectKey(candidate: { source: AlertSource; subjectId: string; candidateId?: string }): string {
  if (candidate.source === 'vivier') return `vivier:${candidate.subjectId}`
  if (candidate.source === 'candidature') return `candidat:${candidate.candidateId || `candidature:${candidate.subjectId}`}`
  return `candidat:${candidate.subjectId}`
}

/**
 * Identifiant du document d'alerte, tiré de l'offre, du recruteur et de la personne : la créer une seconde fois échoue
 * (409), si bien que deux notations, simultanées ou successives, n'envoient qu'un e-mail.
 */
export function alertDocId(jobId: string, recipientId: string, subjectKey: string): string {
  return `al${createHash('sha256').update(`${jobId}:${recipientId}:${subjectKey}`).digest('hex').slice(0, 34)}`
}

/** Page du profil dans l'espace recruteur. */
export function alertProfilePath(source: AlertSource, subjectId: string): string {
  if (source === 'candidature') return `/recruiter/candidates/${subjectId}`
  return `/recruiter/candidate-preview/${source === 'vivier' ? 'vivier' : 'pool'}/${subjectId}`
}

/** Préférence du compte : alertes envoyées par e-mail sauf si le recruteur les a coupées (false explicite). */
export const alertEmailsEnabled = (pref: unknown): boolean => pref !== false

export interface IdealCandidateEmailInput {
  recipientName: string
  candidateName: string
  jobTitle: string
  score: number
  source: JobAlertSource
  /** Adresses absolues du profil et de la page des alertes. */
  profileUrl: string
  alertsUrl: string
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const paragraph = 'margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;'
const MAX_SUBJECT_TITLE = 100

const SOURCE_SENTENCE: Record<JobAlertSource, string> = {
  candidature: 'a postulé à votre offre',
  base: 'inscrit sur la plateforme, correspond à votre offre',
  vivier: 'dont vous avez importé le CV dans votre vivier, correspond à l’offre',
}

/** Objet, titre et corps de l'e-mail (à envelopper par wrapEmailHtml) ; textes de l'offre et du CV échappés. */
export function idealCandidateEmail(input: IdealCandidateEmailInput): { subject: string; heading: string; bodyHtml: string } {
  const title = input.jobTitle.trim() || 'Sans intitulé'
  const shortTitle = title.length > MAX_SUBJECT_TITLE ? `${title.slice(0, MAX_SUBJECT_TITLE - 1)}…` : title
  const candidate = input.candidateName.trim() || 'Un candidat'
  const profileUrl = escapeHtml(input.profileUrl)
  const alertsUrl = escapeHtml(input.alertsUrl)
  const greeting = input.recipientName.trim() ? `Bonjour ${escapeHtml(input.recipientName.trim())},` : 'Bonjour,'
  const bodyHtml = `
      <p style="${paragraph}">${greeting}</p>
      <p style="${paragraph}"><strong>${escapeHtml(candidate)}</strong>, ${SOURCE_SENTENCE[input.source]} <strong>« ${escapeHtml(title)} »</strong>, avec un score de <strong>${Math.round(input.score)}/100</strong>.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${profileUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Voir le profil</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px; font-size:12px; color:#9B9B9E; text-align:center;">Ou copiez ce lien : <a href="${profileUrl}" style="color:#E8A33D;">${profileUrl}</a></p>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">Vous recevez cet e-mail pour chaque profil noté ${IDEAL_SCORE}/100 ou plus pour une de vos offres. <a href="${alertsUrl}" style="color:#E8A33D;">Gérer mes alertes</a></p>`
  return {
    subject: `Profil idéal (${Math.round(input.score)}/100) pour « ${shortTitle} »`,
    heading: 'Un profil idéal pour votre offre',
    bodyHtml,
  }
}
