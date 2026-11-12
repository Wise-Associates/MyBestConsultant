// Lecture de l'annonce d'origine d'une offre AO (ADR 0031) : quand l'offre lue dans un e-mail est incomplète, le
// serveur ouvre le lien de l'annonce cité par l'e-mail (`sourceUrl`) et complète les champs vides. Règles pures,
// testées dans rules.test.ts ; lecture de la page : fetch-page.ts ; orchestration : complete.ts.

import { HOSTNAME } from '../imap-host'
import { words } from '../name-match'
import { keepCitedAliases } from '../parse'
import type { ExtractedOffer } from '../types'
import type { PageField } from './page-fill'

/** Annonces lues au plus par e-mail : un e-mail qui liste vingt offres ne fait pas vingt lectures et vingt appels d'IA. */
export const PAGE_READS_PER_EMAIL = 3
/** Lectures par jour (UTC) : chacune coûte un appel d'IA à nos frais, et tout expéditeur peut écrire à une boîte. */
export const PAGE_READ_DAILY_LIMITS = { org: 30, all: 300 } as const
/** En dessous, la description est celle d'une alerte (« voir l'offre ») plutôt que celle du poste. */
export const SHORT_DESCRIPTION_CHARS = 500
/** Nom du lecteur dans les en-têtes et dans robots.txt (aucune donnée de l'organisation). */
export const ROBOTS_AGENT = 'MBCAnnonceBot'

/**
 * Offre à compléter : description courte, ou lieu, compétences ou expérience absents (décision du 2026-11-12). Le
 * montant et la date limite manquent souvent aussi dans l'annonce : ils sont complétés s'ils y sont, sans déclencher
 * la lecture.
 */
export function isIncomplete(offer: Pick<ExtractedOffer, 'description' | 'location' | 'skills' | 'experience'>): boolean {
  return offer.description.trim().length < SHORT_DESCRIPTION_CHARS || !offer.location.trim() || offer.skills.length === 0 || !offer.experience.trim()
}

/**
 * Sites jamais lus : conditions d'utilisation qui interdisent la reprise ou la lecture automatique, ou contenu réservé
 * aux comptes connectés (ADR 0031). Un sous-domaine est exclu avec son domaine (fr.indeed.com).
 */
export const BLOCKED_SITES: readonly { domain: string; reason: string }[] = [
  { domain: 'marches-publics.gouv.fr', reason: 'PLACE interdit toute reprise sans autorisation écrite' },
  { domain: 'maximilien.fr', reason: 'Maximilien interdit toute reprise sans autorisation écrite' },
  { domain: 'marches-publics.info', reason: 'marches-publics.info interdit toute reprise sans autorisation écrite' },
  { domain: 'achatpublic.com', reason: 'achatpublic réserve les consultations aux comptes connectés' },
  { domain: 'partenaire-gc.com', reason: 'Partenaire GC réserve les consultations à ses abonnés' },
  { domain: 'linkedin.com', reason: 'LinkedIn interdit la lecture automatique de ses pages' },
  { domain: 'lnkd.in', reason: 'LinkedIn interdit la lecture automatique de ses pages' },
  { domain: 'indeed.com', reason: 'Indeed interdit la lecture automatique de ses pages' },
  { domain: 'indeed.fr', reason: 'Indeed interdit la lecture automatique de ses pages' },
  { domain: 'malt.fr', reason: 'Malt réserve les missions aux comptes connectés' },
  { domain: 'malt.com', reason: 'Malt réserve les missions aux comptes connectés' },
  ...['malt.de', 'malt.es', 'malt.be', 'malt.nl', 'malt.ch', 'malt.uk', 'malt.co.uk'].map(domain => ({ domain, reason: 'Malt réserve les missions aux comptes connectés' })),
  // Copies servies sous un autre nom (traduction, archives) : elles contourneraient les exclusions ci-dessus.
  { domain: 'translate.goog', reason: 'copie d’une page par un traducteur en ligne' },
  ...['archive.org', 'archive.ph', 'archive.is', 'archive.today'].map(domain => ({ domain, reason: 'copie d’une page par un service d’archives' })),
]

