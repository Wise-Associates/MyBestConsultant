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
}

export interface PublicationPreview {
  draft: PublicationDraft
  /** Offres déjà en ligne au même intitulé et dans la même ville (risque de doublon). */
  similarJobs: { id: string; title: string; location: string }[]
  /** ai : version rédigée par l'IA ; rules : par les règles automatiques seules (IA refusée ou en échec, voir `notice`). */
  rewrite: 'ai' | 'rules'
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

/**
 * Réponse d'un passage de « Synchroniser maintenant » (route POST …/sync de l'espace, enchaînée par AoSyncProvider),
 * avec les données à jour du tableau.
 */
export interface AoSyncPassResult {
  report?: AoSyncReport
  rows?: AoOfferRow[]
  recentEmails?: AoEmail[]
  error?: string
}

export interface AoDashboardActions {
  retryEmail(id: string): Promise<{ report?: AoSyncReport; error?: string }>
  deleteOffer(id: string): Promise<{ error?: string }>
  previewPublication(id: string): Promise<{ preview?: PublicationPreview; error?: string }>
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
  eyebrow: string
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
  /** Lien de retour au-dessus du titre (espace recruteur, sans menu latéral). */
  back?: { href: string; label: string }
}
