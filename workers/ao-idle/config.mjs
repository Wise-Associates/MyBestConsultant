// Variables du veilleur AO, contrôlées au démarrage : une valeur manquante ou invalide arrête le conteneur
// avec un message clair, plutôt que de laisser tourner un veilleur qui ne déclenche rien.

/** Hôtes où AO_SYNC_URL peut rester en http (serveur `next dev` sur le même poste). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const DEFAULT_FALLBACK_MINUTES = 15
/** Une journée : au-delà, setInterval déborde (24,8 jours max) et tournerait toutes les millisecondes. */
const MAX_FALLBACK_MINUTES = 1_440

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ localOnly?: boolean }} [options]  localOnly : lancement par `npm run ao:idle` sur un poste de
 *   développement, qui ne doit jamais déclencher la production (les fichiers .env* chargés peuvent la viser).
 * @returns {{ ok: true, config: {
 *   imap: { host: string, port: number, user: string, password: string, mailbox: string },
 *   syncUrl: URL, secret: string, fallbackMs: number
 * } } | { ok: false, errors: string[] }}
 */
export function readConfig(env, { localOnly = false } = {}) {
  const errors = []

  // Mêmes variables et mêmes valeurs par défaut que le site (src/lib/ao/imap.ts) : le veilleur doit
  // surveiller exactement la boîte que /api/cron/ao-inbox lit.
  const user = env.AO_IMAP_USER?.trim() ?? ''
  const password = env.AO_IMAP_PASSWORD ?? ''
  if (!user || !password) errors.push('AO_IMAP_USER et AO_IMAP_PASSWORD sont obligatoires.')
  const port = Number(env.AO_IMAP_PORT || 993)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) errors.push('AO_IMAP_PORT : un numéro de port (993 par défaut).')

  const secret = env.CRON_SECRET ?? ''
  if (secret.length < 16) errors.push('CRON_SECRET absent ou trop court (16 caractères minimum, le même que celui du site).')
  // Un retour à la ligne (guillemets mal fermés dans le .env…) rend l'en-tête invalide, et fetch recopie alors
  // la valeur entière dans son message d'erreur, donc dans le journal.
  if (/[\x00-\x1f\x7f]/.test(secret)) errors.push('CRON_SECRET contient un caractère de contrôle (retour à la ligne…).')

  let syncUrl = null
  try {
    syncUrl = new URL(env.AO_SYNC_URL ?? '')
  } catch {
    errors.push('AO_SYNC_URL absente ou invalide (exemple : https://www.mybestconsultant.fr/api/cron/ao-inbox).')
  }
  if (syncUrl) {
    const local = LOCAL_HOSTS.has(syncUrl.hostname)
    // Le secret part dans l'en-tête Authorization : jamais en clair sur le réseau.
    if (syncUrl.protocol !== 'https:' && !(syncUrl.protocol === 'http:' && local)) {
      errors.push('AO_SYNC_URL doit être en https (http accepté seulement vers localhost).')
    }
    // fetch refuse une adresse avec identifiants et recopie l'adresse entière dans son message d'erreur.
    if (syncUrl.username || syncUrl.password) errors.push('AO_SYNC_URL ne doit pas contenir d\'identifiant ni de mot de passe.')
    if (localOnly && !local) {
      errors.push('npm run ao:idle ne vise que le serveur local : AO_SYNC_URL=http://localhost:3000/api/cron/ao-inbox dans .env.development.local (le veilleur de production tourne sur le serveur Hetzner).')
    }
  }

  const fallbackMinutes = Number(env.AO_IDLE_FALLBACK_MINUTES || DEFAULT_FALLBACK_MINUTES)
  if (!Number.isFinite(fallbackMinutes) || fallbackMinutes < 1 || fallbackMinutes > MAX_FALLBACK_MINUTES) {
    errors.push(`AO_IDLE_FALLBACK_MINUTES : un nombre de minutes, de 1 à ${MAX_FALLBACK_MINUTES}.`)
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    config: {
      imap: {
        host: env.AO_IMAP_HOST?.trim() || 'imap.ionos.fr',
        port,
        user,
        password,
        mailbox: env.AO_IMAP_MAILBOX?.trim() || 'INBOX',
      },
      syncUrl,
      secret,
      fallbackMs: fallbackMinutes * 60_000,
    },
  }
}
