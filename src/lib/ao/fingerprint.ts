import { createHash } from 'node:crypto'
import { PLATFORM_TENANT_ID } from './tenancy'
import type { AoOfferFields } from './types'

// Dédoublonnage : un même appel d'offres arrive souvent plusieurs fois (relances, plusieurs intermédiaires,
// corps + pièce jointe). Deux offres sont considérées identiques si elles ont, une fois normalisés,
// le même intitulé (mots dans n'importe quel ordre, sans « H/F »), le même client, la même ville et
// le même type de contrat. La date de démarrage n'en fait pas partie : elle varie d'un envoi à l'autre
// (« ASAP », « 01/09 »…). La fenêtre de comparaison est limitée dans le temps (voir DUPLICATE_WINDOW_DAYS).

export const DUPLICATE_WINDOW_DAYS = 60

const STOP_WORDS = new Set([
  'h', 'f', 'hf', 'fh', 'x', 'homme', 'femme',
  'de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'un', 'une', 'et', 'ou', 'en', 'a', 'au', 'aux', 'pour', 'sur', 'avec',
])

export const LEGAL_SUFFIXES = new Set(['sa', 'sas', 'sasu', 'sarl', 'eurl', 'snc', 'se', 'group', 'groupe', 'france'])

function words(value: string): string[] {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(h|f)\s*\/\s*(f|h)\b/g, ' ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

export function titleKey(title: string): string {
  return [...new Set(words(title).filter(w => !STOP_WORDS.has(w)))].sort().join(' ')
}

export function companyKey(company: string): string {
  return words(company).filter(w => !LEGAL_SUFFIXES.has(w)).join(' ')
}

/** « Paris 15e (75015) », « PARIS - La Défense » → « paris » ; « Saint-Denis » reste « saint denis ». */
export function cityKey(location: string): string {
  const first = location.split(/\s[-–]\s|[,(/–]/)[0] ?? ''
  return words(first).filter(w => !/^\d+(e|er|eme)?$/.test(w) && w !== 'cedex').join(' ')
}

/**
 * Empreinte d'une offre, propre à son organisation : deux organisations qui reçoivent le même appel d'offres ont
 * chacune leur offre. Celles de la plateforme gardent la forme d'avant les organisations (empreintes déjà en base).
 */
export function offerFingerprint(offer: Pick<AoOfferFields, 'title' | 'companyName' | 'location' | 'contractType'>, tenantId = PLATFORM_TENANT_ID): string {
  const parts = [titleKey(offer.title), companyKey(offer.companyName), cityKey(offer.location), offer.contractType]
  const key = (tenantId === PLATFORM_TENANT_ID ? parts : [tenantId, ...parts]).join('|')
  return createHash('sha256').update(key).digest('hex').slice(0, 40)
}
