import { createHash } from 'node:crypto'
import { z } from 'zod'
import { APOLLO_PERSON_ID, type MbcProfile, type MbcRevealed } from './rules'
import { parseRevealedJson, revealJson } from './reveals'

// Personnes enregistrées par un recruteur dans MBC Search (collection mbc_saved_people, ADR 0018) : règles pures,
// testées. Enregistrer une personne la révèle (un crédit Apollo si l'organisation ne l'a pas déjà révélée) et la garde
// dans la liste du recruteur, révélée, jusqu'à ce qu'il la retire ou que son compte soit supprimé (décision du client,
// 2026-11-06). Liste personnelle : aucun collègue ne la voit. Serveur seulement (node:crypto) ; l'écran n'en importe
// que des types.

/** Personnes enregistrées par recruteur : la liste entière est chargée avec la page. */
export const SAVED_PEOPLE_MAX = 200

/** Une personne enregistrée, telle que l'écran la reçoit. */
export interface MbcSavedPerson {
  /** Ligne de la recherche où elle a été enregistrée : sert à la noter selon les critères affichés. */
  search: MbcProfile
  profile: MbcRevealed
  savedAt: string
}

/**
 * Identifiant du document : dérivé du compte du recruteur et de la personne (36 caractères). Enregistrer deux fois la
 * même personne vise le même document, et celui d'un autre recruteur est hors d'atteinte.
 */
export function savedPersonDocId(userId: string, apolloId: string): string {
  return 'p' + createHash('sha256').update(`${userId}\n${apolloId}`).digest('hex').slice(0, 35)
}

/**
 * Texte borné : une valeur trop longue d'Apollo est coupée, une valeur démesurée refusée. Les caractères de contrôle
 * sont remplacés : échappés en JSON (\uXXXX, six fois plus longs), ils feraient dépasser l'attribut searchJson.
 */
const clipped = (max: number) => z.string().max(2000).transform(v => v.replace(/\p{Cc}/gu, ' ').slice(0, max))

/**
 * Ligne de recherche envoyée par le navigateur avec « Enregistrer » : seuls ces champs, bornés. Elle ne sert qu'à
 * afficher et noter la personne dans la liste de ce recruteur ; le profil complet, lui, vient toujours du serveur.
 */
export const searchRowSchema = z.object({
  id: z.string().regex(APOLLO_PERSON_ID),
  firstName: clipped(100),
  lastNameMasked: clipped(100),
  title: clipped(300),
  company: clipped(300),
  hasEmail: z.boolean(),
  hasPhone: z.boolean(),
  refreshedAt: clipped(40),
})

/** Attributs du document pour cette personne. */
export function savedPersonFields(search: MbcProfile, profile: MbcRevealed): { searchJson: string; profileJson: string } {
  return { searchJson: JSON.stringify(search), profileJson: revealJson(profile) }
}

/**
 * Relit un document ; illisible ou incohérent : null (la personne n'apparaît pas ; `listSavedPeople` le journalise, et
 * il n'est supprimé qu'avec le compte).
 */
export function parseSavedPersonDoc(doc: Record<string, unknown>): MbcSavedPerson | null {
  const profile = parseRevealedJson(doc.profileJson, doc.apolloId)
  if (!profile) return null
  let raw: unknown
  try { raw = JSON.parse(typeof doc.searchJson === 'string' ? doc.searchJson : '') } catch { return null }
  const search = searchRowSchema.safeParse(raw)
  if (!search.success || search.data.id !== profile.id) return null
  return { search: search.data, profile, savedAt: typeof doc.savedAt === 'string' ? doc.savedAt : '' }
}
