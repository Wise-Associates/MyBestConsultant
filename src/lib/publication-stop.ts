// Arrêt des tâches automatiques d'une publication — diffusion LinkedIn pas encore remise à Make, e-mails automatiques aux
// candidats pas encore envoyés —, demandé depuis le panneau d'une offre AO (décision du 2026-10-29). Règles pures,
// testées ; le marqueur est un document de AO_STATE (requestPublicationStop, src/lib/ao/state.ts).

/** Diffusion et sourcing finissent en quelques minutes après la publication : au-delà, un arrêt ne vise plus rien. */
export const PUBLICATION_STOP_TTL_MS = 20 * 60_000

/** Erreur enregistrée sur une diffusion arrêtée : le suivi l'affiche « Arrêtée », pas « Échec ». */
export const STOPPED_DIFFUSION_ERROR = 'Diffusion arrêtée avant l’envoi.'

/** Arrêt encore en vigueur à `now` (date d'expiration du marqueur, absente ou illisible : aucun arrêt). */
export function stopIsActive(expiresAt: unknown, now: number): boolean {
  return typeof expiresAt === 'string' && Date.parse(expiresAt) > now
}

/**
 * Seul le premier envoi d'une diffusion automatique est arrêté : « Relancer » (essais déjà comptés) et « Republier »
 * (diffusion manuelle) sont des demandes explicites, faites après l'arrêt.
 */
export function stopsDelivery(post: { trigger: 'auto' | 'manual'; attempts: number }, stopActive: boolean): boolean {
  return stopActive && post.trigger === 'auto' && post.attempts === 0
}

/** Diffusion arrêtée depuis le panneau (et non en échec). */
export const isStoppedDiffusion = (status: string, error: string) => status === 'failed' && error === STOPPED_DIFFUSION_ERROR

/**
 * Ce que « Tout arrêter » fait de la dernière diffusion d'une offre : `stopped` à marquer arrêtée (automatique, pas
 * encore remise à Make) ; `running` en cours mais lancée ou relancée à la main, donc pas arrêtée ; `sent` déjà remise à
 * Make ; `none` aucune en cours (une diffusion qui démarre est arrêtée par le marqueur).
 */
export function diffusionStopOutcome(post: { status: string; trigger: 'auto' | 'manual'; attempts: number } | null): 'stopped' | 'running' | 'sent' | 'none' {
  if (!post) return 'none'
  if (post.status === 'queued') return stopsDelivery(post, true) ? 'stopped' : 'running'
  return ['sent', 'images_ready', 'published', 'partial'].includes(post.status) ? 'sent' : 'none'
}
