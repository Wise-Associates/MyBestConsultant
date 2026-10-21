import type { AoContract, AoOffer, AoOfferDetails, AoOfferStatus, AoRemote } from './types'

// Filtres de la page AO Offers, partagés par l'affichage (navigateur) et l'export Excel (serveur) :
// le fichier téléchargé contient exactement les offres affichées.

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
}

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

export const EMPTY_AO_FILTERS: AoFilters = {
  q: '', status: 'all', contractType: 'all', remote: 'all', city: '', skill: '', sender: '',
  salaryMin: null, salaryMax: null, from: '', to: '',
}

const STATUSES = ['to_review', 'published', 'ignored'] as const
const CONTRACTS = ['cdi', 'cdd', 'freelance', 'mission'] as const
const REMOTES = ['onsite', 'hybrid', 'remote'] as const
const DATE = /^\d{4}-\d{2}-\d{2}$/

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | 'all' =>
  allowed.includes(value as T) ? (value as T) : 'all'
const amount = (value: string | null) => {
  const n = Number(value)
  return value && Number.isFinite(n) && n >= 0 ? n : null
}

export function filterAoOffers<T extends AoOfferRow>(rows: T[], f: AoFilters): T[] {
  const q = fold(f.q.trim())
  const city = fold(f.city.trim())
  const skill = fold(f.skill.trim())
  const sender = fold(f.sender.trim())
  return rows.filter(r => {
    if (f.status !== 'all' && r.status !== f.status) return false
    if (f.contractType !== 'all' && r.contractType !== f.contractType) return false
    if (f.remote !== 'all' && r.remote !== f.remote) return false
    if (city && !fold(r.location).includes(city)) return false
    if (skill && !r.skills.some(s => fold(s).includes(skill))) return false
    if (sender && !fold(`${r.senderName} ${r.senderAddress}`).includes(sender)) return false
    if (f.salaryMin !== null && (r.salary === null || r.salary < f.salaryMin)) return false
    if (f.salaryMax !== null && (r.salary === null || r.salary > f.salaryMax)) return false
    const day = r.receivedAt.slice(0, 10)
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    if (q && !fold([r.title, r.companyName, r.location, r.description, r.subject, ...r.skills].join(' ')).includes(q)) return false
    return true
  })
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
    from: DATE.test(sp.get('from') ?? '') ? (sp.get('from') as string) : '',
    to: DATE.test(sp.get('to') ?? '') ? (sp.get('to') as string) : '',
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
