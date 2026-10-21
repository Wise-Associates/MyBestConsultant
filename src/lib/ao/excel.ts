import * as XLSX from 'xlsx'
import type { AoOfferFields, ExtractedOffer } from './types'

/** Une ligne de l'export : les champs de l'offre et la date limite de son e-mail. */
type ExportedOffer = AoOfferFields & Pick<ExtractedOffer, 'deadline'>

// Export Excel au format du modèle d'import (public/templates/modele-import-offres.xlsx) : le fichier
// téléchargé depuis AO Offers peut être ré-importé tel quel dans « Offres → Importer ».

export const AO_EXCEL_HEADERS = [
  'Titre du poste',
  'Entreprise',
  'Ville',
  'Type de contrat (cdi/cdd/freelance/mission)',
  'Télétravail (onsite/hybrid/remote)',
  'Salaire ou TJM (€, nombre uniquement)',
  'Compétences (séparées par des virgules)',
  'Description du poste',
  'Durée de la mission',
  'Date de démarrage',
  'Expérience requise',
  // Hors modèle d'import (ignorée par « Offres → Importer ») ; relue par la lecture des tableaux AO (spreadsheet.ts).
  'Date limite de réponse',
] as const

export function aoOfferRow(offer: ExportedOffer): (string | number)[] {
  return [
    offer.title,
    offer.companyName,
    offer.location,
    offer.contractType,
    offer.remote,
    offer.salary ?? '',
    offer.skills.join(', '),
    offer.description,
    offer.duration,
    offer.startDate,
    offer.experience,
    offer.deadline,
  ]
}

/** Classeur .xlsx (une feuille « AO Offers »). Les cellules texte restent du texte : pas d'injection de formule. */
export function buildAoWorkbook(offers: ExportedOffer[]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[...AO_EXCEL_HEADERS], ...offers.map(aoOfferRow)])
  sheet['!cols'] = [36, 24, 18, 14, 14, 12, 40, 80, 20, 16, 18, 16].map(wch => ({ wch }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'AO Offers')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
