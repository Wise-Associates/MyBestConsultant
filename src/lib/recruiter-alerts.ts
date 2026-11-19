import { createHash } from 'node:crypto'

// Alertes du recruteur sur ses offres (ADR 0045, seuil et sources revus par l'ADR 0047) : un candidat noté au moins au
// seuil du recruteur pour une offre déclenche un e-mail au recruteur concerné, une seule fois par candidat et par offre,
// et une ligne dans la page « Alertes » (/recruiter/alertes). Règles et contenu de l'e-mail purs, testés dans
// recruiter-alerts.test.ts ; lecture, écriture et envoi : recruiter-alerts-store.ts.

/** Seuil par défaut, et le plus bas réglable : celui des correspondances IA (AUTO_MATCH_MIN_SCORE, demande du PO). */
export const ALERT_THRESHOLD_DEFAULT = 70
/** Seuils proposés au recruteur dans la page « Alertes ». */
export const ALERT_THRESHOLD_OPTIONS = [70, 75, 80, 85, 90, 95] as const

/** Seuil enregistré dans les préférences du compte ; absent ou hors des choix proposés : le seuil par défaut. */
export const alertThresholdOf = (pref: unknown): number =>
  ALERT_THRESHOLD_OPTIONS.find(t => t === pref) ?? ALERT_THRESHOLD_DEFAULT

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
  /** Correspondance trouvée au premier CV du candidat (ADR 0047) : l'e-mail le dit et détaille le score. */
  highlights?: MatchHighlights
}

/** Détail d'une correspondance IA pour l'e-mail (matchHighlights, ai-matches.ts). */
export interface MatchHighlights {
  /** Phrase de l'IA sur le candidat ; '' si la raison n'en a pas. */
  why: string
  /** Compétences demandées par l'offre que le candidat a. */
  skills: string[]
  /** Critères faibles ou non renseignés, à vérifier (« Langue : non précisé »). */
  gaps: string[]
}

/** Score qui peut déclencher une alerte : au moins le plus bas des seuils réglables (le seuil du recruteur est vu ensuite). */
export const isAlertScore = (score: unknown): score is number =>
  typeof score === 'number' && Number.isFinite(score) && score >= ALERT_THRESHOLD_DEFAULT

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
  /** Seuil du recruteur, rappelé en bas de l'e-mail. */
  threshold: number
  /** Correspondance trouvée au premier CV du candidat : détail du score. */
  highlights?: MatchHighlights
  /** Adresses absolues du profil, de l'offre (Matching IA) et de la page des alertes. */
  profileUrl: string
  jobUrl: string
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

const list = (items: string[]) =>
  `<ul style="margin:0 0 14px; padding-left:20px; font-size:14px; line-height:1.7; color:#45454A;">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`

/** Objet, titre et corps de l'e-mail (à envelopper par wrapEmailHtml) ; textes de l'offre et du CV échappés. */
export function idealCandidateEmail(input: IdealCandidateEmailInput): { subject: string; heading: string; bodyHtml: string } {
  const title = input.jobTitle.trim() || 'Sans intitulé'
  const shortTitle = title.length > MAX_SUBJECT_TITLE ? `${title.slice(0, MAX_SUBJECT_TITLE - 1)}…` : title
  const candidate = input.candidateName.trim() || 'Un candidat'
  const score = Math.round(input.score)
  const profileUrl = escapeHtml(input.profileUrl)
  const jobUrl = escapeHtml(input.jobUrl)
  const alertsUrl = escapeHtml(input.alertsUrl)
  const greeting = input.recipientName.trim() ? `Bonjour ${escapeHtml(input.recipientName.trim())},` : 'Bonjour,'
  const h = input.highlights
  const intro = h
    ? `<strong>${escapeHtml(candidate)}</strong> vient de s’inscrire sur MyBestConsultant et l’IA l’a identifié comme un candidat pour votre offre <strong>« ${escapeHtml(title)} »</strong>, avec un score de <strong>${score}/100</strong>. Il apparaît dans le Matching IA de l’offre, marqué « Proposé par l’IA » : ce n’est pas une candidature.`
    : `<strong>${escapeHtml(candidate)}</strong>, ${SOURCE_SENTENCE[input.source]} <strong>« ${escapeHtml(title)} »</strong>, avec un score de <strong>${score}/100</strong>.`
  const details = h ? [
    h.skills.length > 0 ? `<p style="${paragraph} margin-bottom:6px;"><strong>Compétences demandées qu’il a :</strong></p>${list(h.skills)}` : '',
    h.why ? `<p style="${paragraph}"><strong>Pourquoi ce candidat :</strong> ${escapeHtml(h.why)}</p>` : '',
    h.gaps.length > 0 ? `<p style="${paragraph} margin-bottom:6px;"><strong>À vérifier :</strong></p>${list(h.gaps)}` : '',
  ].join('') : ''
  const bodyHtml = `
      <p style="${paragraph}">${greeting}</p>
      <p style="${paragraph}">${intro}</p>${details}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#E8A33D;">
          <a href="${profileUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Voir le profil</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px; font-size:12px; color:#9B9B9E; text-align:center;"><a href="${jobUrl}" style="color:#E8A33D;">Voir le Matching IA de l’offre</a> · Ou copiez ce lien : <a href="${profileUrl}" style="color:#E8A33D;">${profileUrl}</a></p>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">Vous recevez cet e-mail pour chaque candidat noté ${input.threshold}/100 ou plus pour une de vos offres. <a href="${alertsUrl}" style="color:#E8A33D;">Gérer mes alertes</a></p>`
  return h
    ? { subject: `Nouveau candidat proposé par l’IA — ${shortTitle} (${score}/100)`, heading: 'Un nouveau candidat pour votre offre', bodyHtml }
    : { subject: `Candidat noté ${score}/100 pour « ${shortTitle} »`, heading: 'Un candidat pour votre offre', bodyHtml }
}
