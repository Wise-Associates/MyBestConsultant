import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CRITERIA_LIMITS, criteriaSchema, savedSearchName, type MbcCriteria } from './rules'

// Historique des recherches de MBC Search (collection mbc_searches, ADR 0018) : règles pures, testées. Un document par
// recruteur et par jeu de critères : relancer la même recherche met à jour sa ligne au lieu d'en ajouter une.
// Serveur seulement (node:crypto) ; l'écran n'en importe que des types. Seuls les critères, le brief et le nombre de résultats sont gardés : jamais un profil trouvé ni une coordonnée.

/** Recherches gardées dans l'historique d'un recruteur, hors recherches enregistrées (les plus anciennes sont supprimées). */
export const SEARCH_HISTORY_MAX = 50
/** Recherches enregistrées (épinglées, avec un nom) par recruteur. */
export const SAVED_SEARCHES_MAX = 20

/** Une ligne de l'historique, telle que l'écran la reçoit. */
export interface MbcSearchEntry {
  id: string
  name: string
  brief: string
  criteria: MbcCriteria
  /** Enregistrée par le recruteur (nommée, jamais supprimée de l'historique automatiquement). */
  pinned: boolean
  /** Nombre de profils trouvés par Apollo à la dernière recherche. */
  total: number
  lastRunAt: string
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')
const canon = (list: string[] | undefined) => [...new Set((list ?? []).map(norm))].sort()

/**
 * Forme canonique des critères : mêmes valeurs à la casse, aux accents et à l'ordre près = même recherche.
 * Les compétences obligatoires retirées de la liste des compétences ne comptent pas (elles ne servent plus).
 */
export function criteriaKey(c: MbcCriteria): string {
  const skills = canon(c.skills)
  return JSON.stringify({
    titles: canon(c.titles),
    locations: canon(c.locations),
    seniorities: [...new Set(c.seniorities)].sort(),
    skills,
    required: canon(c.requiredSkills).filter(r => skills.includes(r)),
    sectors: canon(c.sectors),
    emailOnly: c.emailOnly === true,
    recentOnly: c.recentOnly === true,
  })
}

/**
 * Identifiant du document : dérivé du compte du recruteur et des critères (36 caractères, lettres et chiffres).
 * Deux recherches simultanées identiques visent donc le même document, et celui d'un autre recruteur est hors d'atteinte.
 */
export function searchDocId(userId: string, criteria: MbcCriteria): string {
  return 's' + createHash('sha256').update(`${userId}\n${criteriaKey(criteria)}`).digest('hex').slice(0, 35)
}

export const searchNameSchema = z.string().trim().min(1, 'Donnez un nom à la recherche.').max(CRITERIA_LIMITS.item, `Nom limité à ${CRITERIA_LIMITS.item} caractères.`)

/** Identifiant reçu du navigateur : seulement la forme produite par searchDocId. */
export const searchIdSchema = z.string().regex(/^s[a-f0-9]{35}$/)

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Lit un document de la collection ; critères illisibles (format d'une ancienne version) : ligne écartée. */
export function parseSearchDoc(doc: Record<string, unknown>): MbcSearchEntry | null {
  let raw: unknown
  try { raw = JSON.parse(str(doc.criteriaJson)) } catch { return null }
  const criteria = criteriaSchema.safeParse(raw)
  if (!criteria.success) return null
  return {
    id: str(doc.$id),
    name: str(doc.name).slice(0, CRITERIA_LIMITS.item) || savedSearchName(criteria.data),
    brief: str(doc.brief).slice(0, CRITERIA_LIMITS.brief),
    criteria: criteria.data,
    pinned: doc.pinned === true,
    total: typeof doc.total === 'number' && Number.isFinite(doc.total) ? Math.max(0, Math.trunc(doc.total)) : 0,
    lastRunAt: str(doc.lastRunAt),
  }
}

/** Lignes non enregistrées au-delà des SEARCH_HISTORY_MAX plus récentes : à supprimer (liste triée, plus récente d'abord). */
export function historyOverflow(list: MbcSearchEntry[]): string[] {
  return list.filter(e => !e.pinned).slice(SEARCH_HISTORY_MAX).map(e => e.id)
}
