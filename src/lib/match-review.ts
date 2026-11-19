// Revue d'une correspondance de la base candidats par le recruteur, et origine de la correspondance (ADR 0047). Sans
// dépendance au serveur : lu aussi par la page Matching IA dans le navigateur (filtres, boutons). Testé dans
// ai-matches.test.ts.

export type ReviewStatus = 'nouveau' | 'retenu' | 'contacte' | 'ecarte'
export const REVIEW_STATUSES: ReviewStatus[] = ['nouveau', 'retenu', 'contacte', 'ecarte']
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  nouveau: 'Nouveau',
  retenu: 'Retenu',
  contacte: 'Contacté',
  ecarte: 'Écarté',
}
/** Statut enregistré ; absent ou inconnu (ligne d'avant la revue) : « nouveau ». */
export const parseReviewStatus = (value: unknown): ReviewStatus =>
  REVIEW_STATUSES.find(s => s === value) ?? 'nouveau'

/** Origine d'une correspondance de la base candidats : trouvée au premier CV du candidat, ou par le Matching IA de l'offre. */
export type MatchOrigin = 'auto' | 'offre'
export const parseMatchOrigin = (value: unknown): MatchOrigin => (value === 'auto' ? 'auto' : 'offre')
