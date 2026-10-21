import type { ExtractedOffer } from './types'

// Expéditeur d'origine d'un appel d'offres et client des offres qu'il contient. Règle métier
// (docs/adr/0004-ao-client-expediteur-origine.md) : le client d'une offre AO est l'entreprise de celui qui a
// envoyé l'appel d'offres à l'origine, pas le collaborateur de l'organisation qui le transfère à sa boîte, ni le
// client final cité dans le texte. Un e-mail transféré garde dans son corps l'en-tête du message d'origine
// (« De : … <adresse> »).

export interface Sender {
  name: string
  address: string
}

/** Organisation qui lit la boîte : ses collaborateurs (ses domaines) transfèrent les AO, ils n'en sont jamais l'origine. */
export interface Organization {
  name: string
  /** Domaines de ses adresses (« wise-associates.fr ») ; comparés par label, sous-domaines et extensions compris. */
  ownDomains: string[]
}

// Messageries grand public, par domaine complet : orange.com, laposte.fr ou sfr.com sont des entreprises (et de gros
// acheteurs d'informatique), orange.fr, laposte.net ou sfr.fr des boîtes de particuliers.
const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'aol.com', 'aol.fr', 'gmx.com', 'gmx.fr', 'gmx.de', 'proton.me',
  'protonmail.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr', 'yopmail.com',
])

// Domaines à suffixe en deux parties (« client.co.uk », « mairie.gouv.fr ») : le nom est le label qui les précède.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gouv', 'gov', 'ac', 'asso'])

/** Label qui nomme l'organisation : « marie@mail.sopra-steria.co.uk » → « sopra-steria » ; '' sans domaine. */
export function domainLabel(address: string): string {
  const labels = address.split('@')[1]?.toLowerCase().split('.').filter(Boolean) ?? []
  if (labels.length < 2) return ''
  const tld = labels.length - 1
  return labels.length >= 3 && labels[tld].length === 2 && SECOND_LEVEL.has(labels[tld - 1]) ? labels[tld - 2] : labels[tld - 1]
}

const isOwn = (address: string, ownDomains: string[]) => {
  const label = domainLabel(address)
  return !!label && ownDomains.some(d => domainLabel(`x@${d}`) === label)
}

/** Label du domaine s'il nomme l'entreprise de l'expéditeur ; '' pour une messagerie grand public ou l'organisation elle-même. */
export function identifyingLabel(address: string, ownDomains: string[] = []): string {
  const label = domainLabel(address)
  const domain = address.split('@')[1]?.trim().toLowerCase() ?? ''
  return !label || isOwn(address, ownDomains) || CONSUMER_DOMAINS.has(domain) ? '' : label
}

// Le corps vient de l'expéditeur et peut peser 25 Mo : la recherche d'en-têtes ne lit que son début, ligne par ligne,
// et saute les lignes trop longues pour être un en-tête. Avec des expressions sans quantificateur ambigu, son coût
// reste proportionnel à la taille lue (un corps de lignes vides ou d'un seul mot géant ne la ralentit pas).
const MAX_SCANNED_CHARS = 200_000
const MAX_HEADER_LINE = 1_000

const EMAIL = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/
const EMAILS = new RegExp(EMAIL.source, 'g')
// En-tête d'un message transféré ou cité : « De : Marie Dupont <marie@client.fr> », « From: … [mailto:…] »,
// en gras dans un texte tiré du HTML (« *De :* ») ou cité (« > De : »). Un « De : » sans adresse n'en est pas un.
const FROM_LINE = /^[ \t>*]*(?:de|from|exp[ée]diteur)[ \t*]*:[ \t*]*(.*)$/i
// Outlook coupe parfois un « De : » long : l'adresse passe seule à la ligne suivante.
const ADDRESS_ONLY = new RegExp(`^[\\s<[]*(?:mailto:)?${EMAIL.source}[\\s>\\]]*$`, 'i')
// Introduction d'une réponse, parfois coupée sur deux lignes : « Le lun. 20 oct. 2026 à 10:12, Marie <…> a écrit : ».
const WROTE_START = /^[ \t>]*(?:le|on)\s/i
const WROTE_END = /\s(?:a\s+écrit|wrote)\s*:\s*$/i

