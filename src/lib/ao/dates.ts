// Dates des appels d'offres. Règle métier (2026-10-21) : une date citée sans libellé qui dise ce qu'elle est (« 30/10/2026 »
// en tête d'un récapitulatif…) est une date limite de réponse si elle tombe un vendredi, une date de démarrage si elle
// tombe un lundi, une date limite les autres jours (ADR 0004). Le jour de la semaine est calculé ici, pas par l'IA,
// qui se trompe souvent sur le jour d'une date. Une date que le texte désigne lui-même n'est jamais déplacée.

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, mar: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11,
  decembre: 12, dec: 12,
}
const MONDAY = 1
/** Une date sans année déjà passée de plus de 60 jours désigne l'année suivante (« 15/01 » reçu en octobre). */
const PAST_TOLERANCE_DAYS = 60

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function utcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null
}

/** Année d'une date écrite sans : celle de la référence, ou la suivante si la date serait déjà largement passée. */
function withYear(month: number, day: number, reference: Date): Date | null {
  const year = reference.getUTCFullYear()
  const date = utcDate(year, month, day)
  if (date && reference.getTime() - date.getTime() > PAST_TOLERANCE_DAYS * 86_400_000) return utcDate(year + 1, month, day)
  return date
}

/**
 * Date lue dans un texte d'appel d'offres (« 30/10/2026 », « 30.10.26 », « 2026-10-30 », « 02/11 », « lundi 2 novembre »,
 * « 1er déc. 2026 ») ; `reference` (date de réception) donne l'année manquante. null si illisible ou inexistante.
 */
export function parseOfferDate(value: string, reference: Date): Date | null {
  const text = fold(value)
  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (m) return utcDate(+m[1], +m[2], +m[3])
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?\b/)
  if (m) return m[3] ? utcDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) : withYear(+m[2], +m[1], reference)
  m = text.match(/\b(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+(\d{4}))?\b/)
  const month = m ? MONTHS[m[2]] : undefined
  if (m && month) return m[3] ? utcDate(+m[3], month, +m[1]) : withYear(month, +m[1], reference)
  return null
}

/**
 * Place les dates citées sans libellé (`unlabeled`) selon leur jour : lundi → démarrage, sinon (vendredi, autre jour,
 * date illisible) → date limite. Seules les places encore vides sont remplies : une date désignée par le texte reste.
 */
export function placeUnlabeledDates(
  labeled: { startDate: string; deadline: string },
  unlabeled: string[],
  reference: Date,
): { startDate: string; deadline: string } {
  let { startDate, deadline } = labeled
  for (const value of unlabeled.map(v => v.trim()).filter(Boolean)) {
    const day = parseOfferDate(value, reference)?.getUTCDay()
    if (day === MONDAY) {
      if (!startDate) startDate = value
    } else if (!deadline) {
      // Vendredi (la règle), autre jour ou date illisible : date limite, comme la date en tête d'un récapitulatif.
      deadline = value
    }
  }
  return { startDate, deadline }
}

/**
 * Date limite lisible et antérieure au jour de `now` : l'offre ne peut plus recevoir de réponse. Une date illisible
 * ou absente n'est jamais « passée ». Appliqué aux offres de la veille (scraping), dont la date limite vient de la
 * source elle-même (décision du 2026-10-23).
 */
export function isPastDeadline(deadline: string, now: Date): boolean {
  if (!deadline.trim()) return false
  const date = parseOfferDate(deadline, now)
  return date !== null && date.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/**
 * Date limite d'un e-mail, tirée de celles de ses offres (une seule est enregistrée, sur l'e-mail) : la plus proche
 * des dates lisibles — répondre trop tôt ne fait rien perdre —, sinon la première indiquée ; '' si aucune.
 */
export function emailDeadline(deadlines: string[], reference: Date): string {
  const given = deadlines.map(d => d.trim()).filter(Boolean)
  const dated = given.flatMap(value => {
    const date = parseOfferDate(value, reference)
    return date ? [{ value, time: date.getTime() }] : []
  })
  return dated.sort((a, b) => a.time - b.time)[0]?.value ?? given[0] ?? ''
}
