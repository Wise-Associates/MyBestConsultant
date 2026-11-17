import { csvCell } from '@/lib/screening-csv'
import type { MbcRevealed } from './rules'
import type { PoolProfile } from './strategies'

// Liste des profils d'une recherche de MBC Search (ADR 0037, phase 2) : filtres, tri et export CSV, appliqués dans le
// navigateur sur les profils déjà chargés (aucun appel à Apollo). Règles pures, testées (results-view.test.ts).

export type PoolSort = 'score' | 'ai' | 'recent'

export interface PoolFilters {
  /** Texte cherché dans le nom, l'intitulé, l'employeur et le lieu (révélé). */
  text: string
  /** Score de classement minimal (0 : tous). */
  minScore: number
  emailOnly: boolean
  revealedOnly: boolean
  evaluatedOnly: boolean
  /** Requête qui a trouvé le profil (numéro dans l'ordre des requêtes) ; null : toutes. */
  strategy: number | null
  sort: PoolSort
}

export const DEFAULT_POOL_FILTERS: PoolFilters = {
  text: '', minScore: 0, emailOnly: false, revealedOnly: false, evaluatedOnly: false, strategy: null, sort: 'score',
}

/** Ce que la page sait de plus sur chaque profil : profil révélé, score de l'évaluation par l'IA. */
export interface PoolContext {
  revealed: Record<string, MbcRevealed>
  aiScore: Record<string, number>
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Filtres actifs (pour l'afficher et proposer de les retirer). */
export const hasActiveFilters = (f: PoolFilters) =>
  f.text.trim() !== '' || f.minScore > 0 || f.emailOnly || f.revealedOnly || f.evaluatedOnly || f.strategy !== null

/**
 * Profils qui passent les filtres, dans l'ordre demandé : score de classement (ordre de la liste), score de l'IA
 * (profils évalués d'abord), ou mise à jour chez Apollo la plus récente. À égalité, l'ordre de la liste.
 */
export function filterPool(pool: PoolProfile[], f: PoolFilters, ctx: PoolContext): PoolProfile[] {
  const words = normalize(f.text).split(/\s+/).filter(Boolean)
  const kept = pool.filter(p => {
    const full = ctx.revealed[p.id]
    if (f.minScore > 0 && p.score < f.minScore) return false
    if (f.emailOnly && !p.hasEmail) return false
    if (f.revealedOnly && !full) return false
    if (f.evaluatedOnly && ctx.aiScore[p.id] === undefined) return false
    if (f.strategy !== null && !p.strategies.includes(f.strategy)) return false
    if (words.length === 0) return true
    const haystack = normalize([p.firstName, p.lastNameMasked, p.title, p.company, full?.name, full?.title, full?.company, full?.location].filter(Boolean).join(' '))
    return words.every(w => haystack.includes(w))
  })
  if (f.sort === 'score') return kept
  const rank = (p: PoolProfile) => (f.sort === 'ai' ? ctx.aiScore[p.id] ?? -1 : Date.parse(p.refreshedAt) || 0)
  return kept.map((p, i) => ({ p, i })).sort((a, b) => rank(b.p) - rank(a.p) || a.i - b.i).map(x => x.p)
}

/**
 * Export CSV des profils (ceux affichés par les filtres) : ce que la page montre, sans plus — nom de famille masqué,
 * e-mail et LinkedIn seulement pour un profil révélé. Cellules neutralisées (csvCell : une formule ne s'exécute pas).
 */
export function poolCsv(rows: PoolProfile[], ctx: PoolContext): string {
  const header = ['Nom', 'Intitulé', 'Employeur', 'Lieu', 'E-mail', 'LinkedIn', 'Score', 'Score IA', 'Profil révélé', 'Mis à jour chez Apollo']
  const lines = rows.map(p => {
    const full = ctx.revealed[p.id]
    const ai = ctx.aiScore[p.id]
    return [
      full?.name || [p.firstName, p.lastNameMasked].filter(Boolean).join(' '),
      full?.title || p.title, full?.company || p.company, full?.location ?? '', full?.email ?? '', full?.linkedinUrl ?? '',
      String(p.score), ai === undefined ? '' : String(ai), full ? 'oui' : 'non', p.refreshedAt.slice(0, 10),
    ].map(csvCell).join(',')
  })
  return [header.map(csvCell).join(','), ...lines].join('\n')
}
