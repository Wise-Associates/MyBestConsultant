import type { JobMatchResult } from '@/lib/matching-core'
import type { AoOfferRow } from './filters'
import type { AoSyncReport } from './sync'
import type { AoContract, AoEmail, AoRemote } from './types'

// Contrat du tableau des appels d'offres (src/components/ao/ao-offers-dashboard.tsx), affiché dans /admin/candidats
// (boîtes de la plateforme) et dans /recruiter/parametres/boites-ao (boîtes de l'organisation du recruteur). Chaque
// page fournit ses actions serveur, qui vérifient elles-mêmes l'appelant et son organisation (offer-actions.ts).

export interface PublicationDraft {
  title: string
  companyName: string
  description: string
  location: string
  contractType: AoContract
  remote: AoRemote
  salary: number | null
  skills: string[]
  /** Case « J'ai relu » cochée par la personne qui publie : la publication est refusée sans elle (ADR 0013). */
  reviewed: boolean
  /** Noms que l'IA dit avoir retirés (sigles, entités, projets) : masqués eux aussi à la publication. */
  maskTerms: string[]
  /**
   * false : publication non anonymisée, choisie par la personne qui publie (« Publier sans anonymiser ») — client et
   * noms gardés, coordonnées personnelles retirées (rawPublicOffer). Absent ou true : anonymisée (ADR 0013).
   */
  anonymized: boolean
}

/** anonymized : version anonymisée (IA ou règles, ADR 0013) ; raw : l'offre telle que reçue, à relire (sans IA). */
export type PublicationMode = 'anonymized' | 'raw'

export interface PublicationPreview {
  draft: PublicationDraft
  /** Offres déjà en ligne au même intitulé et dans la même ville (risque de doublon). */
  similarJobs: { id: string; title: string; location: string }[]
  /**
   * ai : version rédigée par l'IA ; rules : par les règles automatiques seules (IA refusée ou en échec, voir `notice`) ;
   * raw : version non anonymisée (offre telle que reçue, coordonnées personnelles retirées).
   */
  rewrite: 'ai' | 'rules' | 'raw'
  /** Pourquoi l'IA n'a pas rédigé cette version ; vide sinon. */
  notice: string
  /** Noms à signaler s'ils réapparaissent pendant la relecture (mots normalisés, name-match.ts). */
  watchNames: string[][]
}

/** Candidat retenu pour une offre AO (les 5 meilleurs notés 65 ou plus, sourcing-rules.ts). */
export interface SourcedCandidate {
  id: string
  name: string
  score: number | null
  reason: string
  /** pool : base candidats ; vivier : CV ajouté à l'offre publiée ; application : candidature reçue. */
  origin: JobMatchResult['source']
}

export interface SourcingResult {
  candidates?: SourcedCandidate[]
  /** Date du calcul (null : jamais calculé pour cette offre). */
  computedAt?: string | null
  /** CV analysés (offre non publiée). */
  scanned?: number
  error?: string
}

/** Commentaire tel qu'affiché : `mine` permet de proposer la suppression à son auteur seulement. */
export interface AoCommentView {
  id: string
  authorName: string
  body: string
  createdAt: string
  mine: boolean
}

/** Indicateurs du haut du tableau, sur toutes les offres de l'organisation (pas seulement celles qui passent les filtres). */
export interface AoOfferCounts {
  toReview: number
  published: number
  ignored: number
  /** E-mails fusionnés dans une offre déjà reçue (somme des sourceCount - 1). */
  duplicates: number
}

/** Place d'une offre dans la liste filtrée (page de l'offre) : offres précédente et suivante, dans l'ordre du tableau. */
export interface AoOfferNeighbours {
  previous: string | null
  next: string | null
  /** Rang de l'offre (1 pour la première) ; null si elle ne passe pas les filtres (statut changé depuis…). */
  position: number | null
  total: number
}

/** Le tableau : offres filtrées par le serveur (index de la liste, offer-index.ts). */
export interface AoPageView {
  rows: AoOfferRow[]
  /** Offres listées (AO_MAX_LISTED au plus : les plus récentes). */
  total: number
  counts: AoOfferCounts
  recentEmails: AoEmail[]
}

/**
 * Réponse d'un passage de « Synchroniser maintenant » (route POST …/sync de l'espace, enchaînée par AoSyncProvider),
 * avec, si la page AO est affichée, son tableau à jour (`query` : ses filtres, forme canonique).
 */
export interface AoSyncPassResult {
  report?: AoSyncReport
  view?: AoPageView & { query: string }
  error?: string
}

export interface AoDashboardActions {
  retryEmail(id: string): Promise<{ report?: AoSyncReport; error?: string }>
  deleteOffer(id: string): Promise<{ error?: string }>
  previewPublication(id: string, mode?: PublicationMode): Promise<{ preview?: PublicationPreview; error?: string }>
  publish(id: string, input: PublicationDraft): Promise<{ jobId?: string; error?: string }>
  setStatus(id: string, status: 'to_review' | 'ignored'): Promise<{ error?: string }>
  /**
   * « Tout arrêter » du panneau d'une offre publiée : diffusion LinkedIn pas encore remise à Make et e-mails automatiques
   * aux candidats pas encore envoyés (stopAoPublicationTasksOf).
   */
  stopTasks?: (id: string) => Promise<{ message?: string; error?: string }>
  /** Section « Sourcing » du panneau (absente si la page ne fournit pas l'action) ; quota quotidien côté recruteurs. */
  sourcing?: (id: string, recompute?: boolean) => Promise<SourcingResult>
  listComments(offerId: string): Promise<{ comments?: AoCommentView[]; error?: string }>
  addComment(offerId: string, body: string): Promise<{ comment?: AoCommentView; error?: string }>
  deleteComment(commentId: string): Promise<{ error?: string }>
}

/** Liens propres à l'espace de la page. */
export interface AoDashboardPaths {
  /** La liste des offres ; la page d'une offre est `${list}/<id>`. */
  list: string
  statistics: string
  mailboxes: string
  /** Export Excel (GET, filtres du tableau en paramètres). */
  exportApi: string
  /** E-mail d'origine et pièces jointes : `${originalApi}/${emailId}`. */
  originalApi: string
  /** Liste des offres publiées, quand l'offre publique n'est pas connue. */
  jobs: string
}

/** Textes propres à l'espace de la page. */
export interface AoDashboardCopy {
  title: string
  /** Boîtes lues, à la suite de « boîte(s) » : « de la plateforme », « de votre organisation ». */
  scope: string
  /** Sous le formulaire de publication : ce que la publication déclenche. */
  publishNote: string
  /**
   * Suivi de la publication : page où relancer une diffusion LinkedIn en échec ou sans confirmation. `jobParam` : nom du
   * paramètre d'adresse par lequel cette page reçoit l'offre publique à montrer (`?offre=<id>` du tableau de bord recruteur).
   */
  social: { href: string; label: string; jobParam?: string }
}
