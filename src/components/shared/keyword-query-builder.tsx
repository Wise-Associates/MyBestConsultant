'use client'

import { Plus, X } from 'lucide-react'
import type { KeywordRow } from '@/lib/keyword-match'

export type { KeywordRow }
export { emptyKeywordRows, matchesKeywordRows, isExcludedByKeywordRows } from '@/lib/keyword-match'

// Reusable "mot-clé ET/OU mot-clé ET/OU mot-clé…" row builder — used for both the
// include and exclude keyword groups, on the CVthèque and the job board. When `formNames`
// is given, each row also renders real form fields (visible term input + hidden op input)
// so a native <form method="GET"> submission carries the rows as repeated query params.
export function KeywordQueryBuilder({
  rows, onChange, placeholder, addLabel, formNames,
}: {
  rows: KeywordRow[]
  onChange: (rows: KeywordRow[]) => void
  placeholder?: string
  addLabel: string
  formNames?: { term: string; op: string }
}) {
  function updateTerm(i: number, term: string) {
    onChange(rows.map((r, idx) => idx === i ? { ...r, term } : r))
  }
  function updateOp(i: number, op: 'AND' | 'OR') {
    onChange(rows.map((r, idx) => idx === i ? { ...r, op } : r))
  }
  function addRow() {
    onChange([...rows, { term: '', op: 'AND' }])
  }
  function removeRow(i: number) {
    onChange(rows.length === 1 ? [{ term: '', op: 'AND' }] : rows.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="mbc-search-row flex items-center gap-2" style={{ animationDelay: `${i * 60}ms` }}>
          {i > 0 && (
            <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--color-border)' }}>
              {(['AND', 'OR'] as const).map(op => (
                <button key={op} type="button" onClick={() => updateOp(i, op)}
                  className="mbc-search-toggle px-3 py-2 text-xs font-bold"
                  style={row.op === op
                    ? { background: 'var(--navbar-bg)', color: 'white' }
                    : { background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
                  {op === 'AND' ? 'ET' : 'OU'}
                </button>
              ))}
            </div>
          )}
          {formNames && i > 0 && <input type="hidden" name={formNames.op} value={row.op} />}
          <input
            value={row.term}
            onChange={e => updateTerm(i, e.target.value)}
            placeholder={placeholder}
            name={formNames?.term}
            className="mbc-search-input flex-1 min-w-0 px-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          <button type="button" onClick={() => removeRow(i)}
            className="mbc-search-toggle shrink-0 p-2 rounded-lg hover:opacity-70"
            style={{ color: 'var(--color-text-muted)' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}
        className="flex items-center gap-1.5 text-xs font-semibold transition-all hover:opacity-75 hover:gap-2.5"
        style={{ color: 'var(--color-primary)' }}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  )
}
