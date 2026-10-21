// Règle du sourcing (décision du 2026-10-21) : seuls les 5 meilleurs candidats notés 65 ou plus sont retenus, pour
// l'e-mail automatique envoyé à la création d'une offre (auto-source-candidates.ts) comme pour l'affichage du sourcing
// d'une offre AO. Un seul endroit pour les deux.

export const SOURCING_TOP_N = 5
export const SOURCING_MIN_SCORE = 65

/** Les SOURCING_TOP_N candidats les mieux notés parmi ceux notés au moins SOURCING_MIN_SCORE. */
export function bestMatches<T extends { score: number | null }>(candidates: T[]): T[] {
  return candidates
    .filter(c => c.score !== null && c.score >= SOURCING_MIN_SCORE)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, SOURCING_TOP_N)
}
