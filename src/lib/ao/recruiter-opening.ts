// Ouverture du contexte d'une offre publiée au nom de l'organisation qui la publie (demande de David du 2026-11-25) :
// « Altrion recrute pour un grand groupe bancaire… », « Wise Associates recrute pour un grand groupe… ». Seule
// l'organisation qui publie est nommée, jamais Wise Associates ni MyBestConsultant pour une autre (2026-11-26). Pur,
// utilisable dans le navigateur ; testé dans recruiter-opening.test.ts.

/** Nom sous lequel la plateforme (boîtes « admin ») publie ses offres ; même nom que PLATFORM_NAME (tenancy.ts). */
export const PLATFORM_RECRUITER = 'Wise Associates'

/** Titre de la section de contexte écrite par « Préparer la publication » (descriptionFromCopy). */
const CONTEXT_HEADING = '### Le contexte\n'

const one = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Première lettre en minuscule, sauf pour un sigle (« SNCF ») : « Un organisme » → « un organisme ». */
const lowerFirst = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) || /^\p{Lu}['’]/u.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text)

/** Début du paragraphe de la section « Le contexte » (juste après son titre), -1 sans cette section. */
const contextStart = (description: string) => {
  const at = description.startsWith(CONTEXT_HEADING) ? 0 : description.indexOf(`\n${CONTEXT_HEADING}`)
  return at < 0 ? -1 : at + (at === 0 ? 0 : 1) + CONTEXT_HEADING.length
}

/**
 * Description dont le contexte commence par « <organisation> recrute pour <client décrit> … ». L'IA écrit la première
 * phrase sous la forme « <client décrit> recrute un profil pour <mission> » (ADR 0060) ; elle est réécrite ici, sans
 * appel d'IA. Contexte déjà ouvert par l'organisation, d'une autre forme, absent, ou organisation inconnue : inchangée.
 */
export function withRecruiterOpening(description: string, recruiter: string): string {
  const org = one(recruiter)
  const start = contextStart(description)
  if (!org || start < 0) return description
  const text = description.slice(start)
  if (text.startsWith(`${org} recrute`)) return description
  const end = text.search(/(?<=[.!?…])\s/)
  const first = end < 0 ? text : text.slice(0, end)
  const m = /^([^\n]+?)(,?)\s+recrute\s+(\S[^\n]*)$/u.exec(first)
  if (!m) return description
  const client = lowerFirst(m[1].trim())
  // Client décrit avec une apposition (« Un ministère, soutenu par …, recrute ») : la virgule sépare encore la suite.
  const join = m[2] || client.includes(',') ? ', ' : ' '
  return `${description.slice(0, start)}${org} recrute pour ${client}${join}${m[3]}${end < 0 ? '' : text.slice(end)}`
}

/**
 * Description sans l'ouverture « <organisation> recrute pour » de son contexte, et l'ouverture retirée (null s'il n'y en
 * a pas) : le nom de l'organisation qui publie ne doit être ni masqué par l'anonymisation (le domaine de l'expéditeur
 * est parmi les noms à masquer) ni signalé en rouge à la relecture comme mention de la plateforme.
 */
export function takeOpening(description: string, recruiter: string | undefined): { description: string; opening: string | null } {
  const org = one(recruiter ?? '')
  const start = contextStart(description)
  const opening = `${org} recrute pour `
  if (!org || start < 0 || !description.startsWith(opening, start)) return { description, opening: null }
  return { description: description.slice(0, start) + description.slice(start + opening.length), opening }
}

/** Remet l'ouverture retirée par takeOpening en tête du contexte. */
export function putOpening(description: string, opening: string | null): string {
  const start = contextStart(description)
  return opening && start >= 0 ? description.slice(0, start) + opening + description.slice(start) : description
}
