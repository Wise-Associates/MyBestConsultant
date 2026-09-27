// Shared by the CVthèque (client-side filtering) and the job board (server-side
// filtering) — kept in a plain module (no 'use client') so both sides can import it.

export interface KeywordRow { term: string; op: 'AND' | 'OR' }

export const emptyKeywordRows = (): KeywordRow[] => [{ term: '', op: 'AND' }]

// Evaluates a row list against a haystack string, left-to-right (row[0].op is ignored —
// there's nothing before it to combine with).
export function matchesKeywordRows(haystack: string, rows: KeywordRow[]): boolean {
  const active = rows.filter(r => r.term.trim())
  if (active.length === 0) return true
  const h = haystack.toLowerCase()
  let result = h.includes(active[0].term.trim().toLowerCase())
  for (let i = 1; i < active.length; i++) {
    const hit = h.includes(active[i].term.trim().toLowerCase())
    result = active[i].op === 'AND' ? (result && hit) : (result || hit)
  }
  return result
}

// For exclusion groups specifically: empty/untouched rows must exclude nothing, not
// everything. matchesKeywordRows() alone is wrong here — with no active terms it
// vacuously returns true (correct for "does it match the include filter"), which would
// make `!matchesKeywordRows(...)` used naively for exclusion reject every single item
// before the recruiter/visitor has typed anything to exclude.
export function isExcludedByKeywordRows(haystack: string, rows: KeywordRow[]): boolean {
  return rows.some(r => r.term.trim()) && matchesKeywordRows(haystack, rows)
}

// Parses repeated `kw`/`kwOp` (or `exclude`/`excludeOp`) URL search params back into rows.
// term[0] has no preceding operator; op[i-1] connects term[i-1] and term[i].
export function parseKeywordRowsFromParams(terms: string[] | undefined, ops: string[] | undefined): KeywordRow[] {
  if (!terms || terms.length === 0) return emptyKeywordRows()
  return terms.map((term, i) => ({
    term,
    op: i > 0 && ops?.[i - 1] === 'OR' ? 'OR' : 'AND',
  }))
}
