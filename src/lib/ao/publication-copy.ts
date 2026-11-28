import { parseModelJson } from '@/lib/ai/model-json'
import { z } from 'zod'
import { STANDARD_DAILY_QUOTAS } from '@/lib/plans'
import { words } from './name-match'
import type { AoOfferFields } from './types'

// Version publiée d'une offre AO rédigée par l'IA (« Préparer la publication », ADR 0013) : anonyme (ni client, ni
// entité, ni projet, ni référence : chacun décrit de façon générique), courte et structurée comme les publications sur
// les réseaux (accroche, contexte — ADR 0060 —, missions, profil, modalités). L'IA ne fait que proposer : la réponse est validée ici, repasse par l'anonymisation
// (anonymize.ts) et un humain la relit et la valide avant toute publication. Règles pures, testées dans
// publication-copy.test.ts.

/**
 * Rédactions par l'IA demandées par les recruteurs, par jour (UTC) : par organisation, et pour toutes ensemble (l'admin
 * n'est pas compté). L'IA est aux frais de la plateforme et l'inscription est libre.
 */
// `perOrganisation` : quota des formules standard (plans.ts) ; une offre sur mesure peut le changer (Entitlements.dailyQuotas).
export const AO_PUBLICATION_AI_DAILY_LIMITS = { perOrganisation: STANDARD_DAILY_QUOTAS.aoRewrite, allOrganisations: 300 } as const

/** Raisons affichées dans la phrase « L'IA n'a pas rédigé cette version (…) » du panneau. */
export const PUBLICATION_AI_QUOTA_MESSAGE = {
  organisation: (limit: number) => `limite de ${limit} rédactions par l'IA par jour atteinte pour votre organisation`,
  platform: 'trop de rédactions par l\'IA aujourd\'hui sur la plateforme',
} as const

