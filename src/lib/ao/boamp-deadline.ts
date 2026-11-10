// Date limite d'un avis du BOAMP, pour compléter les e-mails de la veille arrivés sans (script `npm run ao:deadlines`).
// Audit du 10/11/2026 : les avis européens en procédure restreinte ou négociée ont un champ `datelimitereponse` vide au
// BOAMP ; la veille envoyait alors l'e-mail sans « Date limite de réponse », et le tableau des offres sans date. La date
// est dans le contenu de l'avis (eForms). Même règle que la veille (`boampEformsDeadline`, veille-marches-emplois,
// ADR 0011), qui l'applique désormais à l'envoi.

type Json = unknown

/** Périodes eForms qui portent une date limite : demandes de participation (procédure restreinte, négociée) et offres. */
const DEADLINE_PERIODS = new Set(['cac:ParticipationRequestReceptionPeriod', 'cac:TenderSubmissionDeadlinePeriod'])

const child = (value: Json, key: string): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, Json>)[key] : undefined
const list = (value: Json): Json[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value])
/** Valeur texte d'un champ eForms, écrit soit "valeur", soit { "#text": "valeur", ... }. */
const text = (value: Json): string | undefined => {
  if (typeof value === 'string') return value
  const nested = child(value, '#text')
  return typeof nested === 'string' ? nested : undefined
}

/**
 * Identifiant d'un avis (« 26-92618 ») dans le lien d'une offre de la veille
 * (`https://www.boamp.fr/pages/avis/?q=idweb:26-92618`) ; null pour un autre site ou un autre lien.
 */
export function boampIdOf(url: string): string | null {
  if (!URL.canParse(url)) return null
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.boamp.fr') return null
  return /^idweb:(\d{2}-\d{1,7})$/.exec(parsed.searchParams.get('q') ?? '')?.[1] ?? null
}

const instantOf = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00Z` : value).getTime()

/**
 * Date limite à retenir parmi celles d'un avis (lots, demandes de participation et offres), au jour `today` (AAAA-MM-JJ,
 * Paris) : la plus proche encore à venir ; toutes passées, la plus tardive (l'avis est clos). Un avis dont un lot reste
 * ouvert n'est jamais montré comme échu. Même règle que la veille (`pickDeadline`).
 */
export function pickDeadline(values: readonly string[], today: string): string | undefined {
  const dated = values.map(value => ({ value, at: instantOf(value) })).filter(({ at }) => !Number.isNaN(at)).sort((a, b) => a.at - b.at)
  return (dated.find(({ value }) => value.slice(0, 10) >= today) ?? dated.at(-1))?.value
}

/** Date limite des périodes eForms de l'avis (procédure et lots), au format ISO, selon `pickDeadline` ; undefined sans période. */
function eformsDeadline(donnees: Json, today: string): string | undefined {
  const eforms = child(donnees, 'EFORMS')
  if (!eforms || typeof eforms !== 'object') return undefined
  const found: string[] = []
  const collect = (period: Json) => {
    // « 2026-10-27+01:00 » et « 12:00:00+01:00 » (parfois « 12:00:00.000+02:00 ») : jour, heure et fuseau séparés.
    const date = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(text(child(period, 'cbc:EndDate'))?.trim() ?? '')
    if (!date?.[1]) return
    const time = /^(\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(text(child(period, 'cbc:EndTime'))?.trim() ?? '')
    const value = time?.[1] ? `${date[1]}T${time[1].length === 5 ? `${time[1]}:00` : time[1]}${time[2] ?? date[2] ?? ''}` : date[1]
    found.push(value)
  }
  const walk = (value: Json, depth: number) => {
    if (depth > 12 || !value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, Json>)) {
      if (DEADLINE_PERIODS.has(key)) for (const period of list(nested)) collect(period)
      else for (const item of list(nested)) walk(item, depth + 1)
    }
  }
  walk(eforms, 0)
  return pickDeadline(found, today)
}

/**
 * Date limite d'un avis au jour `today` : le champ du BOAMP, sinon ses données eForms ; undefined s'il n'en donne pas (ou
 * illisible).
 */
export function boampNoticeDeadline(record: { datelimitereponse?: string | null; donnees?: string | null }, today: string): string | undefined {
  if (record.datelimitereponse) return record.datelimitereponse
  if (!record.donnees) return undefined
  try {
    return eformsDeadline(JSON.parse(record.donnees), today)
  } catch {
    // Contenu d'avis tronqué ou non JSON : pas de date à proposer, l'e-mail reste tel quel (le script le compte).
    return undefined
  }
}

type BoampDeadlineRecord = { datelimitereponse?: string | null; donnees?: string | null }

/**
 * Date limite d'un avis en tenant compte de son dernier avis rectificatif, qui peut la repousser (avis réel de juillet
 * 2026 : 31/07 → 31/08 → 07/09) : celle du rectificatif s'il en donne une, sinon celle de l'avis.
 */
export function correctedDeadline(record: BoampDeadlineRecord, correction: BoampDeadlineRecord | undefined, today: string): string | undefined {
  return (correction && boampNoticeDeadline(correction, today)) || boampNoticeDeadline(record, today)
}

const PARIS = 'Europe/Paris'

/**
 * Date limite telle que la veille l'écrit dans ses e-mails (« 27/10/2026 à 12:00 », heure de Paris ; « 10/12/2026 » pour
 * une date seule), lue ensuite par le tableau des offres (`parseOfferDate`).
 */
export function frenchDeadline(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/')
  // Heure écrite sans fuseau : celle de l'avis, déjà l'heure de Paris (jamais celle du poste qui lance le script).
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value)
  if (local?.[1] && local[2]) return `${local[1].split('-').reverse().join('/')} à ${local[2]}`
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return value
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit', year: 'numeric' }).format(instant)
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(instant)
  return `${day} à ${time}`
}
