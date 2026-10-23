// Export d'un CV au format de l'ESN (dossier de compétences anonymisé, FR / EN) — types partagés.
// Les noms de champs (identifiant, titre, role_lignes…) sont ceux de la skill cv-esn-anonymise, que les
// template_map.json référencent tels quels : ne pas les renommer.

export type CvLang = 'fr' | 'en'

/** Anonymisation standard : identité et coordonnées retirées. Renforcée : clients et employeurs aussi. */
export type AnonymizationMode = 'standard' | 'renforcee'

export interface CvExperience {
  dates: string
  client: string
  role_lignes: string[]
  contexte: string
  realisations: string[]
  environnement: string
}

export interface CvFormation {
  annees: string
  intitule: string
  etablissement: string
  details: string[]
}

export interface CvCertification {
  annee: string
  intitule: string
  organisme: string
}

/** Contenu d'une version (une langue) du dossier de compétences, déjà anonymisé. */
export interface CvData {
  identifiant: string
  titre: string
  experience: string
  resume: string[]
  experiences: CvExperience[]
  formations: CvFormation[]
  certifications: CvCertification[]
  langues: { langue: string; niveau: string }[]
  competences: { categorie: string; contenu: string }[]
}

export type TemplateSection = string | { layout: string[]; keep_with_previous?: boolean; together?: boolean }

export type TabStop = number | { pos: number; align?: string }

/**
 * Cartographie d'un template Word (template_map.json), produite par la skill cv-esn-anonymise (Étape 2) :
 * les index désignent les éléments du corps du document, ils ne valent que pour ce fichier template précis.
 */
export interface TemplateMap {
  esn: string
  body_start: number
  body_end?: number | null
  fixed?: { path: number[]; fields: string[] }[]
  protos: Record<string, number | null>
  fields?: Record<string, string[] | string[][]>
  joins?: Record<string, { list: string; item: string; sep?: string }>
  identity_format?: string
  tab_stop?: TabStop
  tab_stop_on?: string[]
  requires?: Record<string, string>
  sections?: TemplateSection[]
  layouts?: Record<string, string[]>
  labels?: Partial<Record<CvLang, Record<string, string>>>
  header_footer_replacements?: Record<string, string>
  header_footer_replacements_fr?: Record<string, string>
  header_footer_replacements_en?: Record<string, string>
}
