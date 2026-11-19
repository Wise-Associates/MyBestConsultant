import { z } from 'zod'

// État de la session des sites que le scraper d'appels d'offres (dépôt french-tender-scraper) lit avec une connexion
// ouverte à la main — Partenaire GC, dont le formulaire de connexion refuse les robots (ADR 0048). Le scraper l'envoie
// après chaque passage par POST /api/scraper/status ; un document par site dans scraper_status ; bandeau rouge sur
// /admin/candidats tant que la session est expirée. Même format que src/alerts/mbc-status.ts du scraper
// (`schemaVersion`) : toute évolution dans les deux projets. Aucune donnée personnelle : un site connu, un état, deux
// dates.

export const SCRAPER_STATUS_VERSION = 1

/** Taille maximale d'un état reçu (octets) : il en fait moins de 150. */
export const MAX_SCRAPER_STATUS_BYTES = 2_000

/**
 * Sites du scraper lus avec une session manuelle (clé du scraper → nom affiché). Liste fermée, nom fixé ici : le jeton
 * du scraper ne peut ni créer d'autres documents, ni choisir le texte d'un bandeau de l'admin. Nouveau site à session
 * manuelle dans le scraper : l'ajouter ici.
 */
export const SCRAPER_SITES = { 'partenaire-gc': 'Partenaire GC' } as const
export type ScraperSite = keyof typeof SCRAPER_SITES
const SITE_KEYS = Object.keys(SCRAPER_SITES) as [ScraperSite, ...ScraperSite[]]

export const ScraperStatusReportSchema = z.object({
  schemaVersion: z.literal(SCRAPER_STATUS_VERSION),
  /** Identifiant du document Appwrite. */
  site: z.enum(SITE_KEYS),
  state: z.enum(['ok', 'session_expired']),
  /** Moment du contrôle (fin du passage du scraper). */
  checkedAt: z.iso.datetime(),
})

export type ScraperStatusReport = z.infer<typeof ScraperStatusReportSchema>
export type ScraperSessionState = ScraperStatusReport['state']

/** État gardé pour un site. `since` : premier contrôle qui a constaté l'état actuel. */
export interface ScraperStatus {
  site: ScraperSite
  state: ScraperSessionState
  since: string
  checkedAt: string
}

/** Même bornes que les rapports de la veille (run-report.ts) : un état daté de 2099 resterait le dernier pour toujours. */
export const MAX_STATUS_AGE_MS = 2 * 86_400_000
export const MAX_CLOCK_SKEW_MS = 10 * 60_000

/** Valide un état reçu ; erreur courte (chemin et règle, jamais la valeur reçue). */
export function parseScraperStatusReport(
  input: unknown,
  now: Date,
): { success: true; report: ScraperStatusReport } | { success: false; error: string } {
  const parsed = ScraperStatusReportSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { success: false, error: `${issue?.path.join('.') || '(racine)'} : ${issue?.message ?? 'format inattendu'}` }
  }
  const checked = Date.parse(parsed.data.checkedAt)
  if (checked < now.getTime() - MAX_STATUS_AGE_MS || checked > now.getTime() + MAX_CLOCK_SKEW_MS) {
    return { success: false, error: 'checkedAt : contrôle hors des 2 derniers jours' }
  }
  return { success: true, report: parsed.data }
}

/**
 * État à garder après un rapport, ou null s'il ne change rien : un rapport pas plus récent que l'état gardé (nouvelle
 * tentative, arrivée dans le désordre) ne ramène jamais un état passé. `since` reste celui du premier contrôle tant que
 * l'état ne change pas.
 */
export function nextScraperStatus(stored: ScraperStatus | null, report: ScraperStatusReport): ScraperStatus | null {
  if (stored && Date.parse(stored.checkedAt) >= Date.parse(report.checkedAt)) return null
  return {
    site: report.site,
    state: report.state,
    since: stored && stored.state === report.state ? stored.since : report.checkedAt,
    checkedAt: report.checkedAt,
  }
}

/** JJ/MM/AAAA (jour UTC, comme la liste AO), même rendu côté serveur et client. */
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** Bandeaux de /admin/candidats : un par site dont la session est expirée, avec ce qu'il faut faire. */
export function scraperSessionAlerts(statuses: ScraperStatus[]): string[] {
  return statuses
    .filter(status => status.state === 'session_expired')
    .map(status =>
      `Session ${SCRAPER_SITES[status.site]} expirée depuis le ${day(status.since)} : les nouvelles offres de ce site ne sont plus relevées. ` +
      `Reconnectez-vous depuis votre poste (npm run login:session -- ${status.site} dans french-tender-scraper), puis envoyez ` +
      `la session au serveur (guide du scraper, docs/deployment-vps.md, partie 6). Dernier contrôle le ${day(status.checkedAt)}.`,
    )
}
