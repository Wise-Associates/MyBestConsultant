import { z } from 'zod'
import { words } from './name-match'
import type { AoOfferFields } from './types'

// Version publiée d'une offre AO rédigée par l'IA (« Préparer la publication », ADR 0013) : anonyme (ni client, ni
// entité, ni projet, ni référence), courte et structurée comme les publications sur les réseaux (accroche, missions,
// profil, modalités). L'IA ne fait que proposer : la réponse est validée ici, repasse par l'anonymisation
// (anonymize.ts) et un humain la relit et la valide avant toute publication. Règles pures, testées dans
// publication-copy.test.ts.

/**
 * Rédactions par l'IA demandées par les recruteurs, par jour (UTC) : par organisation, et pour toutes ensemble (l'admin
 * n'est pas compté). L'IA est aux frais de la plateforme et l'inscription est libre.
 */
export const AO_PUBLICATION_AI_DAILY_LIMITS = { perOrganisation: 30, allOrganisations: 300 } as const

/** Raisons affichées dans la phrase « L'IA n'a pas rédigé cette version (…) » du panneau. */
export const PUBLICATION_AI_QUOTA_MESSAGE = {
  organisation: `limite de ${AO_PUBLICATION_AI_DAILY_LIMITS.perOrganisation} rédactions par l'IA par jour atteinte pour votre organisation`,
  platform: 'trop de rédactions par l\'IA aujourd\'hui sur la plateforme',
} as const

export const PUBLICATION_PROMPT = `Tu rédiges la version publique d'une offre de mission IT reçue d'un client (appel d'offres), pour le site de recrutement My Best Consultant et ses réseaux sociaux.

Anonymat, règle absolue :
- Aucun nom d'entreprise, de groupe, de filiale, de marque, de direction, de département, d'équipe ou d'entité interne, ni aucun nom de projet ou d'application interne (ex. « BNPP », « CIB », « BP2S », « projet B-STEADY ») : décris-les de façon générique (« une grande banque d'investissement », « un programme de transformation »).
- Aucune référence ni aucun code de demande (« RFC00094023 », « DH038970 », « RFP99619 », numéros d'AO), aucun nom de personne, e-mail, téléphone, lien ou adresse précise.
- Les technologies, méthodes, normes et réglementations du marché restent citées (Java, SAP, Kubernetes, IFRS 9, Bâle III, Scrum…).

Style : en français (traduis si l'offre est en anglais), professionnel et attractif, phrases courtes, sans emoji, sans point d'exclamation. N'invente rien : uniquement les informations de l'offre.

Réponds UNIQUEMENT avec un JSON valide, sans markdown :
{"title":"intitulé du poste, 70 caractères maximum, suivi de « (H/F) »","sector":"description anonyme du client, 50 caractères maximum (ex. « Grand groupe bancaire », « Acteur majeur de l'assurance »)","location":"ville ou région seulement, vide si inconnue","tagline":"une phrase d'accroche de 140 caractères maximum, propre à cette mission","missions":["3 à 6 puces de 120 caractères maximum : ce que fera le consultant"],"profile":["3 à 6 puces de 120 caractères maximum : expérience, compétences et qualités attendues"],"terms":["0 à 4 puces sur les modalités données par l'offre : durée, démarrage, rythme, expérience"],"skills":["jusqu'à 10 compétences ou technologies clés, 30 caractères maximum chacune, jamais un nom de direction, d'équipe ou de programme"],"removed":["chaque nom d'organisation, d'entité, de projet et chaque référence que tu as retiré, écrit comme dans l'offre"]}`

/** Texte envoyé à l'IA : au-delà, un appel d'offres n'apporte plus rien à une offre de quelques puces. */
const MAX_DESCRIPTION_CHARS = 12_000

/**
 * Demande adressée à l'IA. `offer` est déjà nettoyée (coordonnées retirées, clients connus remplacés : anonymize.ts) ;
 * `clients` (client de l'offre et clients cités) l'aide à reconnaître leurs sigles et variantes (« BNPP »).
 */
export function publicationRequest(offer: Pick<AoOfferFields, 'title' | 'location' | 'duration' | 'startDate' | 'experience' | 'skills' | 'description'>, clients: string[]): string {
  return [
    `Intitulé : ${offer.title}`,
    offer.location && `Lieu : ${offer.location}`,
    offer.duration && `Durée : ${offer.duration}`,
    offer.startDate && `Démarrage : ${offer.startDate}`,
    offer.experience && `Expérience : ${offer.experience}`,
    offer.skills.length > 0 && `Compétences : ${offer.skills.join(', ')}`,
    clients.length > 0 && `Clients à ne jamais citer, ni eux ni leurs sigles : ${clients.join(', ')}`,
    `Description :\n${offer.description.slice(0, MAX_DESCRIPTION_CHARS)}`,
  ].filter(Boolean).join('\n')
}

const line = (max: number) => z.unknown().optional().transform(v => (typeof v === 'string' ? v : '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max))
const lines = (maxItems: number, maxChars: number) => z.unknown().optional().transform(v =>
  (Array.isArray(v) ? v : []).map(item => line(maxChars).parse(item)).filter(Boolean).slice(0, maxItems))

const CopySchema = z.object({
  title: line(100).pipe(z.string().min(2)),
  sector: line(60),
  location: line(80),
  tagline: line(200),
  missions: lines(6, 160),
  profile: lines(6, 160),
  terms: lines(4, 160),
  skills: lines(10, 40),
  removed: lines(30, 80),
}).refine(c => c.missions.length + c.profile.length > 0)

export type PublicationCopy = z.infer<typeof CopySchema>

/** Réponse de l'IA, éventuellement entourée de texte ou de balises ``` ; null si elle est inutilisable. */
export function parsePublicationCopy(raw: string): PublicationCopy | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const parsed = CopySchema.safeParse(JSON.parse(raw.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null // JSON coupé ou invalide : la version par les règles est proposée à la place
  }
}

/** Description publiée : format lu par la page publique (JobDescription) et par la rédaction des publications sociales. */
export function descriptionFromCopy(copy: PublicationCopy): string {
  const section = (title: string, items: string[]) => (items.length ? [`### ${title}`, ...items.map(i => `- ${i}`)].join('\n') : '')
  return [copy.tagline, section('Au programme', copy.missions), section('Profil recherché', copy.profile), section('Modalités', copy.terms)]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Noms que l'IA dit avoir retirés, masqués ensuite à la publication et signalés à la relecture — y compris ceux qu'elle
 * a laissés par erreur dans sa version : c'est précisément le cas à rattraper. Seule la ville de l'offre est gardée
 * (« Paris » cité comme retiré disparaîtrait sinon partout).
 */
export function maskTermsOf(copy: PublicationCopy): string[] {
  const city = words(copy.location).join(' ')
  return copy.removed.filter(term => words(term).join('').length >= 2 && words(term).join(' ') !== city)
}

/**
 * Noms à masquer tirés des termes retirés par l'IA : chacun tel quel, en mots entiers. Sans les variantes de
 * namesToHide (forme juridique ôtée…) : « Group IT » deviendrait « IT », masqué partout.
 */
export function maskNames(terms: string[]): string[][] {
  return terms.map(words).filter(w => w.join('').length >= 2)
}
