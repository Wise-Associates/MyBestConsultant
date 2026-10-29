import type { NetworkResult, SocialStatus } from '@/lib/social'
import { SOURCING_MIN_SCORE, SOURCING_TOP_N } from '@/lib/sourcing-rules'
import type { AoOfferStatus } from './types'

// Suivi d'une offre AO, de la validation au sourcing (colonne « Suivi » du tableau, section du panneau de détail) :
// règles pures, testées. Les faits sont relus par tracking-store.ts pour les offres publiées seulement, et les étapes
// calculées sur le serveur à l'heure du chargement de la page : même rendu côté serveur et navigateur. Une absence de
// donnée n'est jamais affichée comme un succès.

/** Diffusion sur les réseaux et sourcing démarrent en arrière-plan après la publication (after(), 300 s au plus). */
export const AFTER_PUBLICATION_MS = 6 * 60_000

/** Faits relus pour une offre publiée (tracking-store.ts). */
export interface AoTrackingFacts {
  /** Offre publique ; null : introuvable (supprimée, ou jamais créée). */
  job: {
    isActive: boolean
    expiresAt: string | null
    createdAt: string
    /**
     * Envoi LinkedIn direct (ancien circuit : linkedin-publish.ts, page Admin → LinkedIn), noté dès que le webhook ou
     * l'API répond, sans confirmation que la publication est en ligne.
     */
    linkedinPostedAt: string | null
  } | null
  /** Dernière diffusion de l'offre publique sur les réseaux ; null : aucune. `stopped` : arrêtée depuis le panneau. */
  social: { status: SocialStatus; stale: boolean; results: NetworkResult[]; stopped: boolean } | null
  /** Le sourcing a enregistré des scores pour cette offre (job_matches) : sans eux, il n'a pas abouti. */
  scored: boolean
  /** Candidats de la base notés SOURCING_MIN_SCORE ou plus par ce sourcing. */
  qualified: number
}

export interface TrackingContext {
  now: number
  /** « Publication automatique » activée dans /admin/social et Make configuré : chaque publication est diffusée. */
  socialAuto: boolean
}

/** done : fait ; working : en cours ; warning : à vérifier ; error : échec ; todo : pas encore, ou sans objet. */
export type TrackingTone = 'done' | 'working' | 'warning' | 'error' | 'todo'
export type TrackingStepKey = 'review' | 'job' | 'social' | 'sourcing'

export interface TrackingStep {
  key: TrackingStepKey
  label: string
  tone: TrackingTone
  /** État en quelques mots. */
  text: string
  /** Résultat à ouvrir : offre publique, publication LinkedIn. */
  url?: string
  /** Candidats retenus, SOURCING_TOP_N au plus (étape sourcing). */
  count?: number
}

const LABEL: Record<TrackingStepKey, string> = { review: 'Validation', job: 'Offre en ligne', social: 'LinkedIn', sourcing: 'Sourcing' }

function step(key: TrackingStepKey, tone: TrackingTone, text: string, extra: Pick<TrackingStep, 'url' | 'count'> = {}): TrackingStep {
  return { key, label: LABEL[key], tone, text, ...extra }
}

/** Les quatre étapes d'une offre ; sans `facts` ni `ctx`, celles d'une offre non publiée (ou au suivi non chargé). */
export function trackingSteps(
  offer: { status: AoOfferStatus; jobId: string | null },
  facts?: AoTrackingFacts,
  ctx?: TrackingContext,
): TrackingStep[] {
  if (offer.status !== 'published' && offer.jobId === null) {
    const later = 'Après la publication'
    return [
      step('review', 'todo', offer.status === 'ignored' ? 'Ignorée' : 'À valider'),
      step('job', 'todo', later), step('social', 'todo', later), step('sourcing', 'todo', later),
    ]
  }
  const review = step('review', 'done', 'Publiée')
  // Offre marquée publiée sans offre publique (données anciennes) : rien d'autre à suivre.
  if (offer.jobId === null) return [review, step('job', 'warning', 'Offre publique introuvable'), step('social', 'todo', '—'), step('sourcing', 'todo', '—')]
  if (!facts || !ctx) {
    const unknown = 'Suivi indisponible'
    return [review, step('job', 'todo', unknown), step('social', 'todo', unknown), step('sourcing', 'todo', unknown)]
  }
  const recent = facts.job !== null && ctx.now - Date.parse(facts.job.createdAt) < AFTER_PUBLICATION_MS
  return [
    review,
    jobStep(offer.jobId, facts.job, ctx.now),
    socialStep(facts.social, facts.job?.linkedinPostedAt ?? null, recent, ctx.socialAuto),
    sourcingStep(facts, recent),
  ]
}

