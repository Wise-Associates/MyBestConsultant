import { z } from 'zod'
import {
  EMPTY_FILTERS, filterCandidates, filtersSummary, hasPhrase, hasSearchCriteria, sanitizeFilters, words, type CvthequeFilters,
  type SearchableCandidate,
} from '@/lib/cvtheque-search'
import { alertDocId, escapeHtml } from '@/lib/recruiter-alerts'

// Recherches enregistrées de la CV Thèque et leurs alertes (ADR 0046, phase 1 de la demande du PO du 2026-11-18) : le
// recruteur enregistre les filtres de la liste, puis reçoit un e-mail quand un nouveau candidat y répond. Comparaison
// par les filtres seulement, sans IA (filterCandidates, la règle de la liste). Règles pures, testées dans
// saved-searches.test.ts ; lecture, écriture et envoi : saved-searches-store.ts.

/** Recherches enregistrées au plus par recruteur. */
export const SAVED_SEARCHES_MAX = 50

export const NAME_MAX = 100
export const DESCRIPTION_MAX = 500
/** Taille de l'attribut `filtersJson` (appwrite.config.json) : au-delà, Appwrite refuserait l'écriture. */
export const FILTERS_JSON_MAX = 10_000

export interface SavedSearch {
  id: string
  tenantId: string
  /** Profil (users.$id) du recruteur qui l'a créée : une recherche est personnelle. */
  ownerId: string
  name: string
  description: string
  filters: CvthequeFilters
  /** Désactivée : plus d'alerte, la recherche reste dans la liste. */
  active: boolean
  /** E-mails de cette recherche ; les alertes restent enregistrées sans eux. */
  emailAlerts: boolean
  createdAt: string
  /** Dernier candidat retenu (ISO), '' : aucun. */
  lastMatchAt: string
  /** Dernière ouverture dans la CV Thèque (ISO), '' : jamais ; les correspondances suivantes sont « nouvelles ». */
  lastOpenedAt: string
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Document Appwrite lu ; filtres illisibles : aucun filtre (la recherche, sans critère, ne déclenche alors rien). */
export function savedSearchOf(doc: Record<string, unknown>): SavedSearch {
  let filters = EMPTY_FILTERS
  try {
    filters = sanitizeFilters(JSON.parse(str(doc.filtersJson) || '{}'))
  } catch {
    filters = EMPTY_FILTERS
  }
  return {
    id: str(doc.$id), tenantId: str(doc.tenantId), ownerId: str(doc.ownerId), name: str(doc.name), description: str(doc.description),
    filters, active: doc.active !== false, emailAlerts: doc.emailAlerts !== false, createdAt: str(doc.$createdAt),
    lastMatchAt: str(doc.lastMatchAt), lastOpenedAt: str(doc.lastOpenedAt),
  }
}

export const SavedSearchInputSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom à la recherche.').max(NAME_MAX, `Nom de ${NAME_MAX} caractères au plus.`),
  description: z.string().trim().max(DESCRIPTION_MAX, `Description de ${DESCRIPTION_MAX} caractères au plus.`).default(''),
  emailAlerts: z.boolean().default(true),
  filters: z.unknown().transform(sanitizeFilters)
    .refine(hasSearchCriteria, 'Choisissez au moins un critère (recherche, compétence, lieu…) avant d’enregistrer.')
    .refine(f => JSON.stringify(f).length <= FILTERS_JSON_MAX, 'Trop de critères pour une recherche : retirez-en quelques-uns.'),
})
export type SavedSearchInput = z.infer<typeof SavedSearchInputSchema>

/** Saisie validée, ou le premier message d'erreur à afficher. */
export function parseSavedSearchInput(raw: unknown): { input: SavedSearchInput } | { error: string } {
  const parsed = SavedSearchInputSchema.safeParse(raw)
  return parsed.success ? { input: parsed.data } : { error: parsed.error.issues[0]?.message ?? 'Recherche invalide.' }
}

/**
 * Le candidat déclenche-t-il une alerte de cette recherche ? Recherche active et avec critères, candidat retenu par les
 * filtres, et « nouveau » pour elle : inscrit après sa création, ou qui vient de déposer son CV (`newCv` : un compte plus
 * ancien sans CV n'était pas dans la liste). Un candidat déjà dans la liste au moment de l'enregistrement, que le
 * recruteur a donc vu, ne déclenche rien s'il modifie son profil.
 */
export function shouldAlert(search: SavedSearch, candidate: SearchableCandidate, opts: { newCv: boolean; now: Date }): boolean {
  if (!search.active || !hasSearchCriteria(search.filters)) return false
  const isNew = opts.newCv || Date.parse(candidate.createdAt) >= Date.parse(search.createdAt)
  if (!isNew) return false
  return filterCandidates([candidate], search.filters, opts.now).length === 1
}

/** Une alerte par recherche et par candidat (création en 409 la seconde fois). */
export const searchAlertDocId = (searchId: string, ownerId: string, candidateId: string) =>
  alertDocId(`recherche:${searchId}`, ownerId, `candidat:${candidateId}`)

/** Essais d'envoi au plus pour une alerte (premier envoi compris) ; au-delà, elle reste « E-mail non envoyé ». */
export const MAX_EMAIL_ATTEMPTS = 3
/** Une alerte restée « en cours » plus longtemps a été interrompue avant la fin de l'envoi. */
export const PENDING_STALE_MS = 15 * 60 * 1000

/**
 * L'e-mail d'une alerte est-il à renvoyer par le cron ? En échec, ou resté « en cours » (envoi interrompu), et moins de
 * MAX_EMAIL_ATTEMPTS essais. Un envoi interrompu juste après le départ de l'e-mail peut ainsi partir deux fois : choisi
 * plutôt qu'un e-mail perdu (ADR 0046).
 */
