import type { AoChannel, AoContract, AoOffer, AoOfferDetails, AoOfferStatus, AoRemote } from './types'

// Filtres de la page AO Offers, lus dans l'adresse de la page et de l'export Excel : appliqués par le serveur sur l'index
// de la liste (indexFilterQueries, offer-index.ts), le fichier téléchargé contient exactement les offres filtrées.

/** Offre enrichie des informations de l'e-mail d'origine. */
export interface AoOfferRow extends AoOffer, AoOfferDetails {
  /** Expéditeur du message d'origine (e-mail transféré), sinon de l'e-mail. */
  senderAddress: string
  senderName: string
  /** Collaborateur qui a transféré l'e-mail à la boîte AO ; vide si l'expéditeur l'a envoyé directement. */
  forwardedBy: string
  /** Pièces jointes lues de l'e-mail d'origine (noms ; contenu relu dans la boîte à la demande, originals.ts). */
  attachments: string[]
  /** Nombre de commentaires internes (comments.ts). */
  commentCount: number
  /** Date limite de réponse, enregistrée sur l'e-mail d'origine. */
  deadline: string
  subject: string
  receivedAt: string
  /** Canal d'arrivée (colonne « Source » de la page). */
  channel: AoChannel
}

/** Libellé du canal d'arrivée, dans la colonne « Source » et le panneau de détail. */
export const AO_CHANNEL_LABEL: Record<AoChannel, string> = { email: 'E-mails AO', scraping: 'Scraping' }

export interface AoFilters {
  q: string
  status: AoOfferStatus | 'all'
  contractType: AoContract | 'all'
  remote: AoRemote | 'all'
  city: string
  skill: string
  sender: string
  salaryMin: number | null
  salaryMax: number | null
  /** Dates de réception incluses, au format AAAA-MM-JJ. */
  from: string
  to: string
}

/**
 * Offres listées au plus (tableau, export, statistiques) : Appwrite ne compte pas au-delà de 5 000 documents. Au-delà,
 * les plus récentes ; les filtres restreignent la liste.
 */
export const AO_MAX_LISTED = 5000

export const EMPTY_AO_FILTERS: AoFilters = {
  q: '', status: 'all', contractType: 'all', remote: 'all', city: '', skill: '', sender: '',
  salaryMin: null, salaryMax: null, from: '', to: '',
}

const STATUSES = ['to_review', 'published', 'ignored'] as const
const CONTRACTS = ['cdi', 'cdd', 'freelance', 'mission'] as const
const REMOTES = ['onsite', 'hybrid', 'remote'] as const
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Jour AAAA-MM-JJ qui existe (« 2026-13-01 » ou « 2026-02-30 » sont refusés). */
const isDay = (value: string | null): value is string =>
  !!value && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | 'all' =>
  allowed.includes(value as T) ? (value as T) : 'all'
/** Montant entier (l'attribut l'est), borné au montant le plus haut qu'une offre peut avoir. */
const amount = (value: string | null) => {
  const n = Number(value)
  return value && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 1_000_000) : null
}

export function filtersFromSearchParams(sp: URLSearchParams): AoFilters {
  const text = (key: string) => (sp.get(key) ?? '').slice(0, 200)
  return {
    q: text('q'),
    status: pick(sp.get('status'), STATUSES),
    contractType: pick(sp.get('contract'), CONTRACTS),
    remote: pick(sp.get('remote'), REMOTES),
    city: text('city'),
    skill: text('skill'),
    sender: text('sender'),
    salaryMin: amount(sp.get('min')),
    salaryMax: amount(sp.get('max')),
    from: isDay(sp.get('from')) ? (sp.get('from') as string) : '',
    to: isDay(sp.get('to')) ? (sp.get('to') as string) : '',
  }
}

export function filtersToSearchParams(f: AoFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.q) sp.set('q', f.q)
  if (f.status !== 'all') sp.set('status', f.status)
  if (f.contractType !== 'all') sp.set('contract', f.contractType)
  if (f.remote !== 'all') sp.set('remote', f.remote)
  if (f.city) sp.set('city', f.city)
  if (f.skill) sp.set('skill', f.skill)
  if (f.sender) sp.set('sender', f.sender)
  if (f.salaryMin !== null) sp.set('min', String(f.salaryMin))
  if (f.salaryMax !== null) sp.set('max', String(f.salaryMax))
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  return sp
}
