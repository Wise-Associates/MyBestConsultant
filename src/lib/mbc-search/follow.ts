import { z } from 'zod'

// Suivi des personnes enregistrées de MBC Search (ADR 0039, phase 3, demande du 2026-11-17) : statut, note et
// étiquettes du recruteur sur chaque personne de sa sélection, gardés avec elle (attributs followStatus, followNote,
// followTags de mbc_saved_people) et supprimés avec elle ou avec le compte. Liste personnelle : aucun collègue ne la
// voit. Règles pures, testées (follow.test.ts), utilisées aussi dans le navigateur.

/** Étapes du suivi d'une personne, dans l'ordre (le premier : statut d'une personne tout juste enregistrée). */
export const FOLLOW_STATUSES = {
  a_examiner: 'À examiner',
  preselectionne: 'Présélectionné',
  contacte: 'Contacté',
  interesse: 'Intéressé',
  entretien_prevu: 'Entretien prévu',
  entretien_passe: 'Entretien passé',
  refuse: 'Refusé',
  embauche: 'Embauché',
} as const
export type FollowStatus = keyof typeof FOLLOW_STATUSES
const STATUS_IDS = Object.keys(FOLLOW_STATUSES) as [FollowStatus, ...FollowStatus[]]

/** Bornes : celles des attributs (followNote 2000, followTags 40 par étiquette). */
export const FOLLOW_LIMITS = { note: 2000, tags: 10, tag: 40 } as const

export interface MbcFollow {
  status: FollowStatus
  note: string
  tags: string[]
}

export const DEFAULT_FOLLOW: MbcFollow = { status: 'a_examiner', note: '', tags: [] }

/** Caractères de contrôle remplacés (sauf le retour à la ligne d'une note) : ils n'ont rien à faire dans un texte saisi. */
const cleanText = (v: string, keepNewlines: boolean) => v.replace(/\p{Cc}/gu, c => (keepNewlines && c === '\n' ? c : ' '))

/** Suivi envoyé par le navigateur : statut connu, note et étiquettes bornées, étiquettes sans doublon (casse comprise). */
export const followSchema = z.object({
  status: z.enum(STATUS_IDS),
  note: z.string().max(FOLLOW_LIMITS.note).transform(v => cleanText(v, true).trim()),
  tags: z.array(z.string().max(FOLLOW_LIMITS.tag).transform(v => cleanText(v, false).trim())).max(FOLLOW_LIMITS.tags)
    .transform(tags => tags.filter((t, i) => t !== '' && tags.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i)),
})

/**
 * Suivi relu sur un document (attributs absents ou null avant leur création, ou écrits à la main), champ par champ : une
 * valeur invalide reprend sa valeur par défaut sans effacer les autres — le suivi enregistré ensuite les réécrit tous.
 */
export function parseFollow(doc: Record<string, unknown>): MbcFollow {
  const field = <K extends keyof MbcFollow>(key: K, value: unknown): MbcFollow[K] => {
    const parsed = followSchema.shape[key].safeParse(value)
    return parsed.success ? parsed.data as MbcFollow[K] : DEFAULT_FOLLOW[key]
  }
  return {
    status: field('status', doc.followStatus),
    note: field('note', typeof doc.followNote === 'string' ? doc.followNote : ''),
    tags: field('tags', Array.isArray(doc.followTags) ? doc.followTags.filter((t): t is string => typeof t === 'string') : []),
  }
}

/** Attributs écrits pour un suivi. */
export const followFields = (f: MbcFollow) => ({ followStatus: f.status, followNote: f.note, followTags: f.tags })

/** Personnes cochées pour « Comparer » au plus : au-delà, les colonnes de la fenêtre ne tiennent plus. */
export const COMPARE_MAX = 3

/**
 * Coche ou décoche `id` pour « Comparer » : les personnes qui ne sont plus dans la sélection (`kept` faux) sont oubliées
 * d'abord, pour qu'elles ne prennent pas une des COMPARE_MAX places ; au-delà, la case ne se coche pas.
 */
export function toggleCompared(current: string[], id: string, kept: (id: string) => boolean): string[] {
  const still = current.filter(kept)
  if (still.includes(id)) return still.filter(x => x !== id)
  return still.length < COMPARE_MAX ? [...still, id] : still
}

/** Nombre de personnes par statut (filtre de la sélection), dans l'ordre des statuts. */
export function countByStatus(follows: MbcFollow[]): Record<FollowStatus, number> {
  const counts = Object.fromEntries(STATUS_IDS.map(s => [s, 0])) as Record<FollowStatus, number>
  for (const f of follows) counts[f.status]++
  return counts
}