export function isRetryDue(alert: { emailStatus: string; emailAttempts: unknown; updatedAt: string }, now: Date): boolean {
  const attempts = typeof alert.emailAttempts === 'number' ? alert.emailAttempts : 0
  if (attempts >= MAX_EMAIL_ATTEMPTS) return false
  if (alert.emailStatus === 'failed') return true
  return alert.emailStatus === 'pending' && now.getTime() - Date.parse(alert.updatedAt) > PENDING_STALE_MS
}

/** Nombre de correspondances arrivées après la dernière ouverture de la recherche. */
export function newMatchCount(matchDates: string[], lastOpenedAt: string): number {
  const since = lastOpenedAt ? Date.parse(lastOpenedAt) : Number.NEGATIVE_INFINITY
  return matchDates.filter(d => Date.parse(d) > since).length
}

export interface CandidateHighlights {
  position: string
  location: string
  years: string
  /** Compétences demandées par les recherches d'abord, puis les autres, 6 au plus. */
  skills: string[]
}

/** Ce que l'e-mail montre du candidat : seulement ce que la CV Thèque montre déjà à tout recruteur. */
export function candidateHighlights(c: SearchableCandidate, searches: CvthequeFilters[]): CandidateHighlights {
  const asked = searches.flatMap(f => f.skills)
  const own = c.skills.filter(s => s.trim())
  const matching = own.filter(s => asked.some(a => hasPhrase(words(s), a)))
  const skills = [...matching, ...own.filter(s => !matching.includes(s))].slice(0, 6)
  return {
    position: c.desiredRoles[0] || c.experiences[0]?.title || '',
    location: c.city,
    years: c.yearsOfExperience === null ? '' : `${c.yearsOfExperience} an${c.yearsOfExperience > 1 ? 's' : ''}`,
    skills,
  }
}

export interface SavedSearchEmailInput {
  recipientName: string
  candidateName: string
  highlights: CandidateHighlights
  /** Recherches du recruteur auxquelles le candidat répond (une alerte chacune, un seul e-mail). */
  searches: { name: string; filters: CvthequeFilters }[]
  profileUrl: string
  alertsUrl: string
}

const paragraph = 'margin:0 0 14px; font-size:14px; line-height:1.7; color:#45454A;'
const MAX_SUBJECT_NAME = 80
const clipped = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/** Objet, titre et corps de l'e-mail (à envelopper par wrapEmailHtml) ; textes du recruteur et du candidat échappés. */
export function savedSearchEmail(input: SavedSearchEmailInput): { subject: string; heading: string; bodyHtml: string } {
  const names = input.searches.map(s => s.name.trim() || 'Sans nom')
  const subject = names.length === 1
    ? `Nouveau candidat pour votre recherche « ${clipped(names[0], MAX_SUBJECT_NAME)} »`
    : `Nouveau candidat pour ${names.length} de vos recherches`
  const greeting = input.recipientName.trim() ? `Bonjour ${escapeHtml(input.recipientName.trim())},` : 'Bonjour,'
  const candidate = escapeHtml(input.candidateName.trim() || 'Un candidat')
  const h = input.highlights
  const facts = [
    ['Poste', h.position], ['Lieu', h.location], ['Expérience', h.years], ['Compétences', h.skills.join(', ')],
  ].filter(([, v]) => v.trim())
  const factRows = facts.map(([label, value]) =>
    `<tr><td style="padding:4px 12px 4px 0; font-size:13px; color:#9B9B9E; vertical-align:top;">${label}</td><td style="padding:4px 0; font-size:13px; color:#2C2C2E;">${escapeHtml(value)}</td></tr>`).join('')
  const searchItems = input.searches.map(s => {
    const criteria = filtersSummary(s.filters).join(' · ')
    return `<li style="margin:0 0 6px;"><strong>${escapeHtml(s.name.trim() || 'Sans nom')}</strong>${criteria ? `<br><span style="font-size:12px; color:#9B9B9E;">${escapeHtml(criteria)}</span>` : ''}</li>`
  }).join('')
  const profileUrl = escapeHtml(input.profileUrl)
  const alertsUrl = escapeHtml(input.alertsUrl)
  const bodyHtml = `
      <p style="${paragraph}">${greeting}</p>
      <p style="${paragraph}">Un nouveau candidat inscrit sur MyBestConsultant répond à ${names.length === 1 ? 'votre recherche enregistrée' : 'vos recherches enregistrées'} :</p>
      <ul style="margin:0 0 16px; padding-left:20px; font-size:14px; line-height:1.5; color:#45454A;">${searchItems}</ul>
      <p style="margin:0 0 6px; font-size:15px; font-weight:700; color:#2C2C2E;">${candidate}</p>
      ${factRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">${factRows}</table>` : ''}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;">
        <tr><td style="border-radius:10px; background-color:#F97316;">
          <a href="${profileUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:10px;">Voir le profil</a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px; font-size:12px; color:#9B9B9E; text-align:center;">Ou copiez ce lien : <a href="${profileUrl}" style="color:#F97316;">${profileUrl}</a></p>
      <p style="margin:0; font-size:12px; color:#9B9B9E; text-align:center;">Vous recevez cet e-mail pour chaque nouveau candidat qui répond à une de vos recherches enregistrées. <a href="${alertsUrl}" style="color:#F97316;">Gérer mes recherches</a></p>`
  return { subject, heading: 'Un nouveau candidat pour vos recherches', bodyHtml }
}
