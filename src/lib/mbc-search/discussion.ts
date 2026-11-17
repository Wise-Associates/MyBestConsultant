import { z } from 'zod'
import { CRITERIA_LIMITS, criteriaSchema, type MbcCriteria, type MbcProfile, type MbcRevealed } from './rules'
import { searchRowSchema } from './saved'
import { parseRevealedJson, revealJson } from './reveals'

// Discussion enregistrée d'une recherche de MBC Search (demande du 2026-11-17 : « save the whole discussion, with the
// persons I unveiled ») : sur une recherche enregistrée (épinglée, nommée) de l'historique `mbc_searches`, ses messages
// et les personnes révélées pendant la discussion, avec leur profil complet. Gardées tant que la recherche reste
// enregistrée (retirée ou supprimée : effacées ; supprimées avec le compte), comme les personnes enregistrées. Règles
// pures, testées dans discussion.test.ts. Serveur seulement (saved.ts : node:crypto) ; l'écran n'en importe que des types.

export const DISCUSSION_LIMITS = {
  /** Messages gardés : le premier (le besoin) et les plus récents. */
  messages: 120,
  text: CRITERIA_LIMITS.brief,
  /** Taille de la discussion écrite (attribut `conversationJson`, 100 000). */
  chars: 95_000,
  /** Personnes gardées par discussion (choix du 2026-11-17). */
  people: 50,
  /** Taille des personnes écrites (attribut `peopleJson`, 1 000 000) : marge pour un profil très long. */
  peopleChars: 950_000,
} as const

const text = z.string().max(DISCUSSION_LIMITS.text)

/** Entrée du fil telle qu'enregistrée (sans identifiant d'écran ni proposition liée à une erreur en cours). */
export const discussionMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), text }),
  z.object({ kind: z.literal('assistant'), text }),
  z.object({ kind: z.literal('error'), text }),
  z.object({ kind: z.literal('results'), total: z.number().int().min(0).max(10_000_000), label: z.string().max(CRITERIA_LIMITS.item) }),
])
export type DiscussionMessage = z.infer<typeof discussionMessageSchema>

/** Discussion : besoin et critères au dernier état (ceux que « Relancer la recherche » reprend), puis le fil. */
export const discussionSchema = z.object({
  brief: z.string().max(CRITERIA_LIMITS.brief),
  criteria: criteriaSchema,
  // Au-delà, coupée par fitDiscussion ; borné pour ne pas traiter un envoi démesuré.
  messages: z.array(discussionMessageSchema).max(500),
})
export interface MbcDiscussion { brief: string; criteria: MbcCriteria; messages: DiscussionMessage[] }

/** Personne révélée pendant la discussion : sa ligne de recherche (affichage, note) et son profil complet. */
export interface DiscussionPerson { search: MbcProfile; profile: MbcRevealed }

/**
 * Discussion à écrire : le premier message (le besoin) et les plus récents, dans les limites de nombre et de taille. Les
 * messages intermédiaires d'une très longue discussion sont perdus, jamais le besoin ni la fin.
 */
export function fitDiscussion(d: MbcDiscussion): MbcDiscussion {
  const [first, ...rest] = d.messages
  if (!first) return d
  let size = JSON.stringify({ ...d, messages: [first] }).length
  const kept: DiscussionMessage[] = []
  for (let i = rest.length - 1; i >= 0 && kept.length < DISCUSSION_LIMITS.messages - 1; i--) {
    const added = JSON.stringify(rest[i]).length + 1
    if (size + added > DISCUSSION_LIMITS.chars) break
    size += added
    kept.unshift(rest[i])
  }
  return { ...d, messages: [first, ...kept] }
}

/** Discussion relue ; absente ou illisible : null (la recherche se rouvre alors comme avant, en la relançant). */
export function parseDiscussion(raw: unknown): MbcDiscussion | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = discussionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Personnes à écrire : le profil complet passe par revealJson (mêmes coupes que les profils révélés gardés), **sans le
 * téléphone** (ADR 0042 : il ne vit qu'avec le profil de l'organisation, 90 jours, et la personne enregistrée).
 */
export const discussionPeopleJson = (people: DiscussionPerson[]) =>
  JSON.stringify(people.map(p => ({ search: p.search, profile: revealJson(withoutPhone(p.profile)) })))

const withoutPhone = (profile: MbcRevealed): MbcRevealed => {
  const copy = { ...profile }
  delete copy.phone
  return copy
}

/** Personnes relues, avec les garanties d'un profil révélé (liens https, adresse simple) ; une entrée illisible est écartée. */
export function parseDiscussionPeople(raw: unknown): DiscussionPerson[] {
  if (typeof raw !== 'string' || !raw) return []
  let list: unknown
  try { list = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    const search = searchRowSchema.safeParse((item as { search?: unknown } | null)?.search)
    if (!search.success) return []
    const profile = parseRevealedJson((item as { profile?: unknown }).profile, search.data.id)
    return profile ? [{ search: search.data, profile: withoutPhone(profile) }] : []
  })
}

/**
 * Personnes de la discussion après un enregistrement : celles déjà gardées, puis les nouvelles, sans doublon, dans la
 * limite de nombre et de taille (au-delà, les nouvelles ne sont pas gardées).
 */
export function mergeDiscussionPeople(kept: DiscussionPerson[], added: DiscussionPerson[]): DiscussionPerson[] {
  const out = [...kept]
  const ids = new Set(kept.map(p => p.profile.id))
  let size = discussionPeopleJson(kept).length
  for (const p of added) {
    if (out.length >= DISCUSSION_LIMITS.people) break
    if (ids.has(p.profile.id)) continue
    // Une personne de plus : son texte et une virgule.
    const extra = discussionPeopleJson([p]).length - 1
    if (size + extra > DISCUSSION_LIMITS.peopleChars) break
    size += extra
    ids.add(p.profile.id)
    out.push(p)
  }
  return out
}
