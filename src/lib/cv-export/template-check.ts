import { z } from 'zod'
import { MAX_UNCOMPRESSED_BYTES, zipFitsWithin } from '@/lib/ao/extractors/office'
import { MAX_MAP_LENGTH, MAX_TEMPLATE_BYTES, TEMPLATE_TOO_LARGE } from './limits'
import { TemplateStructureError, renderCv } from './render'
import type { CvData, CvLang, TemplateMap } from './types'

// Modèle Word d'une organisation, déposé depuis sa CV Thèque (ADR 0010) : le .docx et le template_map.json produit par
// la skill cv-esn-anonymise pour ce fichier précis. Vérifiés avant d'être enregistrés : cartographie au bon format, puis
// rendu d'un candidat fictif dans les deux langues — un index ou un prototype qui ne correspond pas au fichier est
// refusé ici plutôt qu'à la première génération. Règles pures, testées dans template-check.test.ts.


/** Modèle ou cartographie refusés : message pour qui le dépose (admin ou recruteur). */
export class TemplateError extends Error {}

const index = z.number().int().min(0)
const labels = z.record(z.string(), z.string())
const replacements = z.record(z.string(), z.string()).optional()

const TemplateMapSchema = z.object({
  esn: z.string().trim().min(2).max(100),
  body_start: index,
  body_end: index.nullable().optional(),
  fixed: z.array(z.object({ path: z.array(index).min(1).max(4), fields: z.array(z.string()) })).optional(),
  protos: z.record(z.string(), index.nullable()),
  fields: z.record(z.string(), z.union([z.array(z.string()), z.array(z.array(z.string()))])).optional(),
  joins: z.record(z.string(), z.object({ list: z.string(), item: z.string(), sep: z.string().optional() })).optional(),
  identity_format: z.string().optional(),
  tab_stop: z.union([index, z.object({ pos: index, align: z.string().optional() })]).optional(),
  tab_stop_on: z.array(z.string()).optional(),
  requires: z.record(z.string(), z.string()).optional(),
  sections: z.array(z.union([z.string(), z.object({
    layout: z.array(z.string()), keep_with_previous: z.boolean().optional(), together: z.boolean().optional(),
  })])).optional(),
  layouts: z.record(z.string(), z.array(z.string())).optional(),
  // Les deux langues : l'export propose toujours le français et l'anglais.
  labels: z.object({ fr: labels, en: labels }),
  header_footer_replacements: replacements,
  header_footer_replacements_fr: replacements,
  header_footer_replacements_en: replacements,
})

/** template_map.json lu et vérifié ; TemplateError avec la clé en cause sinon. */
export function parseTemplateMap(json: string): TemplateMap {
  if (json.length > MAX_MAP_LENGTH) throw new TemplateError(`Cartographie trop longue (${MAX_MAP_LENGTH} caractères au plus).`)
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new TemplateError('Cartographie illisible : le fichier template_map.json n\'est pas du JSON valide.')
  }
  const parsed = TemplateMapSchema.safeParse(raw)
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.map(String).join('.') || 'racine'
    throw new TemplateError(`Cartographie invalide : « ${path} » absent ou au mauvais format.`)
  }
  return parsed.data
}

export interface TemplateUploadFiles {
  docx: File
  map: File
}

/** Fichiers du formulaire de dépôt (champs `template` et `map`), aux tailles permises ; message sinon. Sans lecture. */
export function templateUploadFiles(docx: FormDataEntryValue | null, map: FormDataEntryValue | null): TemplateUploadFiles | { error: string } {
  if (!(docx instanceof File) || docx.size === 0 || !(map instanceof File) || map.size === 0) {
    return { error: 'Joignez le modèle Word (.docx) et son template_map.json.' }
  }
  if (docx.size > MAX_TEMPLATE_BYTES) return { error: TEMPLATE_TOO_LARGE }
  // Caractères accentués : jusqu'à 4 octets chacun ; la longueur exacte est vérifiée par parseTemplateMap.
  if (map.size > MAX_MAP_LENGTH * 4) return { error: `Cartographie trop longue (${MAX_MAP_LENGTH} caractères au plus).` }
  return { docx, map }
}

/** Candidat fictif rendu pour vérifier un modèle et en montrer l'aperçu. */
export const SAMPLE_CV: CvData = {
  identifiant: 'C.F.',
  titre: 'Architecte Data & Cloud',
  experience: '12 ans d\'expérience',
  resume: [
    'Architecte Data & Cloud avec 12 ans d\'expérience en banque et assurance : conception de plateformes de données.',
    'A piloté la migration d\'un entrepôt de données vers le cloud pour 300 utilisateurs.',
    'Diplômé d\'une école d\'ingénieurs (2012).',
  ],
  experiences: [
    {
      dates: 'Janv 2021 – Aujourd\'hui', client: 'Banque Exemple', role_lignes: ['Programme Data Platform — Architecte Data'],
      contexte: 'Refonte de la plateforme de données du groupe.',
      realisations: ['Conception de l\'architecture cible.', 'Mise en place des pipelines d\'ingestion.', 'Encadrement de 6 data engineers.'],
      environnement: 'Azure, Databricks, Spark, Kafka, Terraform',
    },
    {
      dates: 'Sept 2016 – Déc 2020', client: 'Assureur Fictif', role_lignes: ['Équipe BI — Lead développeur'], contexte: '',
      realisations: ['Développement des tableaux de bord de pilotage.', 'Automatisation des reportings réglementaires.'], environnement: '',
    },
  ],
  formations: [{ annees: '2012', intitule: 'Diplôme d\'ingénieur', etablissement: 'École d\'Ingénieurs Exemple', details: ['Systèmes d\'information'] }],
  certifications: [{ annee: '2022', intitule: 'Azure Solutions Architect Expert', organisme: 'Microsoft' }],
  langues: [{ langue: 'Anglais', niveau: 'courant' }, { langue: 'Espagnol', niveau: 'intermédiaire' }],
  competences: [{ categorie: 'Cloud', contenu: 'Azure, AWS, Terraform' }, { categorie: 'Data', contenu: 'Spark, Kafka, SQL' }],
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * Vérifie un modèle et sa cartographie en rendant le candidat fictif dans les deux langues ; renvoie les deux rendus
 * (aperçu). TemplateError si le fichier n'est pas un .docx sain ou si la cartographie ne lui correspond pas.
 */
export function checkTemplate(bytes: Uint8Array, map: TemplateMap): Record<CvLang, Uint8Array> {
  if (bytes.length === 0) throw new TemplateError('Fichier du modèle vide.')
  if (bytes.length > MAX_TEMPLATE_BYTES) throw new TemplateError(TEMPLATE_TOO_LARGE)
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw new TemplateError('Ce fichier n\'est pas un document Word (.docx) : un PDF ou un .doc ne peut pas servir de modèle.')
  // Décompression réelle bornée avant toute lecture : une archive piégée ne remplit pas la mémoire du serveur.
  if (!zipFitsWithin(Buffer.from(bytes), MAX_UNCOMPRESSED_BYTES)) throw new TemplateError('Archive Word illisible ou trop volumineuse une fois décompressée.')
  const render = (lang: CvLang) => {
    try {
      return renderCv(bytes, map, SAMPLE_CV, lang)
    } catch (err) {
      if (err instanceof TemplateStructureError) throw new TemplateError(err.message)
      throw new TemplateError(`Le modèle et sa cartographie ne correspondent pas (${lang.toUpperCase()}) : ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { fr: render('fr'), en: render('en') }
}
