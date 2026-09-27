'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Briefcase, Building2, MapPin, Search, Users } from 'lucide-react'
import { SIZE_LABEL } from '@/lib/brand'

export interface DirectoryBrand {
  tenantId: string
  slug: string
  name: string
  logoUrl: string
  tagline: string
  sector: string
  headquarters: string
  size: string
  coverUrl: string
  openJobs: number
}

type Sort = 'hiring' | 'az'

export function EmployersDirectory({ brands }: { brands: DirectoryBrand[] }) {
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('')
  const [sort, setSort] = useState<Sort>('hiring')
  const [onlyHiring, setOnlyHiring] = useState(false)

  const sectors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const b of brands) if (b.sector) counts.set(b.sector, (counts.get(b.sector) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 8)
  }, [brands])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return brands
      .filter(b => (!sector || b.sector === sector) && (!onlyHiring || b.openJobs > 0) &&
        (!q || `${b.name} ${b.tagline} ${b.sector} ${b.headquarters}`.toLowerCase().includes(q)))
      .sort((a, b) => (sort === 'hiring' ? b.openJobs - a.openJobs : 0) || a.name.localeCompare(b.name, 'fr'))
  }, [brands, query, sector, sort, onlyHiring])

  const totalJobs = brands.reduce((s, b) => s + b.openJobs, 0)
  const chip = (active: boolean) => active
    ? { background: 'var(--color-primary)', color: 'white', border: '1px solid var(--color-primary)' }
    : { background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }

  return (
    <div style={{ background: 'var(--color-background)', minHeight: '100vh' }}>
      {/* ── Bandeau ── */}
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--color-primary)' }}>Marque employeur</p>
          <h1 style={{ color: 'white', fontWeight: 300, fontSize: 'clamp(1.9rem, 4vw, 2.75rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Attirez les meilleurs talents en parlant de votre entreprise et de vos valeurs</h1>
          <p className="mt-3" style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.02rem', maxWidth: 640 }}>
            Créez votre page marque employeur, présentez votre culture et vos avantages, et donnez envie aux meilleurs consultants de vous rejoindre.
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-6 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4" style={{ color: 'var(--color-primary)' }} /><strong style={{ color: 'white' }}>{brands.length}</strong> entreprise{brands.length > 1 ? 's' : ''}</span>
            <span className="inline-flex items-center gap-2"><Briefcase className="h-4 w-4" style={{ color: 'var(--color-primary)' }} /><strong style={{ color: 'white' }}>{totalJobs}</strong> offre{totalJobs > 1 ? 's' : ''} ouverte{totalJobs > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Recherche & filtres ── */}
        {brands.length > 0 && (
          <div className="space-y-3 mb-8">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 px-4 rounded-xl flex-1 min-w-[240px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher une entreprise, un secteur, une ville…"
                  className="w-full py-3 text-sm outline-none bg-transparent" style={{ color: 'var(--color-text)' }} />
              </div>
              <select value={sort} onChange={e => setSort(e.target.value as Sort)} className="px-3.5 py-3 rounded-xl text-sm outline-none" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="hiring">Celles qui recrutent d’abord</option>
                <option value="az">Ordre alphabétique</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setOnlyHiring(v => !v)} className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors" style={chip(onlyHiring)}>● Recrutent maintenant</button>
              <button type="button" onClick={() => setSector('')} className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors" style={chip(sector === '')}>Tous les secteurs</button>
              {sectors.map(s => <button key={s} type="button" onClick={() => setSector(sector === s ? '' : s)} className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors" style={chip(sector === s)}>{s}</button>)}
            </div>
          </div>
        )}

        {brands.length === 0 ? (
          <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Building2 className="h-9 w-9 mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucune entreprise n&apos;a encore publié sa page. Revenez bientôt !</p>
            <Link href="/jobs" className="inline-block mt-3 text-sm font-semibold no-underline" style={{ color: 'var(--color-primary)' }}>Voir toutes les offres →</Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-sm py-16" style={{ color: 'var(--color-text-muted)' }}>Aucune entreprise ne correspond à votre recherche.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visible.map(b => (
              <Link key={b.tenantId} href={`/entreprises/${b.slug}`} className="group rounded-2xl overflow-hidden no-underline flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-[var(--color-primary)]"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="relative h-32" style={{ background: 'var(--hero-bg)' }}>
                  {b.coverUrl && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={b.coverUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />)}
                  {b.coverUrl && <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)' }} />}
                  {b.openJobs > 0 && (
                    <span className="absolute top-3 right-3 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#10b981', color: 'white' }}>
                      {b.openJobs} offre{b.openJobs > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="px-5 pb-5 flex-1 flex flex-col">
                  <div className="-mt-8 w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center relative" style={{ background: 'white', border: '1px solid var(--color-border)', boxShadow: '0 4px 14px rgba(0,0,0,0.1)' }}>
                    {b.logoUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={b.logoUrl} alt="" className="w-full h-full object-contain p-1.5" />
                      : <Building2 className="h-7 w-7" style={{ color: '#9ca3af' }} />}
                  </div>
                  <h2 className="mt-3 font-bold" style={{ color: 'var(--color-text)', fontSize: '1.12rem' }}>{b.name}</h2>
                  <p className="mt-1.5 text-sm line-clamp-2" style={{ color: 'var(--color-text-muted)', lineHeight: 1.55, minHeight: '2.6em' }}>{b.tagline || 'Découvrez notre entreprise et nos opportunités.'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {b.sector && <span className="inline-flex items-center gap-1"><Briefcase className="h-3 w-3" />{b.sector}</span>}
                    {b.headquarters && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{b.headquarters}</span>}
                    {b.size && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{SIZE_LABEL[b.size]?.replace(' collaborateurs', '')}</span>}
                  </div>
                  <div className="mt-auto pt-4 flex items-center justify-between text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
                    Découvrir l&apos;entreprise
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
