// Dates de publication écrites en clair (« Publiée le 3 nov. 2026 ») et non en durée (« il y a 3 j »), qui prêtait à
// confusion (demande du 2026-11-03). Fuseau de Paris imposé : le serveur (Vercel, en UTC) et le navigateur écrivent la
// même date, et une offre publiée à 0 h 30 à Paris n'apparaît pas à la date de la veille.

/** « 3 nov. 2026 », jour de Paris. */
export function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' })
}

/**
 * Durée écoulée pour une activité récente (« il y a 3 h », dernière connexion, historique de l'équipe) — pas pour une
 * date de publication (voir plus haut). Au-delà d'une semaine : la date, jour de Paris.
 */
export function timeAgoFr(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
}
