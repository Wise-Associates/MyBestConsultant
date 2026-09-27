import * as XLSX from 'xlsx'

// Import en masse d'offres depuis un tableur (Excel .xlsx/.xls ou CSV) : lecture directe des colonnes, SANS passer par
// l'IA — c'est ce qui permet d'importer des centaines ou des milliers de lignes de façon fiable et instantanée.

export type ImportContract = 'cdi' | 'cdd' | 'freelance' | 'mission'
export type ImportRemote = 'onsite' | 'hybrid' | 'remote'

export interface SheetJob {
  title: string
  location: string
  contractType: ImportContract
  remote: ImportRemote
  salary: number | null
  skills: string[]
  description: string
  companyName: string
  confidence: 'high' | 'medium' | 'low'
}

export interface SheetParseResult {
  /** false = aucune colonne « titre » reconnue : le fichier n'est pas un tableau d'offres (on bascule sur l'IA). */
  recognized: boolean
  jobs: SheetJob[]
  skipped: { row: number; reason: string }[]
  totalRows: number
  error?: string
}

export const MAX_SHEET_ROWS = 5000

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

const HEADERS: Record<'title' | 'company' | 'location' | 'contract' | 'remote' | 'salary' | 'skills' | 'description' | 'duration' | 'start' | 'experience', string[]> = {
  title: ['titre du poste', 'titre', 'poste', 'intitule du poste', 'intitule', 'job title', 'title', 'offre', 'libelle'],
  company: ['entreprise', 'societe', 'client', 'company', 'nom entreprise', 'organisation'],
  location: ['ville', 'localisation', 'lieu', 'location', 'region', 'site', 'lieu de travail'],
  contract: ['type de contrat', 'contrat', 'contract', 'type contrat', 'type'],
  remote: ['teletravail', 'remote', 'mode de travail', 'organisation du travail'],
  salary: ['salaire ou tjm', 'salaire', 'tjm', 'tarif', 'remuneration', 'salary', 'budget', 'tarif journalier'],
  skills: ['competences', 'skills', 'technologies', 'mots cles', 'stack', 'competences cles'],
  description: ['description du poste', 'description', 'descriptif', 'missions', 'mission', 'detail', 'contenu', 'profil recherche'],
  duration: ['duree de la mission', 'duree', 'duration'],
  start: ['date de demarrage', 'demarrage', 'date de debut', 'start'],
  experience: ['experience requise', 'experience', 'seniorite'],
}
type Field = keyof typeof HEADERS

function matchField(cell: unknown): Field | null {
  const n = norm(cell)
  if (!n) return null
  for (const [field, syns] of Object.entries(HEADERS) as [Field, string[]][]) {
    if (syns.some(s => n === s || n.startsWith(s + ' '))) return field
  }
  return null
}

function decode(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8')
  return utf8.includes('�') ? buffer.toString('latin1') : utf8.replace(/^﻿/, '')
}

/** Lit un classeur (xlsx, xls) ou un CSV/TSV (séparateur « ; », « , » ou tabulation détecté automatiquement). */
function readSheets(buffer: Buffer, ext: string): string[][][] {
  let wb: XLSX.WorkBook
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    const text = decode(buffer)
    const first = text.split(/\r?\n/, 1)[0] ?? ''
    const count = (c: string) => first.split(c).length - 1
    const FS = count(';') > count(',') && count(';') >= count('\t') ? ';' : count('\t') > count(',') ? '\t' : ','
    wb = XLSX.read(text, { type: 'string', FS, raw: true } as XLSX.ParsingOptions)
  } else {
    wb = XLSX.read(buffer, { type: 'buffer' })
  }
  return wb.SheetNames.map(name => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }))
}

const parseNumber = (v: string): number | null => {
  const s = v.toLowerCase().replace(/\s/g, '').replace(/[€$]|eur(os)?|\/j(our)?|\/mois|\/an/g, '')
  const m = s.match(/(\d+(?:[.,]\d+)?)(k)?/)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.')) * (m[2] ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function contractOf(v: string): ImportContract {
  const n = norm(v)
  if (/\bcdi\b/.test(n)) return 'cdi'
  if (/\bcdd\b/.test(n)) return 'cdd'
  if (/freelance|independant|tjm|portage/.test(n)) return 'freelance'
  return 'mission'
}

function remoteOf(v: string): ImportRemote {
  const n = norm(v)
  if (/full|100|complet|distance|remote/.test(n) && !/hybrid|partiel/.test(n)) return 'remote'
  if (/onsite|presentiel|sur site|site/.test(n) && !/hybrid/.test(n)) return 'onsite'
  return 'hybrid'
}

export function parseSpreadsheetJobs(buffer: Buffer, filename: string, defaultCompany: string): SheetParseResult {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  let sheets: string[][][]
  try { sheets = readSheets(buffer, ext) } catch { return { recognized: false, jobs: [], skipped: [], totalRows: 0, error: 'Fichier illisible.' } }

  const jobs: SheetJob[] = []
  const skipped: { row: number; reason: string }[] = []
  const seen = new Set<string>()
  let recognized = false
  let totalRows = 0

  for (const rows of sheets) {
    // La ligne d'en-tête n'est pas forcément la première : on la cherche dans les 15 premières lignes.
    let headerIdx = -1
    let cols: Partial<Record<Field, number>> = {}
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const found: Partial<Record<Field, number>> = {}
      rows[i].forEach((cell, c) => { const f = matchField(cell); if (f && found[f] === undefined) found[f] = c })
      if (found.title !== undefined && Object.keys(found).length >= 2) { headerIdx = i; cols = found; break }
    }
    if (headerIdx < 0) continue
    recognized = true

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r]
      const get = (f: Field) => (cols[f] === undefined ? '' : String(row[cols[f]!] ?? '').trim())
      if (row.every(c => !String(c ?? '').trim())) continue
      totalRows++
      if (totalRows > MAX_SHEET_ROWS) return { recognized, jobs, skipped, totalRows, error: `Le fichier dépasse ${MAX_SHEET_ROWS} lignes : découpez-le en plusieurs fichiers.` }

      const lineNo = r + 1
      const title = get('title').slice(0, 200)
      if (!title) { skipped.push({ row: lineNo, reason: 'Titre du poste manquant' }); continue }
      const location = get('location').slice(0, 200)
      const companyName = (get('company') || defaultCompany).slice(0, 1000)
      const key = `${norm(title)}|${norm(location)}|${norm(companyName)}`
      if (seen.has(key)) { skipped.push({ row: lineNo, reason: 'Doublon dans le fichier' }); continue }
      seen.add(key)

      const extras = [
        get('duration') && `Durée de la mission : ${get('duration')}`,
        get('start') && `Démarrage : ${get('start')}`,
        get('experience') && `Expérience requise : ${get('experience')}`,
      ].filter(Boolean) as string[]
      const description = [get('description'), ...extras].filter(Boolean).join('\n\n') || `${title}${companyName ? ` — ${companyName}` : ''}${location ? ` (${location})` : ''}`
      const hasDesc = !!get('description')

      jobs.push({
        title, location,
        contractType: contractOf(get('contract')),
        remote: remoteOf(get('remote')),
        salary: parseNumber(get('salary')),
        skills: [...new Set(get('skills').split(/[,;|\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 10),
        description: description.slice(0, 60_000),
        companyName,
        confidence: hasDesc && location ? 'high' : hasDesc || location ? 'medium' : 'low',
      })
    }
  }
  return { recognized, jobs, skipped, totalRows }
}