/** Raison de l'exclusion du site `host`, ou null s'il peut être lu. */
export function blockedSiteReason(host: string): string | null {
  const name = host.toLowerCase().replace(/\.$/, '')
  return BLOCKED_SITES.find(s => name === s.domain || name.endsWith(`.${s.domain}`))?.reason ?? null
}

// Un GET sur un lien de désinscription « en un clic » désinscrirait la boîte : jamais suivi, même si l'IA l'a retenu.
// Cherché dans le nom du site aussi (« unsubscribe.envoi.exemple »).
const UNSUBSCRIBE = /unsubscri|d[eé]sinscri|d[eé]sabonn|opt-?out|r[eé]silier|ne-?plus-?recevoir|abmelden|preferences|\/stop(\/|$|\?)/i

/** Chemin lisible (« d%C3%A9sabonner » → « désabonner ») ; tel quel si l'encodage est invalide. */
function decoded(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export type PageUrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Adresse que le serveur peut ouvrir (lien cité par l'e-mail, ou chaque redirection) : https seulement — un lien http
 * est lu en https, jamais en clair —, port standard, sans identifiants, nom de domaine (pas d'adresse IP), site non
 * exclu, pas un lien de désinscription. Les adresses du nom sont vérifiées à la connexion (fetch-page.ts).
 */
export function checkPageUrl(raw: string): PageUrlCheck {
  if (!URL.canParse(raw)) return { ok: false, reason: 'adresse illisible' }
  const url = new URL(raw)
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return { ok: false, reason: 'pas une adresse web' }
  if (url.username || url.password) return { ok: false, reason: 'adresse avec identifiants' }
  if (url.port && url.port !== '443') return { ok: false, reason: 'port inhabituel' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!HOSTNAME.test(host)) return { ok: false, reason: 'adresse IP ou nom de site invalide' }
  const blocked = blockedSiteReason(host)
  if (blocked) return { ok: false, reason: `site exclu : ${blocked}` }
  if (UNSUBSCRIBE.test(decoded(`${host}${url.pathname}${url.search}`))) return { ok: false, reason: 'lien de désinscription' }
  url.hash = ''
  return { ok: true, url }
}

// ── robots.txt (RFC 9309) ─────

export interface RobotsGroup {
  agents: string[]
  rules: { allow: boolean; pattern: string }[]
}

/** Groupes d'un fichier robots.txt ; les lignes inconnues ou mal formées sont ignorées (RFC 9309). */
export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let inRules = false
  for (const raw of text.split(/\r\n|\r|\n/).slice(0, 5000)) {
    const line = raw.replace(/#.*$/, '').trim()
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      // Plusieurs User-agent qui se suivent partagent le même groupe ; après une règle, un nouveau groupe commence.
      if (!current || inRules) {
        current = { agents: [], rules: [] }
        groups.push(current)
        inRules = false
      }
      current.agents.push(value.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && current) {
      inRules = true
      // « Disallow: » vide n'interdit rien.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value })
    }
  }
  return groups
}

/** `path` (chemin et paramètres) correspond au motif : préfixe, `*` pour toute suite de caractères, `$` en fin de motif. */
function matchesPattern(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*')
  // Parcours linéaire (pas d'expression régulière construite depuis le fichier : un motif à étoiles répétées ne doit pas
  // faire exploser le temps de calcul).
  if (!path.startsWith(parts[0])) return false
  let at = parts[0].length
  for (let i = 1; i < parts.length; i++) {
    const last = i === parts.length - 1
    if (last && anchored) return parts[i] === '' || (path.endsWith(parts[i]) && path.length - parts[i].length >= at)
    const found = path.indexOf(parts[i], at)
    if (found < 0) return false
    at = found + parts[i].length
  }
  return !anchored || at === path.length
}

/**
 * true si robots.txt permet à `agent` de lire `path` : groupes de notre nom, sinon ceux de « * » ; la règle au motif le
 * plus long l'emporte, Allow à égalité ; sans règle qui corresponde, la lecture est permise.
 */
export function robotsAllows(groups: RobotsGroup[], agent: string, path: string): boolean {
  const name = agent.toLowerCase()
  const own = groups.filter(g => g.agents.includes(name))
  const rules = (own.length ? own : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules)
  let best: { allow: boolean; length: number } | null = null
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, path)) continue
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow)) best = { allow: rule.allow, length: rule.pattern.length }
  }
  return best?.allow ?? true
}

