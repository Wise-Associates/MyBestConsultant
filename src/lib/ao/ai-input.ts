// Ce que l'IA reçoit d'un appel d'offres avant sa publication (offer-actions.ts) : noms du client et des expéditeurs à
// masquer, puis l'AO aux noms remplacés par « le client » pour la proposition des critères de matching (ADR 0061) et
// pour la version publiée (ADR 0013). Pur, sur des données déjà lues : un script reproduit exactement les messages de
// l'application (exemples d'affinage).

import { namesToHide, scrubContacts } from './anonymize'
import type { AoForCriteria } from './criteria-proposal'
import { parseSender } from './origin'
import { publicationRequest } from './publication-copy'
import type { AoContact, AoEmail, AoOfferFields } from './types'

/** Données lues pour les noms à masquer d'une offre AO. */
export interface HiddenNamesSource {
  /** Client de l'offre (ao_offers.companyName). */
  companyName: string
  /** E-mail d'origine de l'offre (ao_emails) ; undefined s'il est introuvable. */
  email: Pick<AoEmail, 'fromName' | 'fromAddress' | 'origin' | 'citedClients'> | undefined
  /** Interlocuteur du client lu par l'IA (ao_offer_details.contact) ; absent sans détails ni contact. */
  contact: AoContact | null | undefined
  /** Domaines de l'organisation qui lit la boîte (ao_sources.ownDomains) : jamais masqués. */
  ownDomains: string[]
}

export interface HiddenNames {
  clients: string[]
  names: string[][]
  people: string[][]
}

/**
 * Noms à masquer : client de l'offre et clients cités par l'appel d'offres (avec leurs sigles), nom et domaine de
 * l'expéditeur de l'e-mail, de celui du message d'origine et de l'interlocuteur lu par l'IA (sauf ceux de
 * l'organisation qui lit la boîte). `clients` : les clients seuls, tels qu'écrits, pour la consigne donnée à l'IA.
 * `people` : les noms de ces personnes seules, signalés à la relecture d'une version non anonymisée.
 */
export function hiddenNamesOf({ companyName, email, contact, ownDomains }: HiddenNamesSource): HiddenNames {
  const clients = [companyName, ...(email?.citedClients ?? [])].filter(Boolean)
  const senders = [
    { name: email?.fromName, address: email?.fromAddress },
    parseSender(email?.origin ?? '') ?? {},
    ...(contact ? [{ name: contact.name, address: contact.email }] : []),
  ]
  return {
    clients,
    names: namesToHide(clients, senders, ownDomains),
    // Sans adresse : seulement les noms (pas les domaines, qui nomment des sociétés).
    people: namesToHide([], senders.map(sender => ({ name: sender.name }))),
  }
}

/** Coordonnées et références retirées, noms à masquer remplacés par « le client ». */
const withoutClient = (text: string, names: string[][]) => scrubContacts(text, names, 'le client')

/** Texte de l'AO aux noms du client remplacés (« le client »), comme l'IA de la version publiée le reçoit. */
export function cleanedAo(offer: Pick<AoOfferFields, 'title' | 'description' | 'skills' | 'location' | 'experience'>, names: string[][]): AoForCriteria {
  const clean = (text: string) => withoutClient(text, names)
  return {
    title: clean(offer.title), description: clean(offer.description), skills: offer.skills.map(clean), location: clean(offer.location),
    experience: clean(offer.experience),
  }
}

/**
 * Message envoyé à l'IA qui rédige la version publiée (publicationRequest) : intitulé, lieu et description nettoyés
 * comme dans cleanedAo ; durée, démarrage, expérience et compétences tels que reçus ; `clients` (hiddenNamesOf) cités
 * comme noms à ne jamais écrire.
 */
export function publicationAiRequest(
  offer: Pick<AoOfferFields, 'title' | 'location' | 'duration' | 'startDate' | 'experience' | 'skills' | 'description'>, clients: string[], names: string[][],
): string {
  const clean = (text: string) => withoutClient(text, names)
  return publicationRequest({ ...offer, title: clean(offer.title), location: clean(offer.location), description: clean(offer.description) }, clients)
}
