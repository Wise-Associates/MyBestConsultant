import { z } from 'zod'
import { contractOf, parseNumber, remoteOf } from '@/lib/job-import'
import { placeUnlabeledDates } from './dates'
import type { AoEngagement, ExtractedOffer } from './types'

// La réponse de l'IA est une donnée non fiable : on la valide champ par champ, on normalise ce qui peut
// l'être (contrat, télétravail, montant, compétences) et on écarte les offres sans titre.

const asText = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const text = (max: number) => z.unknown().optional().transform(v => asText(v).slice(0, max))
// Champs courts affichés tels quels (titre, ville…) : aucun chevron, qui n'a rien à y faire.
const shortText = (max: number) => z.unknown().optional().transform(v => asText(v).replace(/[<>]/g, '').trim().slice(0, max))

/** Réponse coupée par la limite de longueur de l'IA : la redemander donnerait le même résultat. */
export class TruncatedAnswerError extends Error {}

export const MAX_SKILLS = 10
export const MAX_TECHNOLOGIES = 15

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Liste de libellés courts (tableau, ou texte séparé par , ; | ou retours à la ligne), sans doublon. */
const textList = (max: number) => z.unknown().optional().transform(v => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;|\n]/) : []
  const clean = list.map(s => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 60)).filter(Boolean)
  return [...new Set(clean)].slice(0, max)
})

/** « Assistance technique », « régie », « AT », « au TJM » → assistance ; « forfait » → forfait ; sinon ''. */
export function engagementOf(value: string): AoEngagement {
  const n = fold(value)
  if (/forfait/.test(n)) return 'forfait'
  if (/assistance|regie|\bat\b|tjm/.test(n)) return 'assistance'
  return ''
}

const OfferSchema = z.object({
  title: shortText(200).pipe(z.string().min(2)),
  companyName: shortText(200),
  location: shortText(200),
  contractType: z.unknown().optional().transform(v => contractOf(String(v ?? ''))),
  remote: z.unknown().optional().transform(v => remoteOf(String(v ?? ''))),
  salary: z.unknown().optional().transform(v => {
    const n = typeof v === 'number' ? Math.round(v) : parseNumber(String(v ?? ''))
    return n && n > 0 && n < 1_000_000 ? n : null
  }),
  skills: textList(MAX_SKILLS),
  technologies: textList(MAX_TECHNOLOGIES),
  engagement: z.unknown().optional().transform(v => engagementOf(asText(v))),
  description: text(20_000),
  duration: shortText(100),
  startDate: shortText(100),
  deadline: shortText(100),
  endClient: shortText(200),
  experience: shortText(100),
})

/** Réponse de l'IA : les champs d'une offre, plus les dates citées sans libellé, classées ensuite (dates.ts), pas par l'IA. */
const AiOfferSchema = OfferSchema.extend({
  otherDates: z.unknown().optional().transform(v => (Array.isArray(v) ? v : []).map(d => asText(d).replace(/[<>]/g, '').slice(0, 100)).filter(Boolean).slice(0, 5)),
})

/**
 * Offre validée et normalisée à partir de champs bruts (ligne de tableau : colonnes nommées, pas de date sans libellé) ;
 * null sans titre exploitable.
 */
export function parseOfferFields(raw: Record<string, unknown>): ExtractedOffer | null {
  const parsed = OfferSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export interface ParsedOffers {
  offers: ExtractedOffer[]
  /** Nombre d'éléments renvoyés par l'IA mais écartés (pas d'objet, pas de titre…). */
  rejected: number
}

/**
 * Lit la réponse brute de l'IA : un tableau JSON, éventuellement entouré de texte ou de balises ```.
 * Les dates citées sans libellé sont placées selon leur jour (dates.ts) ; `reference` (date de réception de l'e-mail)
 * donne l'année des dates écrites sans. Lève une erreur si aucun tableau JSON n'est lisible (l'e-mail sera réessayé).
 */
export function parseOffersJson(raw: string, reference: Date): ParsedOffers {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0) throw new Error('Réponse IA invalide : aucun tableau JSON')
  let data: unknown
  try {
    if (end < start) throw new SyntaxError('tableau non refermé')
    data = JSON.parse(raw.slice(start, end + 1))
  } catch (err) {
    // JSON illisible et réponse qui ne se termine pas par le tableau : elle a été coupée en cours de route.
    if (!/\]\s*(```)?\s*$/.test(raw.trim())) {
      throw new TruncatedAnswerError('Réponse IA tronquée (trop d\'offres dans un seul e-mail ?) : importez ce document depuis « Offres → Importer ».')
    }
    throw err
  }
  if (!Array.isArray(data)) throw new Error('Réponse IA invalide : attendu un tableau')

  const offers: ExtractedOffer[] = []
  let rejected = 0
  for (const item of data) {
    const parsed = AiOfferSchema.safeParse(item && typeof item === 'object' ? item : null)
    if (!parsed.success) {
      rejected++
      continue
    }
    const { otherDates, ...offer } = parsed.data
    offers.push({ ...offer, ...placeUnlabeledDates(offer, otherDates, reference), deadlineFromText: Boolean(offer.deadline.trim()) })
  }
  return { offers, rejected }
}
