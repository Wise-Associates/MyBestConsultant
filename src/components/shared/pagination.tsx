'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

function pageWindow(page: number, totalPages: number): (number | '…')[] {
  const pages = new Set([1, totalPages, page, page - 1, page + 1])
  const sorted = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

export function Pagination({
  page, totalPages, onChange, accentColor = 'var(--color-primary)',
}: { page: number; totalPages: number; onChange: (p: number) => void; accentColor?: string }) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-1.5 py-6">
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
        className="p-2 rounded-xl transition-all disabled:opacity-30"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', boxShadow: '0 4px 14px rgba(11,29,81,0.06)' }}>
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pageWindow(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>…</span>
        ) : (
          <button key={p} onClick={() => onChange(p)}
            className="min-w-[2.5rem] h-10 px-3 rounded-xl text-sm font-semibold transition-all"
            style={p === page
              ? { background: accentColor, color: 'white', boxShadow: `0 8px 20px -4px ${accentColor}66` }
              : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', boxShadow: '0 4px 14px rgba(11,29,81,0.06)' }}>
            {p}
          </button>
        )
      )}

      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
        className="p-2 rounded-xl transition-all disabled:opacity-30"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', boxShadow: '0 4px 14px rgba(11,29,81,0.06)' }}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
