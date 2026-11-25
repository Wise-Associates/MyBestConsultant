import { z } from 'zod'
import { ROLE_SEED } from '@/lib/cv-classification-rules-data'
import { CRITERIA_LIMITS, cleanLabel } from '@/lib/offer-criteria'
import { cleanTitle } from './cv-search'

// « Autres intitulés du métier » proposés dans les critères d'une offre (ADR 0062) : les autres écritures du métier dans le
// dictionnaire de la classification des CV (ROLE_SEED : « Data Engineer | Ingénieur data | Ingénieur données »), puis
// les métiers que portent le plus souvent les CV classés qui exercent celui de l'offre (comptes de l'index de recherche,
// aucun CV renvoyé). Ce sont des propositions, jamais ajoutées sans un clic. Un métier plus général que celui de l'offre
// (« Chef de projet » pour « Chef de projet SAP »), un autre métier connu du dictionnaire (« Data Analyst » pour « Data
// Engineer ») ou un métier qui ne partage avec elle qu'un mot générique (« Développeur ») n'est pas proposé : un autre
// intitulé élargit la recherche des CV à tous ceux qui le portent. Pur, testé (related-titles.test.ts).

/** Propositions montrées au plus. */
export const MAX_TITLE_SUGGESTIONS = 8
/** Un intitulé porté par un seul CV n'est pas proposé : trop rare pour élargir la recherche, souvent une coquille. */
const MIN_COUNT = 2

export interface TitleSuggestion {
  title: string
  /** CV classés qui portent cet intitulé ; null : tiré du dictionnaire. */
  count: number | null
}

/** Ce que le navigateur envoie (relu par TitleSuggestionInputSchema) et reçoit ; `note` : propositions partielles. */
export interface TitleRequest { title: string; exclude: string[] }
export type TitleSuggestionsResult = { titles: TitleSuggestion[]; note?: string; error?: undefined } | { error: string }

/** Demande du navigateur : métier de l'offre et intitulés déjà présents (libellés d'Intitulé, autres intitulés). */
export const TitleSuggestionInputSchema = z.strictObject({
  title: z.string().transform(t => cleanLabel(t)).pipe(z.string().min(2).max(CRITERIA_LIMITS.label)),
  exclude: z.array(z.string().max(CRITERIA_LIMITS.label)).max(20),
})

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Mots sans portée pour comparer deux intitulés (comme les mots vides des titres d'offres, cv-search.ts).
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'a', 'd', 'l', 'h', 'f', 'senior', 'junior', 'confirme', 'expert'])
// Mots de métier trop généraux pour dire à eux seuls qu'un intitulé est le même métier.
const GENERIC = new Set(['developpeur', 'developer', 'ingenieur', 'engineer', 'consultant', 'chef', 'projet', 'projets', 'analyste', 'architecte', 'responsable', 'manager', 'lead', 'technicien', 'administrateur', 'charge', 'directeur'])
const words = (s: string) => fold(s).split(/[^a-z0-9+#.]+/).map(w => w.replace(/^\.+|\.+$/g, '')).filter(w => w && !STOP.has(w))
/** Clé d'un intitulé : mêmes mots dans le même ordre, sans accents, tirets ni espaces (« Full-Stack » = « Fullstack »). */
const keyOf = (s: string) => words(s).join('')

/** Entrées du dictionnaire : leurs écritures, sans la marque « = » (reconnue seulement écrite ainsi). */
const ENTRIES: string[][] = Object.values(ROLE_SEED).flatMap(list => (list ?? []).map(entry => entry.split('|').map(v => v.replace(/^=/, '').trim())))

/** Entrée du dictionnaire dont une écriture est exactement cet intitulé ; -1 sinon. */
const entryOf = (title: string) => {
  const key = keyOf(title)
  return key ? ENTRIES.findIndex(variants => variants.some(v => keyOf(v) === key)) : -1
}

/** Autres écritures du métier dans le dictionnaire (sans les sigles de 3 lettres, que l'index connaît déjà en synonymes). */
export function dictionaryTitles(title: string): string[] {
  const entry = entryOf(cleanTitle(title))
  if (entry === -1) return []
  const own = keyOf(cleanTitle(title))
  const seen = new Set([own])
  return ENTRIES[entry].filter(v => v.length > 3 && !seen.has(keyOf(v)) && seen.add(keyOf(v)))
}

/** Métiers des CV (`counts` : intitulé → nombre de CV) qui peuvent servir d'autre intitulé, du plus porté au moins porté. */
export function indexTitles(title: string, counts: Record<string, number>): TitleSuggestion[] {
  const base = cleanTitle(title)
  const own = new Set(words(base))
  const ownEntry = entryOf(base)
  return Object.entries(counts)
    .filter(([value, count]) => {
      if (count < MIN_COUNT) return false
      const mine = words(value)
      if (mine.length === 0 || mine.every(w => own.has(w))) return false
      const entry = entryOf(value)
      if (entry !== -1 && entry !== ownEntry) return false
      return mine.some(w => own.has(w) && !GENERIC.has(w))
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .map(([value, count]) => ({ title: cleanLabel(value), count }))
}

/**
 * Propositions pour le métier `title` : dictionnaire d'abord, puis métiers des CV (`counts`, null si l'index n'a pas
 * répondu), sans ceux déjà présents (`exclude`) ni doublons, MAX_TITLE_SUGGESTIONS au plus.
 */
export function titleSuggestions(title: string, counts: Record<string, number> | null, exclude: string[]): TitleSuggestion[] {
  const seen = new Set([keyOf(cleanTitle(title)), ...exclude.map(keyOf)])
  const all = [...dictionaryTitles(title).map(t => ({ title: t, count: null })), ...(counts ? indexTitles(title, counts) : [])]
  return all.filter(s => s.title && !seen.has(keyOf(s.title)) && seen.add(keyOf(s.title))).slice(0, MAX_TITLE_SUGGESTIONS)
}