export const PUBLICATION_PROMPT = `Tu rédiges la version publique d'une offre de mission IT reçue d'un client (appel d'offres), pour un site de recrutement et les réseaux sociaux.

Anonymat, règle absolue :
- L'entreprise ou l'organisme qui recrute, son groupe, ses filiales et marques, le client final, les partenaires et prestataires cités : jamais nommés, chacun décrit par sa nature ou son secteur (« BNP Paribas » → « un grand groupe bancaire », « la CNAF » → « un organisme national de protection sociale »), jamais simplement supprimé.
- Wise Associates (cabinet qui transmet l'offre) et My Best Consultant (site de recrutement) : aucune mention, ni de rien qui leur soit propre (signature, clients, activité).
- Les directions et départements dont le nom ne désigne pas une entreprise restent tels quels : DSI, DPII, DRH, direction des opérations, MOA, MOE. Ne les cite pas dans "removed".
- Un service au nom trop spécifique et un lieu précis (site, bâtiment, centre nommé) sont reformulés par leur rôle ou leur activité : « SNSSI de Nantes » → « une équipe nationale chargée de l'exploitation et du support informatiques » ; cite le nom d'origine dans "removed". La ville de la mission va dans "location".
- Un nom que l'offre présente comme un outil, une application, un logiciel, une plateforme ou un programme du client (« l'outil ORION », « ORION (outil d'instruction) », « projet B-STEADY ») est interne, même s'il ressemble au nom d'une entreprise connue : remplacé partout par sa fonction (« l'outil d'instruction », « un programme de transformation ») et cité dans "removed".
- Aucun chiffre propre au client (nombre de clients, de salariés, de lits, de logements, de sites, montants, volumes) : au plus un ordre de grandeur (« plusieurs millions de clients »).
- Aucune référence ni aucun code de demande (« RFC00094023 », « DH038970 », « RFP99619 », numéros d'AO), aucun nom de personne, e-mail, téléphone, lien ou adresse.
- Les technologies, méthodes, normes et réglementations du marché restent citées (Java, SAP, Kubernetes, IFRS 9, Bâle III, Scrum…).

Contenu : garde les informations générales utiles pour comprendre le secteur, les missions, la chaîne de traitement et les expertises recherchées, pas seulement les technologies. Retirer un nom ne retire jamais le contexte : le contexte est toujours rédigé, même quand l'offre n'a pas de paragraphe de contexte ; déduis alors la nature et l'activité du client de ses missions, de ses outils (désignés par leur fonction) et de son vocabulaire, sans rien inventer d'autre. Il dit ce que fait le client (décrit par sa nature), dans quel environnement métier, quelle chaîne de traitement et quel projet il mène, et pourquoi ; les missions et le profil gardent le domaine, les processus et la réglementation dont parle l'offre : aucune connaissance métier demandée par l'offre (dispositif, réglementation, domaine fonctionnel) n'est retirée du profil, seules les qualités personnelles peuvent être résumées. Les modalités (durée, démarrage, rythme) ne sont pas à rédiger : elles sont ajoutées à partir des informations de l'offre.

Style : en français (traduis si l'offre est en anglais), professionnel et attractif, phrases courtes, sans emoji, sans point d'exclamation. N'invente rien : uniquement les informations de l'offre, sans phrase de remplissage (« projet crucial », « améliorer l'efficacité »).

Réponds UNIQUEMENT avec un JSON valide, sans markdown :
{"title":"intitulé du poste, 70 caractères maximum, suivi de « (H/F) »","sector":"description anonyme du client, 50 caractères maximum (ex. « Grand groupe bancaire », « Acteur majeur de l'assurance »)","location":"ville ou région seulement, vide si inconnue","tagline":"une phrase d'accroche de 140 caractères maximum, propre à cette mission","context":"2 à 4 phrases, 500 caractères maximum, toujours rédigé. Première phrase : le client décrit par sa nature et son activité, « recrute un profil pour », la mission principale et son objectif (ex. « Un organisme public chargé de services numériques de télédéclaration recrute un profil pour assurer le support applicatif de niveau 2 et contribuer au bon fonctionnement de son système d'information. ») ; puis son environnement métier, la chaîne de traitement, le projet et ses enjeux","missions":["3 à 6 puces de 120 caractères maximum : ce que fera le consultant"],"profile":["3 à 6 puces de 120 caractères maximum : expérience, compétences et qualités attendues"],"skills":["jusqu'à 10 compétences ou technologies clés, 30 caractères maximum chacune, jamais un nom de direction, d'équipe ou de programme"],"removed":["chaque nom d'organisation, de service, de lieu précis, d'outil ou de programme et chaque référence que tu as retiré, écrit comme dans l'offre ; jamais une direction gardée"]}`

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
  // Demandé à chaque fois ; une réponse sans contexte reste acceptée (la relecture la complète) plutôt que refusée.
  context: line(600),
  missions: lines(6, 160),
  profile: lines(6, 160),
  // Pas de modalités : écrites par le code (modalityLines) ; celles que l'IA renverrait quand même sont ignorées.
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
    const parsed = CopySchema.safeParse(parseModelJson(raw.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null // JSON coupé ou invalide : la version par les règles est proposée à la place
  }
}

/**
 * Modalités de la version publiée, écrites par le code à partir des champs lus dans l'e-mail (ADR 0060) : l'IA en
 * inventait une durée ou un démarrage dans la moitié des AO qui n'en donnaient pas. Champ vide : pas de ligne.
 */
export function modalityLines(offer: Pick<AoOfferFields, 'duration' | 'startDate' | 'experience'>): string[] {
  const one = (text: string) => text.replace(/\s+/g, ' ').trim()
  return [
    one(offer.duration) && `Durée : ${one(offer.duration)}`,
    one(offer.startDate) && `Démarrage : ${one(offer.startDate)}`,
    one(offer.experience) && `Expérience : ${one(offer.experience)}`,
  ].filter((line): line is string => Boolean(line))
}

/**
 * Description publiée : format lu par la page publique (JobDescription) et par la rédaction des publications sociales.
 * `modalities` : modalityLines de l'offre.
 */
