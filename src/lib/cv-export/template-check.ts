import { z } from 'zod'
import { MAX_UNCOMPRESSED_BYTES, zipFitsWithin } from '@/lib/ao/extractors/office'
import { MAX_MAP_LENGTH, MAX_TEMPLATE_BYTES, TEMPLATE_TOO_LARGE } from './limits'
import { TemplateStructureError, renderCv } from './render'
import type { CvData, CvLang, TemplateMap } from './types'

// Modèle Word d'une organisation, déposé depuis sa CV Thèque (ADR 0010) : le .docx seul, sa cartographie
// (template_map.json) étant écrite par l'IA au dépôt (template-mapping.ts, ADR 0014). Vérifiés avant d'être enregistrés :
// cartographie au bon format, puis rendu d'un candidat fictif dans les deux langues — un index ou un prototype qui ne
// correspond pas au fichier est refusé ici plutôt qu'à la première génération. Règles pures, testées dans
// template-check.test.ts.


/** Modèle ou cartographie refusés : message pour qui le dépose (admin ou recruteur). */
export class TemplateError extends Error {}

const index = z.number().int().min(0)
// Bornes de taille : la cartographie est écrite par l'IA, qu'un texte du modèle peut tenter d'orienter ; répétée, une
// section ou un jeton multiplie le travail du rendu. Larges : la cartographie Wise a 5 sections, 16 prototypes, 6 jetons
// au plus par layout et des gabarits de moins de 40 caractères.
const name = z.string().max(60)
const template = z.string().max(300)
const record = <T extends z.ZodType>(value: T, maxKeys: number) =>
  z.record(name, value).refine(r => Object.keys(r).length <= maxKeys, { message: `${maxKeys} clés au plus` })
const labels = record(z.string().max(200), 40)
const replacements = z.record(z.string().max(200), z.string().max(200))
  .refine(r => Object.keys(r).length <= 30, { message: '30 remplacements au plus' }).optional()
const tokens = z.array(name).max(30)

const TemplateMapSchema = z.object({
  esn: z.string().trim().min(2).max(100),
  body_start: index,
  body_end: index.nullable().optional(),
  fixed: z.array(z.object({ path: z.array(index).min(1).max(4), fields: z.array(template).max(20) })).max(20).optional(),
  protos: record(index.nullable(), 40),
  fields: record(z.union([z.array(template).max(20), z.array(z.array(template).max(20)).max(20)]), 40).optional(),
  joins: record(z.object({ list: name, item: template, sep: z.string().max(20).optional() }), 10).optional(),
  identity_format: template.optional(),
  tab_stop: z.union([index, z.object({ pos: index, align: z.string().max(10).optional() })]).optional(),
  tab_stop_on: tokens.optional(),
  requires: record(name, 40).optional(),
  sections: z.array(z.union([name, z.object({
    layout: tokens, keep_with_previous: z.boolean().optional(), together: z.boolean().optional(),
  })])).max(12).optional(),
  layouts: record(tokens, 30).optional(),
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
}

/** Fichier du formulaire de dépôt (champ `template`), à la taille permise ; message sinon. Sans lecture. */
export function templateUploadFiles(docx: FormDataEntryValue | null): TemplateUploadFiles | { error: string } {
  if (!(docx instanceof File) || docx.size === 0) return { error: 'Joignez le modèle Word (.docx).' }
  if (docx.size > MAX_TEMPLATE_BYTES) return { error: TEMPLATE_TOO_LARGE }
  return { docx }
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

/** Fichier Word sain : taille, signature d'archive, décompression réelle bornée. TemplateError sinon. */
export function assertWordFile(bytes: Uint8Array): void {
  if (bytes.length === 0) throw new TemplateError('Fichier du modèle vide.')
  if (bytes.length > MAX_TEMPLATE_BYTES) throw new TemplateError(TEMPLATE_TOO_LARGE)
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw new TemplateError('Ce fichier n\'est pas un document Word (.docx) : un PDF ou un .doc ne peut pas servir de modèle.')
  // Décompression réelle bornée avant toute lecture : une archive piégée ne remplit pas la mémoire du serveur.
  if (!zipFitsWithin(Buffer.from(bytes), MAX_UNCOMPRESSED_BYTES)) throw new TemplateError('Archive Word illisible ou trop volumineuse une fois décompressée.')
}

/**
 * Vérifie un modèle et sa cartographie en rendant le candidat fictif dans les deux langues ; renvoie les deux rendus
 * (aperçu). TemplateError si le fichier n'est pas un .docx sain ou si la cartographie ne lui correspond pas.
 */
export function checkTemplate(bytes: Uint8Array, map: TemplateMap): Record<CvLang, Uint8Array> {
  assertWordFile(bytes)
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
