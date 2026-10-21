import { norm, readSheets } from '@/lib/job-import'
import { MAX_ATTACHMENT_BYTES, MAX_UNCOMPRESSED_BYTES, zipFitsWithin } from './extractors/office'
import { formatOf, type Attachment } from './extractors/types'
import { parseOfferFields } from './parse'
import type { ExtractedOffer } from './types'

// Tableaux d'offres joints aux e-mails (tableau de suivi d'AO d'un client, export de la page AO Offers…) :
// chaque ligne devient une offre, colonne par colonne, SANS IA. C'est instantané, gratuit, et sans limite de
// longueur : l'IA, elle, doit réécrire chaque offre, et sa réponse est coupée au-delà d'une dizaine d'offres.
// Un tableau dont les colonnes ne sont pas reconnues reste lu par l'IA, comme texte (extractors/office.ts).
// Les valeurs passent par la même validation que les réponses de l'IA (parse.ts). Règles pures, testées
// dans ao.test.ts avec les en-têtes de vrais tableaux reçus.

/**
 * Formats lus comme tableaux. Pas d'ODS : SheetJS y développe les cellules « répétées » pendant la lecture, avant
 * toute limite (1 Ko peut annoncer des millions de cellules).
 */
export const TABLE_FORMATS = new Set(['xlsx', 'xls', 'csv', 'tsv'])
/** Lignes de données lues au plus par fichier : bien au-delà d'un tableau d'AO, borne le travail sur un fichier piégé. */
export const MAX_TABLE_ROWS = 500
/** La ligne d'en-tête n'est pas forcément la première (titre de feuille au-dessus). */
const HEADER_SEARCH_ROWS = 15
/** Bornes de lecture d'un tableau joint : un tableau d'AO a quelques dizaines de colonnes au plus. */
const READ_LIMITS = { maxRows: HEADER_SEARCH_ROWS + MAX_TABLE_ROWS + 1, maxCols: 64, maxTextBytes: 1_000_000 }

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * Le contenu correspond-il à l'extension ? SheetJS reconnaît le format au contenu, pas au nom : sans ce contrôle,
 * une archive zip nommée « .xls » ou « .csv » échapperait à la vérification de décompression.
 */
function contentMatches(format: string, content: Buffer): boolean {
  if (format === 'xlsx') return content.subarray(0, 4).equals(ZIP_MAGIC)
  if (format === 'xls') return content.subarray(0, 8).equals(CFB_MAGIC)
  // CSV / TSV : du texte, ni archive, ni classeur binaire, ni balisage (HTML ou XML lus autrement par SheetJS).
  const start = content.subarray(0, 4)
  return !start.equals(ZIP_MAGIC) && !content.subarray(0, 8).equals(CFB_MAGIC) && content[0] !== 0x3c && !content.includes(0)
}

type Column = 'salary' | 'deadline' | 'engagement' | 'technologies' | 'ignored' | 'remote' | 'location' | 'contract' | 'duration' | 'start' | 'experience' | 'skills' | 'company' | 'description' | 'title'

/**
 * Noms de colonnes reconnus, normalisés par `norm` (minuscules, sans accents ni parenthèses), essayés DANS CET
 * ORDRE : le premier groupe dont un nom figure, en mots entiers, dans l'en-tête l'emporte. L'ordre lève les
 * ambiguïtés : « Taux journalier » est un TJM avant d'être un taux de suivi interne, « Durée de la mission »
 * une durée avant d'être une mission, « Description du poste » une description avant d'être un intitulé.
 */
const COLUMNS: [Column, string[]][] = [
  ['salary', ['tjm', 'taux journalier', 'tarif', 'budget', 'salaire', 'remuneration', 'salary', 'prix']],
  ['deadline', ['date limite', 'date de cloture', 'cloture', 'echeance', 'date de reponse', 'deadline']],
  // Suivi interne du tableau (numéro, statut, candidats présentés, notes…) et personnes ou coordonnées : jamais
  // repris (données personnelles). Testé avant l'intitulé : n'y mettre aucun mot d'un en-tête d'intitulé.
  ['ignored', ['reference', 'ref', 'n ao', 'numero', 'id', 'statut', 'candidat', 'candidats', 'candidature', 'candidatures', 'positionne',
    'positionnes', 'note', 'notes', 'commentaire', 'commentaires', 'date de reception', 'taux', 'priorite',
    'responsable', 'commercial', 'interlocuteur', 'interlocuteurs', 'manager', 'referent', 'demandeur', 'acheteur', 'contact',
    'coordonnees', 'email', 'e mail', 'mail', 'telephone', 'tel', 'mobile', 'portable', 'linkedin']],
  ['remote', ['teletravail', 'tt', 'remote', 'rythme', 'presentiel', 'mode de travail', 'organisation du travail']],
  ['location', ['lieu', 'ville', 'localisation', 'location', 'site', 'region', 'adresse']],
  ['contract', ['type de contrat', 'contrat', 'contract', 'type de mission']],
  ['engagement', ['assistance technique', 'assistance', 'forfait', 'type de prestation', 'mode d intervention', 'engagement']],
  ['duration', ['duree', 'duration']],
  ['start', ['demarrage', 'debut', 'start', 'disponibilite']],
  ['experience', ['experience', 'seniorite', 'niveau']],
  ['technologies', ['technologies', 'technologie', 'stack', 'environnement technique']],
  ['skills', ['competences', 'competence', 'skills', 'mots cles', 'outils']],
  ['company', ['client', 'entreprise', 'societe', 'company', 'donneur d ordre']],
  ['description', ['description', 'descriptif', 'contexte', 'missions', 'mission', 'activites', 'taches', 'profil', 'prerequis', 'livrables',
    'objectifs', 'detail', 'details', 'contenu', 'besoin']],
  ['title', ['intitule', 'titre', 'poste', 'job title', 'title', 'libelle', 'offre', 'fonction', 'role']],
]

