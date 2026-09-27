// Shared file-to-text extraction for job import (recruiter and admin flows share this
// so a fix or a new format only needs to be added once, and both stay in sync).
import * as XLSX from 'xlsx'

// pdf-parse uses pdfjs-dist which needs browser APIs — polyfill for Node.js
if (typeof globalThis.DOMMatrix === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).DOMMatrix = class DOMMatrix {
    constructor() { return this }
  }
}

const MAX_CHARS = 15_000

export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // CSV / TXT — direct
  if (['csv', 'txt', 'tsv', 'md'].includes(ext)) {
    return buffer.toString('utf-8').slice(0, MAX_CHARS)
  }

  // PDF — real parser
  if (ext === 'pdf') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const data = await pdfParse(buffer)
      return data.text.slice(0, MAX_CHARS)
    } catch {
      return buffer.toString('utf-8', 0, 5_000).replace(/[^\x20-\x7E\n]/g, ' ')
    }
  }

  // DOCX — real parser
  if (ext === 'docx') {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value.slice(0, MAX_CHARS)
    } catch {
      const raw = buffer.toString('utf-8', 0, Math.min(buffer.length, 500_000))
      return raw.replace(/<w:p[ >]/g, '\n').replace(/<[^>]+>/g, '').slice(0, MAX_CHARS)
    }
  }

  // DOC (old binary format) — mammoth first, word-extractor fallback
  if (ext === 'doc') {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      if (result.value && result.value.trim().length > 30) return result.value.slice(0, MAX_CHARS)
    } catch { /* fall through */ }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const WordExtractor = require('word-extractor') as new () => { extract: (buf: Buffer) => Promise<{ getBody: () => string }> }
      const extractor = new WordExtractor()
      const doc = await extractor.extract(buffer)
      return doc.getBody().slice(0, MAX_CHARS)
    } catch { /* fall through */ }

    return buffer.toString('latin1')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .trim()
      .slice(0, MAX_CHARS)
  }

  // XLS / XLSX — real spreadsheet parser (handles formulas, dates, multiple sheets,
  // merged cells correctly — a previous version scraped raw XML with a regex, which
  // broke on anything but the simplest single-sheet files).
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const csv = workbook.SheetNames
        .map(name => `--- ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
        .join('\n\n')
      return csv.slice(0, MAX_CHARS)
    } catch {
      return ''
    }
  }

  // PPTX (PowerPoint) / RTF / OpenDocument (odt, ods, odp)
  if (['pptx', 'rtf', 'odt', 'ods', 'odp'].includes(ext)) {
    try {
      const officeParser = await import('officeparser')
      const ast = await officeParser.parseOffice(buffer, { fileType: ext as 'pptx' | 'rtf' | 'odt' | 'ods' | 'odp' })
      const result = await ast.to('text')
      const text = typeof result === 'string' ? result : result.value
      return text.slice(0, MAX_CHARS)
    } catch {
      return ''
    }
  }

  // Fallback
  return buffer.toString('utf-8', 0, 10_000).replace(/[^\x20-\x7E\n\t]/g, ' ')
}
