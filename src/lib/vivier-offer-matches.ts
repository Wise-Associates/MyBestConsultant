import { createHash } from 'node:crypto'
import { REASON_MAX, VIVIER_MATCH_MIN_SCORE, type OfferScore } from './vivier-matching'

// Correspondances du vivier général (ADR 0026) : une ligne par CV et par offre à laquelle il correspond (65 ou plus),
// collection vivier_offer_matches, pour que le Matching IA d'une offre lise par un index ses seuls CV correspondants.
// Avant : les scores enregistrés sur chaque CV (vivier_cvs.offerMatchesJson) cherchés par sous-chaîne, sans index et
// plafonnés à 200 CV non triés, si bien qu'un CV noté 90 pouvait manquer. offerMatchesJson reste la source : ces lignes
// en sont la copie, réécrite à chaque enregistrement des scores d'un CV et reconstruite par `npm run vivier:matches`.
// Règles pures, testées dans vivier-offer-matches.test.ts ; lecture et écriture : src/lib/appwrite/vivier-offer-matches.ts.

export interface VivierOfferMatchRow {
  tenantId: string
  jobId: string
  vivierCvId: string
  score: number
  reason: string
}

/**
 * Identifiant de la ligne : le même pour un CV et une offre, pour que deux écritures simultanées ne fassent qu'une ligne.
 * Haché : les deux identifiants bout à bout dépasseraient les 36 caractères d'Appwrite (offre « ao<id> »).
 */
export function matchRowId(vivierCvId: string, jobId: string): string {
  return `m${createHash('sha256').update(`${vivierCvId}:${jobId}`).digest('hex').slice(0, 32)}`
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Raison de la ligne : REASON_MAX caractères entiers au plus (taille de l'attribut, comptée par Appwrite en
 * caractères). Les raisons enregistrées sur le CV sont coupées en unités UTF-16 et peuvent finir par une moitié
 * d'emoji : sans effet dans le JSON du CV, mais refusée par Appwrite dans un champ (JSON de la requête invalide).
 */
function rowReason(reason: string): string {
  return Array.from(reason.replace(LONE_SURROGATE, '')).slice(0, REASON_MAX).join('')
}

/** Lignes qu'un CV doit avoir d'après ses scores : une par offre notée VIVIER_MATCH_MIN_SCORE ou plus. */
export function wantedRows(tenantId: string, vivierCvId: string, scores: OfferScore[]): Map<string, VivierOfferMatchRow> {
  return new Map(scores
    .filter(s => s.score >= VIVIER_MATCH_MIN_SCORE)
    .map(s => [matchRowId(vivierCvId, s.jobId), { tenantId, jobId: s.jobId, vivierCvId, score: s.score, reason: rowReason(s.reason) }]))
}

const sameRow = (a: VivierOfferMatchRow, b: VivierOfferMatchRow) =>
  a.tenantId === b.tenantId && a.jobId === b.jobId && a.vivierCvId === b.vivierCvId && a.score === b.score && a.reason === b.reason

/** Lignes à écrire (absentes ou différentes) et à supprimer (offre retirée des scores ou passée sous le seuil). */
export function rowChanges(
  existing: Map<string, VivierOfferMatchRow>, wanted: Map<string, VivierOfferMatchRow>,
): { write: [string, VivierOfferMatchRow][]; remove: string[] } {
  return {
    write: [...wanted].filter(([id, row]) => { const current = existing.get(id); return !current || !sameRow(current, row) }),
    remove: [...existing.keys()].filter(id => !wanted.has(id)),
  }
}