function columnOf(header: unknown): Column | null {
  const padded = ` ${norm(header)} `
  if (!padded.trim()) return null
  for (const [column, names] of COLUMNS) {
    if (names.some(name => padded.includes(` ${name} `))) return column
  }
  return null
}

interface Header {
  index: number
  columns: { column: Column; col: number; label: string }[]
}

/** Ligne d'en-tête : un intitulé et au moins une autre colonne reconnue (un mot isolé ne suffit pas). */
function findHeader(rows: string[][]): Header | null {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH_ROWS); i++) {
    const columns = rows[i]
      .map((cell, col) => ({ column: columnOf(cell), col, label: String(cell ?? '').trim() }))
      .filter((c): c is Header['columns'][number] => c.column !== null && c.column !== 'ignored')
    if (columns.some(c => c.column === 'title') && columns.length >= 2) return { index: i, columns }
  }
  return null
}

function offerOf(row: string[], { columns }: Header): ExtractedOffer | null {
  const cell = (col: number) => String(row[col] ?? '').trim()
  const first = (column: Column) => {
    const found = columns.find(c => c.column === column)
    return found ? cell(found.col) : ''
  }
  const all = (column: Column) => columns.filter(c => c.column === column).map(c => ({ label: c.label, value: cell(c.col) })).filter(c => c.value)
  const descriptions = all('description')
  return parseOfferFields({
    title: first('title'),
    companyName: first('company'),
    location: first('location'),
    contractType: first('contract'),
    remote: first('remote'),
    salary: first('salary'),
    skills: all('skills').map(c => c.value).join(','),
    technologies: all('technologies').map(c => c.value).join(','),
    engagement: first('engagement'),
    // Une seule colonne de description : reprise telle quelle. Plusieurs (contexte, missions…) : une section
    // titrée par colonne, que la page admin et la publication découpent ensuite (description-sections.ts).
    description: descriptions.length === 1 ? descriptions[0].value : descriptions.map(d => `### ${d.label}\n${d.value}`).join('\n\n'),
    duration: first('duration'),
    startDate: first('start'),
    deadline: first('deadline'),
    experience: first('experience'),
  })
}

export interface TableOffers {
  offers: ExtractedOffer[]
  /** Lignes non vides écartées, faute d'intitulé exploitable. */
  skippedRows: number
  /** true : le tableau dépasse MAX_TABLE_ROWS lignes, la suite n'a pas été lue. */
  truncated: boolean
}

/** Offres des feuilles d'un classeur (lignes de cellules texte) ; null si aucune feuille n'est un tableau d'offres. */
export function tableOffersOf(sheets: string[][][]): TableOffers | null {
  let recognized = false
  const offers: ExtractedOffer[] = []
  let skippedRows = 0
  let rowsRead = 0
  for (const rows of sheets) {
    const header = findHeader(rows)
    if (!header) continue
    recognized = true
    for (const row of rows.slice(header.index + 1)) {
      if (row.every(c => !String(c ?? '').trim())) continue
      if (++rowsRead > MAX_TABLE_ROWS) return { offers, skippedRows, truncated: true }
      const offer = offerOf(row, header)
      if (offer) offers.push(offer)
      else skippedRows++
    }
  }
  return recognized ? { offers, skippedRows, truncated: false } : null
}

/**
 * Offres d'une pièce jointe si c'est un tableau d'offres reconnu ; null sinon : la chaîne d'extracteurs la lit
 * alors comme les autres pièces jointes (texte pour l'IA), et l'écarte avec la raison si elle est trop
 * volumineuse, piégée ou sans texte lisible.
 */
export function readTableAttachment(file: Attachment): TableOffers | null {
  const format = formatOf(file)
  if (!TABLE_FORMATS.has(format) || file.content.length > MAX_ATTACHMENT_BYTES || !contentMatches(format, file.content)) return null
  if (format === 'xlsx' && !zipFitsWithin(file.content, MAX_UNCOMPRESSED_BYTES)) return null
  let sheets: string[][][]
  try {
    sheets = readSheets(file.content, format, READ_LIMITS)
  } catch {
    return null // illisible comme tableau : la chaîne d'extracteurs tente une lecture en texte et donne la raison
  }
  return tableOffersOf(sheets)
}
