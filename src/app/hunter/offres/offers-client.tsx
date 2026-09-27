'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Briefcase, Building2, MapPin, Search, Send, Wifi } from 'lucide-react'

export interface OfferRow {
  id: string; title: string; company: string; location: string; contractType: string | null; remote: string | null
  createdAt: string; skills: string[]; best: { score: number; name: string } | null; proposed: number
}

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote' }
const PAGE_SIZE = 12

export function OffersClient({ rows, hasProfiles }: { rows: OfferRow[]; hasProfiles: boolean }) {
  const [query, setQuery] = useState('')
  const [contract, setContract] = useState('')
  const [sort, setSort] = useState<'match' | 'recent'>(hasProfiles ? 'match' : 'recent')
  const [page, setPage] = useState(1)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter(r => (!contract || r.contractType === contract) && (!q || `${r.title} ${r.company} ${r.location} ${r.skills.join(' ')}`.toLowerCase().includes(q)))
      .sort((a, b) => sort === 'match' ? (b.best?.score ?? -1) - (a.best?.score ?? -1) : b.createdAt.localeCompare(a.createdAt))
  }, [rows, query, contract, sort])

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const sel = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

  return (
    <div className="space-y-5">
      {!hasProfiles && (
        <div className="rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <p className="text-sm" style={{ color: '#92400e' }}>Ajoutez d’abord des CV à votre vivier : la compatibilité de chaque offre avec vos profils sera calculée.</p>
          <Link href="/hunter/vivier" className="text-sm font-bold no-underline" style={{ color: '#b45309' }}>Aller au vivier →</Link>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 px-4 rounded-xl flex-1 min-w-[220px]" style={sel}>
          <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
          <input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} placeholder="Rechercher un poste, une entreprise, une compétence…" className="w-full py-3 text-sm outline-none bg-transparent" style={{ color: 'var(--color-text)' }} />
        </div>
        <select value={contract} onChange={e => { setContract(e.target.value); setPage(1) }} className="px-3.5 py-3 rounded-xl text-sm outline-none" style={sel}>
          <option value="">Tous les contrats</option>
          {Object.entries(CONTRACT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="px-3.5 py-3 rounded-xl text-sm outline-none" style={sel}>
          <option value="match">Meilleure compatibilité</option>
          <option value="recent">Plus récentes</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="text-center text-sm py-14" style={{ color: 'var(--color-text-muted)' }}>Aucune offre ne correspond.</p>
      ) : (
        <div className="space-y-3">
          {shown.map(r => (
            <Link key={r.id} href={`/hunter/offres/${r.id}`} className="group flex items-center gap-4 rounded-2xl p-4 sm:p-5 no-underline transition-colors hover:border-[#14b8a6]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0" style={r.best ? { background: r.best.score >= 60 ? 'rgba(16,185,129,0.14)' : r.best.score >= 30 ? 'rgba(232,163,61,0.16)' : 'rgba(107,114,128,0.12)', color: r.best.score >= 60 ? '#059669' : r.best.score >= 30 ? '#b8862f' : '#6b7280' } : { background: 'rgba(107,114,128,0.1)', color: '#9ca3af' }}>
                <span className="font-bold text-base leading-none">{r.best ? `${r.best.score}%` : '—'}</span>
                <span className="text-[9px] font-semibold mt-1 opacity-80">compat.</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate" style={{ color: 'var(--color-text)', fontSize: '1.02rem' }}>{r.title}</p>
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {r.company && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{r.company}</span>}
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.location}</span>
                  {r.contractType && <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" />{CONTRACT[r.contractType]}</span>}
                  {r.remote && <span className="inline-flex items-center gap-1"><Wifi className="h-3 w-3" />{REMOTE[r.remote]}</span>}
                </div>
                {r.skills.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{r.skills.map(s => <span key={s} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(11,29,81,0.06)', color: 'var(--color-text-muted)' }}>{s}</span>)}</div>}
                {r.best && r.best.score >= 20 && <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-muted)' }}>Meilleur profil : <strong style={{ color: 'var(--color-text)' }}>{r.best.name}</strong></p>}
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                {r.proposed > 0 && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>{r.proposed} proposé{r.proposed > 1 ? 's' : ''}</span>}
                <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: '#0d9488' }}><Send className="h-3.5 w-3.5" />Proposer<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Offres {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, visible.length)} sur {visible.length}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(current - 1)} disabled={current === 1} className="px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-35" style={sel}>Précédent</button>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{current} / {pages}</span>
            <button onClick={() => setPage(current + 1)} disabled={current === pages} className="px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-35" style={sel}>Suivant</button>
          </div>
        </div>
      )}
    </div>
  )
}
