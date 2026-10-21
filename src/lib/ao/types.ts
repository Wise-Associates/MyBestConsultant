// Types du module « AO Offers » (AO = appels d'offres) : appels d'offres reçus dans les boîtes lues — celles de la
// plateforme et celles des organisations, quelle que soit leur adresse (sources.ts) —, extraits par l'IA,
// stockés dans deux collections (AO_EMAILS, AO_OFFERS) puis publiés en offres anonymisées.

export type AoContract = 'cdi' | 'cdd' | 'freelance' | 'mission'
export type AoRemote = 'onsite' | 'hybrid' | 'remote'

/** to_review : à valider par un admin · published : offre publique créée · ignored : écartée par un admin */
export type AoOfferStatus = 'to_review' | 'published' | 'ignored'

/** processing : en cours (ou interrompu) · processed : offres extraites · no_offer : rien d'exploitable · failed : erreur, réessayé */
export type AoEmailStatus = 'processing' | 'processed' | 'no_offer' | 'failed'

/** Les 11 colonnes du modèle Excel (public/templates/modele-import-offres.xlsx). */
export interface AoOfferFields {
  title: string
  companyName: string
  location: string
  contractType: AoContract
  remote: AoRemote
  salary: number | null
  skills: string[]
  description: string
  duration: string
  startDate: string
  experience: string
}

/** assistance : profil(s) facturé(s) à l'unité (régie, TJM) · forfait : projet à prix global · '' : non précisé. */
export type AoEngagement = 'assistance' | 'forfait' | ''

/**
 * Détails d'une offre hors des 11 colonnes du modèle : collection AO_OFFER_DETAILS (un document par offre, de même
 * identifiant), ao_offers étant à 16/16 attributs.
 */
export interface AoOfferDetails {
  engagement: AoEngagement
  /** Technologies, langages, outils et plateformes cités (distincts des compétences). */
  technologies: string[]
}

/**
 * Offre lue dans un e-mail (par l'IA ou dans un tableau joint) : ses champs et ses détails, plus la date limite de
 * réponse et le client final cité, gardés sur l'e-mail (AoEmail) : ao_offers est à 16/16 attributs.
 */
export interface ExtractedOffer extends AoOfferFields, AoOfferDetails {
  deadline: string
  endClient: string
}

export interface AoOffer extends AoOfferFields {
  $id: string
  createdAt: string
  /** Empreinte de dédoublonnage (voir fingerprint.ts). */
  fingerprint: string
  /** $id du document AO_EMAILS d'origine (premier e-mail reçu pour cette offre). */
  emailId: string
  status: AoOfferStatus
  /** $id de l'offre publique créée à la publication. */
  jobId: string | null
  /** Nombre d'e-mails ayant apporté cette même offre (doublons fusionnés). */
  sourceCount: number
}

export interface AoEmail {
  $id: string
  /** Boîte lue (sources.ts) : ses e-mails sont suivis à part de ceux des autres boîtes (même Message-ID compris). */
  sourceId: string
  messageId: string
  uid: number
  fromAddress: string
  fromName: string
  /**
   * Expéditeur du message d'origine d'un e-mail transféré, sinon celui de l'e-mail, sous la forme « Nom <adresse> »
   * (origin.ts : formatSender / parseSender) ; vide s'il est des nôtres. Un seul attribut : ao_emails est à 16 au plus.
   */
  origin: string
  /** Date limite de réponse à l'appel d'offres (la plus proche de ses offres) : information interne, jamais publiée. */
  deadline: string
  /** Clients cités par l'appel d'offres (tableau, texte) : masqués à la publication, comme le client de l'offre. */
  citedClients: string[]
  subject: string
  receivedAt: string
  /** Noms des pièces jointes lues (pas leur contenu : il n'est pas conservé). */
  attachments: string[]
  status: AoEmailStatus
  error: string
  offerCount: number
  duplicateCount: number
  attempts: number
  /** Dernière mise à jour (détecte un traitement interrompu). */
  updatedAt: string
}
