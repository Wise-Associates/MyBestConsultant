import { createHash } from 'node:crypto'

// Écriture des notes de la base candidats d'une offre (collection job_matches) après un passage de runPoolMatching
// (matching-core.ts). Pur, testé dans pool-matching.test.ts. Règle (2026-11-04) : une note n'est jamais supprimée parce
// que son nouveau calcul a échoué ; avant, « Rafraîchir » supprimait toutes les notes puis n'en recréait qu'une partie.

export interface PoolRow {
  id: string
  candidateId: string
}

export interface PoolScore {
  candidateId: string
  score: number
  reason: string
}

/**
 * Identifiant d'une note : le même pour une offre et un candidat, pour que deux passages simultanés écrivent la même
 * ligne au lieu d'en créer deux. Haché : les deux identifiants bout à bout dépasseraient les 36 caractères d'Appwrite.
 */
export function poolRowId(jobId: string, candidateId: string): string {
  return `p${createHash('sha256').update(`${jobId}:${candidateId}`).digest('hex').slice(0, 32)}`
}

/**
 * Lignes à mettre à jour, à créer et à supprimer. `scope` : candidats dont ce passage avait la charge (vide pour
 * « Rafraîchir », qui n'en retire aucun) ; `considered` : ceux d'entre eux encore à noter, notés ou en échec. Partent
 * seulement les candidats du périmètre qui ne sont plus à noter (désinscrits, CV retiré, candidature envoyée depuis)
 * et les doublons d'un même candidat (lignes écrites avant les identifiants fixes).
 */
export function planPoolRows(
  existing: PoolRow[], scores: PoolScore[], scope: Set<string>, considered: Set<string>,
): { update: [string, PoolScore][]; create: PoolScore[]; remove: string[] } {
  const byCandidate = new Map<string, PoolRow>()
  const remove: string[] = []
  for (const row of existing) {
    if (byCandidate.has(row.candidateId)) remove.push(row.id)
    else byCandidate.set(row.candidateId, row)
  }
  const update: [string, PoolScore][] = []
  const create: PoolScore[] = []
  for (const s of scores) {
    const row = byCandidate.get(s.candidateId)
    if (row) update.push([row.id, s])
    else create.push(s)
  }
  for (const [candidateId, row] of byCandidate) {
    if (scope.has(candidateId) && !considered.has(candidateId)) remove.push(row.id)
  }
  return { update, create, remove }
}