// ── Rapprochement et complément ─────

// Mots qui ne disent rien du poste (« Développeur Java H/F » et « Développeur Java (F/H) » sont la même offre).
const TITLE_NOISE = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'pour', 'un', 'une', 'au', 'aux', 'h', 'f', 'hf', 'fh', 'x', 'the', 'and', 'of'])
// Métiers, niveaux et mots d'alerte communs à des postes différents : « Chef de projet SAP » et « Chef de projet
// Salesforce » ne sont pas la même offre. Seuls les autres mots (technologie, domaine, lieu…) disent de quel poste il s'agit.
const ROLE_WORDS = new Set([
  'chef', 'projet', 'consultant', 'consultante', 'developpeur', 'developpeuse', 'developer', 'ingenieur', 'ingenieure', 'engineer',
  'analyste', 'analyst', 'architecte', 'architect', 'administrateur', 'administratrice', 'technicien', 'technicienne', 'gestionnaire',
  'responsable', 'manager', 'directeur', 'directrice', 'assistant', 'assistante', 'charge', 'chargee', 'expert', 'experte', 'specialiste',
  'specialist', 'lead', 'head', 'officer', 'senior', 'junior', 'confirme', 'confirmee', 'mission', 'poste', 'offre', 'emploi', 'cdi',
  'cdd', 'freelance', 'stage', 'stagiaire', 'alternance', 'alternant', 'interim', 'equipe', 'team',
  'nouvelle', 'nouvelles', 'nouveau', 'opportunite', 'opportunites', 'besoin', 'recherche', 'recrutement', 'urgent', 'alerte',
  'annonce', 'profil', 'job', 'jobs', 'offres',
])
const titleWords = (title: string) => new Set(words(title).filter(w => w.length >= 2 && !TITLE_NOISE.has(w)))
const distinctive = (set: Set<string>) => new Set([...set].filter(w => !ROLE_WORDS.has(w)))

/** Part des mots de l'intitulé le plus court présents dans l'autre (0 à 1). */
function titleOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let common = 0
  for (const w of a) if (b.has(w)) common++
  return common / Math.min(a.size, b.size)
}

/**
 * true si les deux intitulés désignent le même poste : tous les mots distinctifs (hors métier et niveau) de l'intitulé
 * qui en a le moins se retrouvent dans l'autre. Un intitulé sans mot distinctif (« Consultant senior ») ne confirme rien.
 */
function sameJob(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = [distinctive(a), distinctive(b)].sort((x, y) => x.size - y.size)
  return small.size > 0 && [...small].every(w => large.has(w))
}

/**
 * Offre de la page qui est celle de l'e-mail, ou null : rien n'est complété (une page de liste, d'accueil ou d'un autre
 * poste ne remplit pas l'offre). Le même poste se reconnaît à ses mots distinctifs (sameJob) ; entre plusieurs, celle
 * dont l'intitulé ressemble le plus. Seule exception : un intitulé d'e-mail sans mot distinctif (« Nouvelle
 * opportunité ») accepte une page à une seule offre, puisque le lien est celui de l'e-mail.
 */
export function pickPageOffer<T extends Pick<ExtractedOffer, 'title'>>(emailOffer: Pick<ExtractedOffer, 'title'>, pageOffers: T[]): T | null {
  const wanted = titleWords(emailOffer.title)
  if (pageOffers.length === 1 && distinctive(wanted).size === 0) return pageOffers[0]
  let best: { offer: T; overlap: number } | null = null
  for (const offer of pageOffers) {
    const theirs = titleWords(offer.title)
    if (!sameJob(wanted, theirs)) continue
    const overlap = titleOverlap(wanted, theirs)
    if (!best || overlap > best.overlap) best = { offer, overlap }
  }
  return best?.offer ?? null
}

