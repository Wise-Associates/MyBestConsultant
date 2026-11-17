import { z } from 'zod'
import { STANDARD_DAILY_QUOTAS } from '@/lib/plans'

// Téléphone d'une personne révélée dans MBC Search (ADR 0042, demande du 2026-11-17) : demandé à Apollo à la demande du
// recruteur (« Demander le téléphone »), jamais avec la révélation. Apollo le cherche en différé : la demande
// (`people/match` avec `reveal_phone_number` et `poll_only`) renvoie un numéro de demande, le numéro se relit ensuite
// (`webhook_result/<demande>`). Jusqu'à 8 crédits de plus par numéro trouvé, aucun sinon. Gardé avec le profil révélé
// (90 jours pour l'organisation, ou tant que le recruteur garde la personne enregistrée) ; jamais journalisé.
// Règles pures, testées dans phone.test.ts.

/**
 * Demandes par jour (UTC) : par organisation (20 pour les formules standard, choix du 2026-11-17 ; une offre sur mesure
 * peut le changer, `dailyQuotas.mbcPhone` de plans.ts), et pour toutes ensemble (crédits de la plateforme).
 */
export const MBC_PHONE_DAILY_LIMITS = { perOrganisation: STANDARD_DAILY_QUOTAS.mbcPhone, allOrganisations: 200 } as const

export const MBC_PHONE_QUOTA_MESSAGE = {
  organisation: (limit: number) => `Limite de ${limit} demandes de téléphone par jour atteinte pour votre organisation : réessayez demain.`,
  platform: 'Trop de demandes de téléphone aujourd\'hui sur la plateforme : réessayez demain.',
} as const

/** Numéros gardés par personne. */
export const PHONE_NUMBERS_MAX = 5

export interface MbcPhoneNumber {
  /** Forme internationale (« +33612345678 ») quand Apollo la donne, sinon chiffres seuls. */
  number: string
  /** Type selon Apollo (« mobile », « work_direct »…) ; `PHONE_TYPE_LABEL` pour l'afficher. */
  type: string
}

/** État de la demande : en attente d'Apollo, numéro trouvé, aucun numéro, ou échec (une nouvelle demande est possible). */
export type MbcPhoneStatus = 'pending' | 'found' | 'none' | 'failed'

export interface MbcPhone {
  status: MbcPhoneStatus
  numbers: MbcPhoneNumber[]
  /** Numéro de la demande chez Apollo, tant qu'elle est en attente : relu par le serveur dans le profil gardé, jamais pris du navigateur. */
  requestId?: string
  requestedAt: string
}

const PHONE = /^\+?[0-9]{6,20}$/
/** Numéro de demande d'Apollo : entier signé de 64 bits écrit en chiffres. */
export const APOLLO_REQUEST_ID = /^-?[0-9]{1,20}$/

export const phoneSchema = z.object({
  status: z.enum(['pending', 'found', 'none', 'failed']),
  numbers: z.array(z.object({ number: z.string().regex(PHONE), type: z.string().max(30) })).max(PHONE_NUMBERS_MAX),
  requestId: z.string().regex(APOLLO_REQUEST_ID).optional(),
  requestedAt: z.string().max(40),
})

export const PHONE_TYPE_LABEL: Record<string, string> = {
  mobile: 'Mobile', work_direct: 'Ligne directe', work_hq: 'Standard', home: 'Domicile', other: 'Autre',
}
export const phoneTypeLabel = (type: string) => PHONE_TYPE_LABEL[type] ?? 'Téléphone'

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Numéros d'une liste d'Apollo (`phone_numbers`) : la forme internationale, sinon les chiffres du numéro tel qu'écrit ;
 * un numéro qui n'en est pas un est écarté, sans doublon, PHONE_NUMBERS_MAX au plus.
 */
export function phoneNumbersOf(list: unknown): MbcPhoneNumber[] {
  if (!Array.isArray(list)) return []
  const out: MbcPhoneNumber[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const raw = str(p.sanitized_number) || str(p.raw_number)
    const number = raw.startsWith('+') ? `+${raw.slice(1).replace(/\D/g, '')}` : raw.replace(/\D/g, '')
    if (!PHONE.test(number) || out.some(n => n.number === number)) continue
    out.push({ number, type: (str(p.type_cd) || str(p.type)).slice(0, 30) })
    if (out.length === PHONE_NUMBERS_MAX) break
  }
  return out
}

/**
 * Réponse de la demande (`people/match`) : numéros déjà donnés (souvent celui de l'employeur) et, si Apollo cherche
 * encore, le numéro de la demande à relire. null : réponse illisible.
 */
export function parsePhoneRequest(json: unknown): { numbers: MbcPhoneNumber[]; requestId: string | null } | null {
  if (!json || typeof json !== 'object') return null
  const body = json as Record<string, unknown>
  const person = body.person && typeof body.person === 'object' ? body.person as Record<string, unknown> : null
  if (!person) return null
  const contact = person.contact && typeof person.contact === 'object' ? person.contact as Record<string, unknown> : {}
  const numbers = phoneNumbersOf(contact.phone_numbers ?? person.phone_numbers)
  const enrichment = body.phone_enrichment && typeof body.phone_enrichment === 'object' ? body.phone_enrichment as Record<string, unknown> : {}
  // Seul le numéro de premier niveau se relit (la documentation d'Apollo met en garde contre phone_enrichment.request_id).
  const requestId = enrichment.status === 'pending' && APOLLO_REQUEST_ID.test(str(body.request_id_str)) ? str(body.request_id_str) : null
  return { numbers, requestId }
}

/** Numéros de la personne `apolloId` dans un résultat relu (`webhook_result`, réponse 200). */
export function parsePhoneResult(json: unknown, apolloId: string): MbcPhoneNumber[] {
  const result = (json as { webhook_result?: { people?: unknown } } | null)?.webhook_result
  const people = Array.isArray(result?.people) ? result.people as Record<string, unknown>[] : []
  const person = people.find(p => p && p.id === apolloId)
  return person ? phoneNumbersOf(person.phone_numbers) : []
}

/** Numéros réunis sans doublon (ceux déjà connus d'abord), PHONE_NUMBERS_MAX au plus. */
export function mergeNumbers(known: MbcPhoneNumber[], added: MbcPhoneNumber[]): MbcPhoneNumber[] {
  const out = [...known]
  for (const n of added) if (out.length < PHONE_NUMBERS_MAX && !out.some(k => k.number === n.number)) out.push(n)
  return out
}

/** Demande terminée : numéros trouvés ou non (le numéro de demande n'est plus gardé). */
export const settledPhone = (numbers: MbcPhoneNumber[], requestedAt: string): MbcPhone =>
  ({ status: numbers.length > 0 ? 'found' : 'none', numbers, requestedAt })

/** Une demande est possible : jamais faite, ou la précédente a échoué. */
export const canRequestPhone = (phone: MbcPhone | undefined) => !phone || phone.status === 'failed'
