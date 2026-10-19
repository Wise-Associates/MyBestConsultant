// Types du module « AO Offers » : appels d'offres reçus sur la boîte ao@, extraits par l'IA,
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
  messageId: string
  uid: number
  fromAddress: string
  fromName: string
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
