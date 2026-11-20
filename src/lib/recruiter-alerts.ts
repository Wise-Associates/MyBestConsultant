import { createHash } from 'node:crypto'

// Alertes du recruteur sur ses offres (ADR 0045, seuil et sources revus par l'ADR 0047) : un candidat noté au moins au
// seuil du recruteur pour une offre déclenche un e-mail au recruteur concerné, une seule fois par candidat et par offre,
// et une ligne dans la page « Alertes » (/recruiter/alertes). Toute candidature reçue le prévient aussi, quel que soit son
// score, une fois par candidature (ADR 0051). Règles et contenu de l'e-mail purs, testés dans recruiter-alerts.test.ts ;
// lecture, écriture et envoi : recruiter-alerts-store.ts.

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
  /** Profil du candidat d'une candidature (enregistré pour supprimer ses alertes avec son compte). */
  candidateId?: string
  /** null : candidature sans score (analyse non aboutie, ou screening hors de la formule de l'organisation). */
  score: number | null
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

/**
 * Une candidature reçue prévient toujours, quel que soit son score et même sans score (ADR 0051 : le recruteur doit
 * savoir qu'on a postulé à son offre) ; un candidat de la base ou un CV du vivier, seulement noté au moins au seuil.
 */
export const meetsAlertRule = (candidate: { source: AlertSource; score: number | null }, threshold: number): boolean =>
  candidate.source === 'candidature' || (isAlertScore(candidate.score) && candidate.score >= threshold)

/**
 * Sujet de l'alerte : la candidature elle-même (une alerte par candidature, même pour une personne déjà signalée depuis
 * la base : postuler est un autre événement, ADR 0051), un candidat de la plateforme (base, recherche) ou un CV du vivier.
 */
export function alertSubjectKey(candidate: { source: AlertSource; subjectId: string }): string {
  if (candidate.source === 'vivier') return `vivier:${candidate.subjectId}`
  if (candidate.source === 'candidature') return `candidature:${candidate.subjectId}`
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

/**
 * E-mail d'une alerte : toujours pour une candidature reçue, le recruteur n'a rien à régler pour en être prévenu
 * (ADR 0051) ; pour les autres, selon l'interrupteur de la page « Alertes ».
 */
export const alertEmailWanted = (source: AlertSource, pref: unknown): boolean =>
  source === 'candidature' || alertEmailsEnabled(pref)

export interface IdealCandidateEmailInput {
  recipientName: string
  candidateName: string
  jobTitle: string
  /** null : candidature sans score. */
  score: number | null
  source: JobAlertSource
  /** Seuil du recruteur, rappelé en bas de l'e-mail (sauf pour une candidature, qui prévient quel que soit le score). */
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

const SOURCE_SENTENCE: Record<Exclude<JobAlertSource, 'candidature'>, string> = {
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
  const score = input.score === null ? null : Math.round(input.score)
  // Seule une candidature peut arriver sans score (meetsAlertRule) ; jamais « null/100 » dans un e-mail.
  const scoreLabel = score === null ? 'non disponible' : `${score}/100`
  const profileUrl = escapeHtml(input.profileUrl)
  const jobUrl = escapeHtml(input.jobUrl)
  const alertsUrl = escapeHtml(input.alertsUrl)
  const greeting = input.recipientName.trim() ? `Bonjour ${escapeHtml(input.recipientName.trim())},` : 'Bonjour,'
  const h = input.highlights
  const application = input.source === 'candidature'
  // Nom après deux-points : « de Alex » demanderait l'élision (« d'Alex ») selon la première lettre du nom.
  const applicant = input.candidateName.trim() ? ` : <strong>${escapeHtml(input.candidateName.trim())}</strong>` : ''
  const intro = input.source === 'candidature'
    ? `Nouvelle candidature pour votre offre <strong>« ${escapeHtml(title)} »</strong>${applicant}. ${score === null
      ? 'Elle n’a pas encore de score de l’IA : il s’affichera dans le Matching IA de l’offre une fois l’analyse faite.'
      : `Score de l’IA : <strong>${scoreLabel}</strong>.`}`
    : h
      ? `<strong>${escapeHtml(candidate)}</strong> vient de s’inscrire sur MyBestConsultant et l’IA l’a identifié comme un candidat pour votre offre <strong>« ${escapeHtml(title)} »</strong>, avec un score de <strong>${scoreLabel}</strong>. Il apparaît dans le Matching IA de l’offre, marqué « Proposé par l’IA » : ce n’est pas une candidature.`
      : `<strong>${escapeHtml(candidate)}</strong>, ${SOURCE_SENTENCE[input.source]} <strong>« ${escapeHtml(title)} »</strong>, avec un score de <strong>${scoreLabel}</strong>.`
  const why = application
    ? 'Vous recevez cet e-mail pour chaque candidature reçue sur une de vos offres, quel que soit son score.'
    : `Vous recevez cet e-mail pour chaque candidat noté ${input.threshold}/100 ou plus pour une de vos offres.`
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
          <a href="${profileUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">${application ? 'Voir la candidature' : 'Voir le profil'}</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px; font-size:12px; color:#9B9B9E; text-align:center;"><a href="${jobUrl}" style="color:#E8A33D;">Voir le Matching IA de l’offre</a> · Ou copiez ce lien : <a href="${profileUrl}" style="color:#E8A33D;">${profileUrl}</a></p>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">${why} <a href="${alertsUrl}" style="color:#E8A33D;">Gérer mes alertes</a></p>`
  if (application) {
    return { subject: `Nouvelle candidature — ${shortTitle}${score === null ? '' : ` (${scoreLabel})`}`, heading: 'Nouvelle candidature', bodyHtml }
  }
  return h
    ? { subject: `Nouveau candidat proposé par l’IA — ${shortTitle} (${scoreLabel})`, heading: 'Un nouveau candidat pour votre offre', bodyHtml }
    : { subject: `Candidat noté ${scoreLabel} pour « ${shortTitle} »`, heading: 'Un candidat pour votre offre', bodyHtml }
}