export function descriptionFromCopy(copy: PublicationCopy, modalities: string[] = []): string {
  const section = (title: string, items: string[]) => (items.length ? [`### ${title}`, ...items.map(i => `- ${i}`)].join('\n') : '')
  // « Le contexte » : un paragraphe, avant les missions (lu comme le contexte par description-sections.ts).
  const context = copy.context ? `### Le contexte\n${copy.context}` : ''
  return [copy.tagline, context, section('Au programme', copy.missions), section('Profil recherché', copy.profile), section('Modalités', modalities)]
    .filter(Boolean)
    .join('\n\n')
}

/** Sigles de directions et de fonctions génériques, qui ne désignent aucune entreprise : gardés tels quels (ADR 0060). */
const GENERIC_UNITS = new Set(['dsi', 'dsin', 'dnum', 'dpii', 'drh', 'daf', 'dg', 'dga', 'moa', 'moe', 'amoa', 'pmo', 'rssi'])
const GENERIC_UNIT_HEAD = /^(?:direction|département|departement|service|division|pôle|pole|bureau|cellule|équipe|equipe)s?(?![\p{L}\p{N}])/iu

/**
 * Direction ou département générique (« DSI », « DPII », « Direction des opérations ») : gardé dans la version publiée
 * (consigne du 2026-11-24), donc jamais masqué, même si l'IA le cite parmi les noms retirés ; masqué, il deviendrait le
 * libellé affiché partout. Un intitulé propre au client (« Service Liquidation Aquitaine », « Direction Générale des
 * Finances Publiques ») porte d'autres majuscules : il reste masqué.
 */
export function isGenericUnit(term: string): boolean {
  const name = term.trim()
  const w = words(name)
  if (w.length === 1 && GENERIC_UNITS.has(w[0])) return true
  return GENERIC_UNIT_HEAD.test(name) && !/[\p{Lu}\p{N}]/u.test(name.slice(1))
}

/**
 * Noms de la plateforme, signalés en rouge à la relecture d'une version anonymisée (ADR 0060) : Wise Associates (même
 * nom que PLATFORM_NAME, tenancy.ts) et le site MyBestConsultant. Plus refusés à la publication depuis le 2026-11-28 :
 * l'offre doit pouvoir nommer l'organisation qui la publie.
 */
export const PLATFORM_NAMES: string[][] = [words('Wise Associates'), words('MyBestConsultant'), words('My Best Consultant')]

/**
 * Noms que l'IA dit avoir retirés, masqués ensuite à la publication et signalés à la relecture — y compris ceux qu'elle
 * a laissés par erreur dans sa version : c'est précisément le cas à rattraper. Seule la ville de l'offre est gardée,
 * même suivie de son département (« Paris » cité comme retiré disparaîtrait sinon partout, « Montreuil (93) » serait
 * listé parmi les noms masqués), ainsi que les expressions ordinaires, écrites sans majuscule ni chiffre (« dispositifs
 * nationaux », constaté le 2026-11-24) : masquées, elles deviendraient le libellé affiché partout où elles reviennent.
 * Un nom, un sigle, un outil ou une référence en ont toujours.
 */
export function maskTermsOf(copy: PublicationCopy): string[] {
  const place = (text: string) => words(text).filter(w => !/^\d+$/.test(w)).join(' ')
  const city = place(copy.location)
  return copy.removed.filter(term => words(term).join('').length >= 2 && place(term) !== city && /[\p{Lu}\p{N}]/u.test(term)
    && !isGenericUnit(term))
}

/**
 * Noms à masquer tirés des termes retirés par l'IA : chacun tel quel, en mots entiers. Sans les variantes de
 * namesToHide (forme juridique ôtée…) : « Group IT » deviendrait « IT », masqué partout.
 */
export function maskNames(terms: string[]): string[][] {
  return terms.map(words).filter(w => w.join('').length >= 2)
}
