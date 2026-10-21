import { z } from 'zod'
import { contractOf, parseNumber, remoteOf } from '@/lib/job-import'
import type { AoOfferFields } from './types'

// La réponse de l'IA est une donnée non fiable : on la valide champ par champ, on normalise ce qui peut
// l'être (contrat, télétravail, montant, compétences) et on écarte les offres sans titre.

const asText = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const text = (max: number) => z.unknown().optional().transform(v => asText(v).slice(0, max))
// Champs courts affichés tels quels (titre, ville…) : aucun chevron, qui n'a rien à y faire.
const shortText = (max: number) => z.unknown().optional().transform(v => asText(v).replace(/[<>]/g, '').trim().slice(0, max))

/** Réponse coupée par la limite de longueur de l'IA : la redemander donnerait le même résultat. */
export class TruncatedAnswerError extends Error {}

export const MAX_SKILLS = 10

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
  skills: z.unknown().optional().transform(v => {
    const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;|\n]/) : []
    const clean = list.map(s => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 60)).filter(Boolean)
    return [...new Set(clean)].slice(0, MAX_SKILLS)
  }),
  description: text(20_000),
  duration: shortText(100),
  startDate: shortText(100),
  experience: shortText(100),
})

/**
 * Offre validée et normalisée à partir de champs bruts (réponse de l'IA, ligne de tableau) ; null sans titre exploitable.
 */
export function parseOfferFields(raw: Record<string, unknown>): AoOfferFields | null {
  const parsed = OfferSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export interface ParsedOffers {
  offers: AoOfferFields[]
  /** Nombre d'éléments renvoyés par l'IA mais écartés (pas d'objet, pas de titre…). */
  rejected: number
}

/**
 * Lit la réponse brute de l'IA : un tableau JSON, éventuellement entouré de texte ou de balises ```.
 * Lève une erreur si aucun tableau JSON n'est lisible (l'e-mail sera réessayé).
 */
export function parseOffersJson(raw: string): ParsedOffers {
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

  const offers: AoOfferFields[] = []
  let rejected = 0
  for (const item of data) {
    const parsed = OfferSchema.safeParse(item && typeof item === 'object' ? item : null)
    if (parsed.success) offers.push(parsed.data)
    else rejected++
  }
  return { offers, rejected }
}