const clean = (s: string) => s.replace(/&lt;|&gt;|&quot;|mailto:|[<>"[\]()*]/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '')

/** « Marie Dupont <marie@client.fr> », « "Dupont, Marie" [mailto:…] », « marie@client.fr » → expéditeur ; null sans adresse. */
export function parseSender(value: string): Sender | null {
  const address = value.match(EMAIL)?.[0]
  if (!address) return null
  return { name: clean(value.replace(EMAILS, ' ')).slice(0, 200), address: address.toLowerCase().slice(0, 320) }
}

/** Forme enregistrée sur l'e-mail (AoEmail.origin), relue par parseSender. */
export function formatSender(sender: Sender): string {
  return sender.name ? `${sender.name} <${sender.address}>` : sender.address
}

function headerSender(line: string, next: string): Sender | null {
  const value = line.match(FROM_LINE)?.[1]
  if (value === undefined) return null
  return parseSender(value) ?? (ADDRESS_ONLY.test(next) ? parseSender(`${value} ${next}`) : null)
}

function replySender(line: string, next: string): Sender | null {
  if (!WROTE_START.test(line)) return null
  const joined = `${line} ${next}`
  const intro = WROTE_END.test(line) ? line : next.length <= MAX_HEADER_LINE && WROTE_END.test(joined) ? joined : ''
  const match = intro.match(EMAIL)
  if (!match) return null
  // Le nom suit la date, après la dernière virgule (« …, Marie Martin <… ») ; la forme anglaise (« … at 10:12 AM
  // Marie Martin <… ») ne le sépare pas de l'heure : on n'en garde alors aucun.
  const name = clean(intro.slice(0, match.index).split(',').pop() ?? '')
  return { name: /\d/.test(name) ? '' : name.slice(0, 200), address: match[0].toLowerCase().slice(0, 320) }
}

/**
 * Expéditeur d'origine : l'en-tête cité le plus bas dans le corps (le message le plus ancien) dont l'adresse n'est
 * pas de l'organisation (`ownDomains`) ; à défaut, l'expéditeur de l'e-mail s'il n'en est pas. null : appel d'offres
 * écrit ou transféré par l'organisation sans en-tête d'origine lisible.
 */
export function originalSender(message: { fromName: string; fromAddress: string; text: string }, ownDomains: string[]): Sender | null {
  const lines = message.text.slice(0, MAX_SCANNED_CHARS).split('\n')
  let oldest: Sender | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_HEADER_LINE) continue
    const next = lines[i + 1] ?? ''
    const sender = headerSender(lines[i], next) ?? replySender(lines[i], next)
    if (sender && !isOwn(sender.address, ownDomains)) oldest = sender
  }
  if (oldest) return oldest
  const envelope = parseSender(message.fromAddress)
  return envelope && !isOwn(envelope.address, ownDomains) ? { name: clean(message.fromName).slice(0, 200), address: envelope.address } : null
}

const MINOR_WORDS = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'au', 'aux'])
const capitalize = (w: string) => w[0].toUpperCase() + w.slice(1)

/** Nom d'entreprise tiré du domaine (« sopra-steria.com » → « Sopra Steria », « bnp.fr » → « BNP ») ; '' si non identifiant. */
export function companyFromDomain(address: string, ownDomains: string[] = []): string {
  const words = identifyingLabel(address, ownDomains).split('-').filter(Boolean)
  // Un sigle court seul s'écrit en capitales (BNP, EDF, AXA) ; un nom en plusieurs mots a rarement cette forme, ni
  // ses petits mots (« Caisse des Depots ») : l'IA, qui lit la signature, donne mieux la forme exacte.
  if (words.length === 1 && words[0].length <= 3) return words[0].toUpperCase()
  return words.map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : capitalize(w))).join(' ').slice(0, 200)
}

/**
 * Client de toutes les offres d'un e-mail : l'entreprise de l'expéditeur d'origine telle que l'IA l'a lue dans sa
 * signature (le nom le plus fréquent de ses réponses), sinon déduite du domaine de son adresse. null sans expéditeur
 * d'origine, ou si son entreprise reste inconnue (messagerie grand public sans signature lisible) : chaque offre
 * garde alors le client lu dans le texte ou dans le tableau. Le nom de l'organisation elle-même n'est jamais retenu.
 */
export function senderCompany(origin: Sender | null, aiCompanies: string[], org: Organization): string | null {
  if (!origin) return null
  const own = fold(org.name)
  const counts = new Map<string, number>()
  for (const name of aiCompanies.map(n => n.trim()).filter(n => n && !(own && fold(n).includes(own)))) counts.set(name, (counts.get(name) ?? 0) + 1)
  const [mostFrequent] = [...counts].sort((a, b) => b[1] - a[1])
  return (mostFrequent?.[0] || companyFromDomain(origin.address, org.ownDomains)).slice(0, 200) || null
}

/** Nom comparable : minuscules, sans accents ni ponctuation. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const MAX_CITED_CLIENTS = 20

/**
 * Clients cités par l'appel d'offres (colonne « Client » d'un tableau, client final lu par l'IA), relevés avant que le
 * client de l'offre ne devienne l'entreprise de l'expéditeur : enregistrés sur l'e-mail pour être masqués à la publication.
 */
export function citedClients(offers: Pick<ExtractedOffer, 'companyName' | 'endClient'>[]): string[] {
  const names = offers.flatMap(o => [o.companyName, o.endClient]).map(n => n.trim()).filter(Boolean)
  return [...new Set(names)].slice(0, MAX_CITED_CLIENTS)
}
