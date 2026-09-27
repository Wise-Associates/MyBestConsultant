'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  Search, Users, FileText, Sparkles, ScanSearch, ExternalLink, AlertCircle,
  Loader2, MapPin, Navigation, Building2, Briefcase, Mail, Phone, FolderSearch,
} from 'lucide-react'
import { scanCandidateCv, getCvthequeCandidates, type CvThequeCandidate } from './actions'
import { SECTORS } from '@/lib/candidate-taxonomy'
import { Pagination } from '@/components/shared/pagination'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'

const PAGE_SIZE = 50

export function CvthequeClient({ initialCandidates, loadError }: { initialCandidates: CvThequeCandidate[]; loadError?: string }) {
  const [candidates, setCandidates] = useState(initialCandidates)
  const [search, setSearch] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all')
  const [page, setPage] = useState(1)
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [rowError, setRowError] = useState('')
  const [, startTransition] = useTransition()

  const stats = useMemo(() => ({
    total: candidates.length,
    withCv: candidates.filter(c => c.cvFileId).length,
    scanned: candidates.filter(c => c.skills.length > 0).length,
  }), [candidates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return candidates.filter(c => {
      if (sectorFilter && !c.desiredSector.includes(sectorFilter)) return false
      if (availabilityFilter === 'available' && !c.openToWork) return false
      if (availabilityFilter === 'unavailable' && c.openToWork) return false
      if (!q) return true
      const haystack = `${c.name} ${c.email} ${c.city} ${c.skills.join(' ')} ${c.desiredSector.join(' ')} ${c.desiredRoles.join(' ')}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [candidates, search, sectorFilter, availabilityFilter])

  useEffect(() => { setPage(1) }, [search, sectorFilter, availabilityFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function scan(candidateId: string) {
    setRowError('')
    setScanningId(candidateId)
    startTransition(async () => {
      const res = await scanCandidateCv(candidateId)
      if (res.error) {
        setRowError(res.error)
      } else {
        const refreshed = await getCvthequeCandidates()
        setCandidates(refreshed.candidates)
      }
      setScanningId(null)
    })
  }

  return (
    <div style={{
      minHeight: '100%',
      backgroundColor: 'var(--color-background)',
      backgroundImage: `linear-gradient(rgba(11,29,81,0.55), rgba(11,29,81,0.55)), url('/recruiter-bg.jpg')`,
      backgroundSize: 'cover',
      backgroundPosition: 'top center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
    }}>
      {/* Header — sticky through the search/filter row */}
      <div className="sticky top-0 z-20" style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 mb-1">
            <FolderSearch className="h-5 w-5" style={{ color: 'var(--color-accent, #B8860B)' }} />
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>CV Thèque</h1>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Recherchez les candidats de la base par compétence, ville ou nom
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex items-center gap-2 px-4 rounded-2xl"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', boxShadow: '0 4px 14px rgba(0,0,0,0.12)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: '#c4b5fd' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Nom, compétence, ville, mission…"
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'white', width: '100%', padding: '0.8rem 0', fontSize: '0.9rem' }} />
            </div>
            <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
              className="px-4 rounded-2xl text-sm"
              style={{ background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.4)', color: 'white', minWidth: 180 }}>
              <option value="" style={{ color: '#111' }}>Tous secteurs</option>
              {SECTORS.map(s => <option key={s} value={s} style={{ color: '#111' }}>{s}</option>)}
            </select>
            <div className="flex items-center gap-1.5 p-1 rounded-2xl" style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)' }}>
              {([
                { value: 'all', label: 'Tous', color: '#c4b5fd' },
                { value: 'available', label: 'Disponible', color: '#34d399' },
                { value: 'unavailable', label: 'Non disponible', color: '#9ca3af' },
              ] as const).map(opt => (
                <button key={opt.value} type="button" onClick={() => setAvailabilityFilter(opt.value)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  style={availabilityFilter === opt.value
                    ? { background: opt.color, color: opt.value === 'all' ? '#0B1D51' : 'white' }
                    : { background: 'transparent', color: 'rgba(255,255,255,0.6)' }}>
                  {opt.value !== 'all' && <span className="w-1.5 h-1.5 rounded-full" style={{ background: availabilityFilter === opt.value ? 'currentColor' : opt.color }} />}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Candidats" value={stats.total} color="#2563eb" />
          <StatCard icon={FileText} label="Avec un CV" value={stats.withCv} color="var(--color-primary)" />
          <StatCard icon={Sparkles} label="Profils scannés" value={stats.scanned} color="#10b981" />
          <StatCard icon={FolderSearch} label="Résultats" value={filtered.length} color="#7c3aed" />
        </div>

        {loadError && (
          <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
            <p className="text-sm" style={{ color: '#ef4444' }}>{loadError}</p>
          </div>
        )}
        {rowError && (
          <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
            <p className="text-sm" style={{ color: '#ef4444' }}>{rowError}</p>
          </div>
        )}

        {/* Candidate cards */}
        {filtered.length === 0 ? (
          <div className="rounded-3xl py-20 text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.14)' }}>
            <Users className="h-10 w-10 mx-auto mb-3 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
            <p style={{ color: 'var(--color-text-muted)' }}>Aucun candidat ne correspond à cette recherche</p>
          </div>
        ) : (
          <>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} sur {filtered.length} candidat{filtered.length > 1 ? 's' : ''}
            </p>
            <div className="space-y-4">
              {paged.map(c => (
                <CandidateCard key={c.$id} candidate={c} scanning={scanningId === c.$id} onScan={() => scan(c.$id)} />
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} accentColor="#7c3aed" />
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="p-4 rounded-2xl transition-transform duration-300 hover:-translate-y-0.5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  )
}

function CandidateCard({ candidate: c, scanning, onScan }: { candidate: CvThequeCandidate; scanning: boolean; onScan: () => void }) {
  return (
    <div className="rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)' }}>
      <div className="flex items-start gap-4 flex-wrap">
        <CandidateAvatar photoUrl={c.photoUrl} initials={(c.name || c.email)[0]?.toUpperCase() ?? '?'} size={56} openToWork={c.openToWork} bgColor="var(--color-surface)" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>{c.name || '—'}</p>
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: c.openToWork ? 'rgba(16,185,129,0.12)' : 'rgba(107,114,128,0.12)', color: c.openToWork ? '#10b981' : '#6b7280' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.openToWork ? '#10b981' : '#6b7280' }} />
              {c.openToWork ? 'En recherche' : 'Non disponible'}
            </span>
          </div>
          {c.desiredRoles.length > 0 && (
            <p className="text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-primary)' }}>
              <Briefcase className="h-3.5 w-3.5 shrink-0" />{c.desiredRoles.join(' · ')}
            </p>
          )}

          <div className="flex items-center gap-4 flex-wrap text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {c.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>}
            {c.mobilityRadiusKm != null && <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />{c.mobilityRadiusKm} km</span>}
            {c.desiredSector.length > 0 && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{c.desiredSector.join(', ')}</span>}
          </div>

          {c.experienceSummary && (
            <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>{c.experienceSummary}</p>
          )}

          {c.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {c.skills.slice(0, 10).map(s => (
                <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'rgba(184,134,11,0.1)', color: 'var(--color-primary)' }}>
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>Profil non scanné</p>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
          {c.cvFileId && (
            <a href={`/api/cv/${c.cvFileId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold no-underline transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 20px rgba(11,29,81,0.25)' }}>
              <ExternalLink className="h-3.5 w-3.5" /> Voir le CV
            </a>
          )}
          {c.cvFileId && (
            <button onClick={onScan} disabled={scanning}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)', cursor: scanning ? 'default' : 'pointer' }}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
              {c.skills.length > 0 ? 'Rescanner' : 'Scanner'}
            </button>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.15)' }}>
              <Mail className="h-3.5 w-3.5" /> Contacter
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold no-underline transition-opacity hover:opacity-80"
              style={{ background: 'rgba(16,185,129,0.08)', color: '#10b981', border: '1px solid rgba(16,185,129,0.15)' }}>
              <Phone className="h-3.5 w-3.5" /> {c.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
