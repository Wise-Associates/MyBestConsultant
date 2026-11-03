// Dates de publication écrites en clair (« Publiée le 3 nov. 2026 ») et non en durée (« il y a 3 j »), qui prêtait à
// confusion (demande du 2026-11-03). Fuseau de Paris imposé : le serveur (Vercel, en UTC) et le navigateur écrivent la
// même date, et une offre publiée à 0 h 30 à Paris n'apparaît pas à la date de la veille.

/** « 3 nov. 2026 », jour de Paris. */
export function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' })
}