/**
 * Noms du client lus sur la page, à masquer à la publication : ses autres noms, mais aussi le client et le client final
 * de la page, que fillFromPage ne reprend pas comme tels (la description de la page, elle, peut les citer). Seulement
 * ceux que la page cite (keepCitedAliases), jamais l'organisation qui lit la boîte.
 */
export function withPageClientNames(pageOffer: ExtractedOffer, pageText: string, orgName: string): ExtractedOffer {
  const own = ` ${words(orgName).join(' ')} `
  // Client et client final d'abord : les listes de noms masqués sont bornées, ce sont eux que la description citera.
  const names = [pageOffer.companyName, pageOffer.endClient, ...(pageOffer.clientAliases ?? [])]
    .map(n => n.trim())
    .filter(n => n && (own.trim() === '' || !` ${words(n).join(' ')} `.includes(own)))
  return keepCitedAliases({ ...pageOffer, clientAliases: [...new Set(names)] }, pageText)
}

const TEXT_FIELDS = ['location', 'experience', 'duration', 'startDate', 'endClient'] as const

/**
 * Offre de l'e-mail complétée par celle de la page : **seuls les champs vides** sont remplis, rien de ce que dit
 * l'e-mail n'est remplacé (décision du 2026-11-12). Exceptions et limites :
 * - description courte : celle de la page est ajoutée après celle de l'e-mail (gardée en tête) ;
 * - montant : seulement si les deux disent le même contrat (son unité en dépend) ;
 * - contrat, télétravail, client et intitulé ne sont jamais repris : leur valeur par défaut (« mission », « sur site »)
 *   ne se distingue pas d'une valeur dite par l'e-mail, et le client suit la règle de l'expéditeur (origin.ts) ;
 * - autres noms du client : ceux de la page s'ajoutent (ils seront masqués à la publication, comme ceux de l'e-mail) ;
 *   le client et le client final de la page y sont déjà (withPageClientNames).
 */
export function fillFromPage(emailOffer: ExtractedOffer, pageOffer: ExtractedOffer): { offer: ExtractedOffer; fields: PageField[] } {
  const offer: ExtractedOffer = { ...emailOffer }
  const fields: PageField[] = []
  for (const key of TEXT_FIELDS) {
    if (!offer[key].trim() && pageOffer[key].trim()) {
      offer[key] = pageOffer[key]
      fields.push(key)
    }
  }
  if (!offer.deadline.trim() && pageOffer.deadline.trim()) {
    offer.deadline = pageOffer.deadline
    offer.deadlineFromText = pageOffer.deadlineFromText
    fields.push('deadline')
  }
  if (!offer.skills.length && pageOffer.skills.length) {
    offer.skills = pageOffer.skills
    fields.push('skills')
  }
  if (!offer.technologies.length && pageOffer.technologies.length) {
    offer.technologies = pageOffer.technologies
    fields.push('technologies')
  }
  if (!offer.engagement && pageOffer.engagement) {
    offer.engagement = pageOffer.engagement
    fields.push('engagement')
  }
  if (offer.salary === null && pageOffer.salary !== null && offer.contractType === pageOffer.contractType) {
    offer.salary = pageOffer.salary
    fields.push('salary')
  }
  const own = offer.description.trim()
  const theirs = pageOffer.description.trim()
  if (own.length < SHORT_DESCRIPTION_CHARS && theirs.length > own.length) {
    // Bornée à la taille de l'attribut (ao_offers.description) : un complément ne doit jamais faire échouer l'e-mail.
    offer.description = (own ? `${own}\n\n${theirs}` : theirs).slice(0, 20_000)
    fields.push('description')
  }
  const aliases = [...new Set([...(emailOffer.clientAliases ?? []), ...(pageOffer.clientAliases ?? [])])].slice(0, 16)
  if (aliases.length) offer.clientAliases = aliases
  return { offer, fields }
}