function jobStep(jobId: string, job: AoTrackingFacts['job'], now: number): TrackingStep {
  // Introuvable plutôt que « supprimée » : une publication interrompue (création puis retour arrière) donne la même absence.
  if (!job) return step('job', 'warning', 'Introuvable')
  if (!job.isActive) return step('job', 'warning', 'Désactivée', { url: `/jobs/${jobId}` })
  if (job.expiresAt && Date.parse(job.expiresAt) <= now) return step('job', 'warning', 'Expirée', { url: `/jobs/${jobId}` })
  return step('job', 'done', 'En ligne', { url: `/jobs/${jobId}` })
}

function socialStep(social: AoTrackingFacts['social'], directPostedAt: string | null, recent: boolean, socialAuto: boolean): TrackingStep {
  // Arrêtée avant l'envoi (« Tout arrêter » du panneau, publication-stop.ts) : un choix, pas un échec.
  if (social?.stopped) return step('social', 'todo', 'Arrêtée avant l’envoi')
  // 1. Résultat propre à LinkedIn, rappelé par Make : lui seul dit que la publication est sur LinkedIn.
  const linkedin = social?.results.find(r => r.network === 'linkedin')
  // Lien venu de Make, affiché comme lien cliquable : https seulement (déjà vérifié à la réception, handleCallback).
  const url = linkedin?.url?.startsWith('https://') ? linkedin.url : undefined
  if (linkedin?.status === 'published') return step('social', 'done', 'Publiée', { url })
  if (linkedin?.status === 'scheduled') return step('social', 'done', 'Programmée', { url })
  if (linkedin?.status === 'failed') return step('social', 'error', 'Échec')
  if (linkedin?.status === 'skipped') return step('social', 'todo', 'Non visée par la diffusion')
  // 2. Diffusion en cours : Make n'a pas encore rappelé pour LinkedIn.
  if (social && !social.stale && (social.status === 'queued' || social.status === 'sent' || social.status === 'images_ready')) {
    return step('social', 'working', social.status === 'queued' ? 'Création du visuel' : 'Envoyée, en attente de confirmation')
  }
  // 3. Diffusion terminée sans résultat LinkedIn : les autres réseaux ne disent rien de LinkedIn.
  if (social) {
    if (social.status === 'failed') return step('social', 'error', 'Échec')
    if (social.stale) return step('social', 'warning', 'Sans confirmation')
    return step('social', 'warning', 'Aucun résultat LinkedIn')
  }
  // 4. Envoi direct de l'ancien circuit : rien ne confirme qu'il est en ligne (un webhook qui répond 200 suffit).
  if (directPostedAt) return step('social', 'warning', 'Envoyée directement, sans confirmation')
  // 5. Aucune diffusion : la diffusion automatique la crée dans les secondes qui suivent la publication.
  if (socialAuto && recent) return step('social', 'working', 'Diffusion en préparation')
  return socialAuto ? step('social', 'warning', 'Non diffusée') : step('social', 'todo', 'Non suivie (diffusion automatique inactive)')
}

function sourcingStep({ scored, qualified }: AoTrackingFacts, recent: boolean): TrackingStep {
  if (qualified > 0) {
    // Même règle que l'e-mail automatique de la publication (auto-source-candidates.ts) : candidats de la base, les
    // SOURCING_TOP_N meilleurs notés SOURCING_MIN_SCORE ou plus. La section Sourcing du panneau y ajoute le vivier, les
    // candidatures et les points de recommandation : elle peut en montrer d'autres.
    const retained = Math.min(qualified, SOURCING_TOP_N)
    const s = retained > 1 ? 's' : ''
    const more = qualified > retained ? ` (${qualified} notés ${SOURCING_MIN_SCORE} ou plus)` : ''
    return step('sourcing', 'done', `${retained} candidat${s} de la base retenu${s}${more}`, { count: retained })
  }
  if (recent) return step('sourcing', 'working', 'Recherche en cours')
  // Sans score enregistré, la recherche n'a pas abouti (IA en échec, aucun CV lisible…) : ce n'est pas « aucun candidat ».
  if (!scored) return step('sourcing', 'warning', 'Aucun résultat enregistré')
  return step('sourcing', 'warning', `Aucun candidat de la base noté ${SOURCING_MIN_SCORE} ou plus`)
}
