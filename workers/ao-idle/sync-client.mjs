// Appel de /api/cron/ao-inbox (le même que Vercel Cron et `npm run ao:poll`) et lecture de son compte rendu.
// Toute la logique AO reste sur le site ; le veilleur ne fait que sonner.

/** Un peu plus que la durée maximale d'un passage côté site (maxDuration = 300 s). */
export const SYNC_TIMEOUT_MS = 310_000

/**
 * Lance un passage de synchronisation. Lève une erreur au message exploitable (sans secret) si le site
 * ne répond pas, refuse l'appel ou renvoie autre chose qu'un compte rendu.
 * @param {{ url: URL, secret: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function callSync({ url, secret, fetchImpl = fetch, timeoutMs = SYNC_TIMEOUT_MS }) {
  let res
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${secret}` },
      // Une redirection (domaine sans www → www…) perdrait l'en-tête Authorization : erreur claire à la place.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const code = err?.cause?.code
    // Certains messages de fetch recopient la valeur d'en-tête refusée : le secret ne doit pas finir au journal.
    const reason = String(err?.message ?? err).replaceAll(secret, '[CRON_SECRET]')
    throw new Error(`site injoignable (${url.host}) : ${reason}${code ? ` (${code})` : ''}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw new Error(`redirection ${res.status} vers ${res.headers.get('location') ?? '?'} : mettez l'adresse finale dans AO_SYNC_URL`)
  }
  if (res.status === 401) throw new Error('401 : accès refusé (CRON_SECRET différent de celui du site, ou preview Vercel protégée)')
  // Le corps d'une erreur peut être une page HTML (proxy, panne) : seul le JSON du site est détaillé.
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? ` : ${body.detail.slice(0, 300)}` : ''
    throw new Error(`HTTP ${res.status}${detail}`)
  }
  return readReport(body)
}

const count = value => (Number.isInteger(value) && value >= 0 ? value : 0)

/** Compte rendu de synchronisation (`AoSyncReport` de src/lib/ao/sync.ts), réduit à ce dont le veilleur a besoin. */
export function readReport(body) {
  if (!body || typeof body !== 'object' || typeof body.configured !== 'boolean' || typeof body.skipped !== 'boolean') {
    throw new Error('réponse inattendue du site (pas un compte rendu de synchronisation)')
  }
  if (!body.configured) throw new Error('boîte AO non configurée sur le site (AO_IMAP_USER / AO_IMAP_PASSWORD de Vercel)')
  return {
    skipped: body.skipped,
    mode: body.mode === 'reconcile' ? 'reconcile' : 'incremental',
    pending: count(body.pending),
    processed: count(body.processed),
    offersCreated: count(body.offersCreated),
    duplicates: count(body.duplicates),
    noOffer: count(body.noOffer),
    failed: count(body.failed),
    remaining: count(body.remaining),
  }
}

/**
 * Une ligne de journal, faite de nombres uniquement : le texte des erreurs du compte rendu peut citer un
 * e-mail (données personnelles) ; les e-mails en erreur sont listés sur /admin/ao-offers.
 */
export function describeReport(report) {
  if (report.skipped) return 'synchronisation déjà en cours ailleurs (bouton admin, cron) : nouvel essai prévu'
  if (!report.pending) return `aucun nouvel e-mail${report.mode === 'reconcile' ? ' (rattrapage des 7 derniers jours)' : ''}`
  const parts = [
    `${report.processed} traité(s)`,
    `${report.offersCreated} offre(s) créée(s)`,
    report.duplicates ? `${report.duplicates} doublon(s)` : '',
    report.noOffer ? `${report.noOffer} sans offre` : '',
    report.failed ? `${report.failed} en erreur (voir /admin/ao-offers)` : '',
    report.remaining ? `${report.remaining} en attente` : '',
  ].filter(Boolean)
  return `${report.pending} e-mail(s) : ${parts.join(' · ')}`
}
