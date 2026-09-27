'use client'

import { WhatsAppContact } from '@/components/recruiter/whatsapp-contact'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Users, Sparkles, ExternalLink, AlertCircle, Mail, Phone,
  MapPin, Navigation, Building2, FolderSearch, ArrowLeft, Maximize2,
} from 'lucide-react'
import type { CvThequeCandidate } from './actions'
import { SECTORS } from '@/lib/candidate-taxonomy'
import { Pagination } from '@/components/shared/pagination'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { RangeSlider } from '@/components/shared/range-slider'
import { expandLocationSearch, normalizeLocation } from '@/lib/regions'
import { KeywordQueryBuilder, matchesKeywordRows, isExcludedByKeywordRows, emptyKeywordRows, type KeywordRow } from '@/components/shared/keyword-query-builder'
import { CandidateProfileModal } from './candidate-profile-modal'

const PAGE_SIZE = 50
const RECENT_COUNT = 20
const RADIUS_MAX = 100
const SENIORITY_MAX = 15

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="mbc-search-pill flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap"
      style={active
        ? { background: 'var(--navbar-bg)', color: 'white', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }
        : { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
      {children}
    </button>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--color-text)' }}>
      {children}
    </label>
  )
}

export function CvthequeClient({ initialCandidates, loadError }: { initialCandidates: CvThequeCandidate[]; loadError?: string }) {
  const [includeRows, setIncludeRows] = useState<KeywordRow[]>(emptyKeywordRows())
  const [excludeRows, setExcludeRows] = useState<KeywordRow[]>(emptyKeywordRows())
  const [radiusRange, setRadiusRange] = useState<[number, number]>([0, RADIUS_MAX])
  const [seniorityRange, setSeniorityRange] = useState<[number, number]>([0, SENIORITY_MAX])
  const [locationFilter, setLocationFilter] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all')
  const [recentOnly, setRecentOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [openProfile, setOpenProfile] = useState<CvThequeCandidate | null>(null)
  const filterKey = JSON.stringify([includeRows, excludeRows, radiusRange, seniorityRange, locationFilter, sectorFilter, availabilityFilter, recentOnly])
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const stats = useMemo(() => ({
    total: initialCandidates.length,
    available: initialCandidates.filter(c => c.openToWork).length,
  }), [initialCandidates])

  const recentIds = useMemo(() => {
    return new Set(
      [...initialCandidates]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, RECENT_COUNT)
        .map(c => c.$id)
    )
  }, [initialCandidates])

  const filtered = useMemo(() => {
    const locationCandidates = locationFilter.trim() ? expandLocationSearch(locationFilter) : null
    return initialCandidates.filter(c => {
      if (sectorFilter && !c.desiredSector.includes(sectorFilter)) return false
      if (availabilityFilter === 'available' && !c.openToWork) return false
      if (availabilityFilter === 'unavailable' && c.openToWork) return false
      if (recentOnly && !recentIds.has(c.$id)) return false
      if (c.mobilityRadiusKm != null && (c.mobilityRadiusKm < radiusRange[0] || c.mobilityRadiusKm > radiusRange[1])) return false
      if (c.yearsOfExperience != null && (c.yearsOfExperience < seniorityRange[0] || (seniorityRange[1] < SENIORITY_MAX && c.yearsOfExperience > seniorityRange[1]))) return false
      if (locationCandidates) {
        const loc = normalizeLocation(c.city)
        if (!locationCandidates.some(lc => loc.includes(lc) || lc.includes(loc))) return false
      }
      // Le haystack doit couvrir tout ce qu'un mot-clé peut raisonnablement viser — pas
      // seulement les compétences/secteur, mais aussi le contenu réel du CV (expériences,
      // missions, formation, langues) et la localisation étendue par pays (chercher/exclure
      // "Tunisie" doit aussi trouver un candidat dont la ville est juste "Sousse").
      const locationTerms = expandLocationSearch(c.city).join(' ')
      const experienceText = c.experiences.map(e => `${e.title} ${e.company} ${e.missions.join(' ')}`).join(' ')
      const educationText = c.education.map(e => `${e.degree} ${e.school}`).join(' ')
      const languageText = c.languages.map(l => l.name).join(' ')
      const haystack = `${c.name} ${c.city} ${locationTerms} ${c.skills.join(' ')} ${c.desiredSector.join(' ')} ${c.desiredRoles.join(' ')} ${c.experienceSummary} ${experienceText} ${educationText} ${languageText}`
      if (isExcludedByKeywordRows(haystack, excludeRows)) return false
      return matchesKeywordRows(haystack, includeRows)
    })
  }, [initialCandidates, includeRows, excludeRows, radiusRange, seniorityRange, locationFilter, sectorFilter, availabilityFilter, recentOnly, recentIds])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="relative" style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
            {/* Header */}
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 30px rgba(0,0,0,0.15)' }}>
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Link href="/recruiter/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80"
            style={{ color: 'rgba(255,255,255,0.6)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <FolderSearch className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>CV Thèque</h1>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
            Recherchez des profils par compétence, secteur ou mission recherchée
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col lg:flex-row gap-8 items-start">
        {/* ── Mes critères de recherche — fixe au scroll côté desktop ── */}
        <aside className="mbc-sticky-aside w-full lg:w-96 shrink-0 lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto space-y-4">
          <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            Mes critères de recherche
          </h2>

          <div className="mbc-search-panel rounded-3xl p-6 sm:p-8 space-y-7" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.35)' }}>
            <div>
              <FieldLabel>Nom / Compétences / Mots-clés</FieldLabel>
              <KeywordQueryBuilder rows={includeRows} onChange={setIncludeRows}
                placeholder="ex : React, Lyon, Lead Dev…" addLabel="Ajouter un mot-clé" />
            </div>

            <div>
              <FieldLabel>Exclure les profils contenant les mots</FieldLabel>
              <KeywordQueryBuilder rows={excludeRows} onChange={setExcludeRows}
                placeholder="ex : Junior, Stage…" addLabel="Ajouter une exclusion" />
            </div>

            <div>
              <FieldLabel>Rayon de mobilité</FieldLabel>
              <RangeSlider min={0} max={RADIUS_MAX} step={5} value={radiusRange} onChange={setRadiusRange}
                formatLabel={v => v >= RADIUS_MAX ? `${RADIUS_MAX}+ km` : `${v} km`} />
            </div>

            <div>
              <FieldLabel>Séniorité (années d&apos;expérience)</FieldLabel>
              <RangeSlider min={0} max={SENIORITY_MAX} step={1} value={seniorityRange} onChange={setSeniorityRange}
                formatLabel={v => v >= SENIORITY_MAX ? `${SENIORITY_MAX}+ ans` : `${v} an${v > 1 ? 's' : ''}`} />
            </div>

            <div>
              <FieldLabel>Localisation</FieldLabel>
              <div className="flex items-center gap-2 px-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <MapPin className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <input value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
                  placeholder="Ville, région…"
                  className="mbc-search-input w-full py-2.5 text-sm outline-none bg-transparent border-0"
                  style={{ color: 'var(--color-text)' }} />
              </div>
            </div>

            <div>
              <FieldLabel>Secteur</FieldLabel>
              <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
                className="mbc-search-input w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Tous secteurs</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <FieldLabel>Disponibilité</FieldLabel>
              <div className="flex items-center gap-2.5 flex-wrap">
                <Pill active={availabilityFilter === 'all'} onClick={() => setAvailabilityFilter('all')}>Tous les profils</Pill>
                <Pill active={availabilityFilter === 'available'} onClick={() => setAvailabilityFilter('available')}>Actuellement disponible</Pill>
                <Pill active={availabilityFilter === 'unavailable'} onClick={() => setAvailabilityFilter('unavailable')}>Non disponible</Pill>
              </div>
            </div>

            <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
              <label className="flex items-center gap-3 pt-5 cursor-pointer select-none">
                <button type="button" role="switch" aria-checked={recentOnly} onClick={() => setRecentOnly(v => !v)}
                  className="relative w-10 h-6 rounded-full shrink-0 transition-colors"
                  style={{ background: recentOnly ? 'var(--navbar-bg)' : 'var(--color-border)' }}>
                  <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                    style={{ transform: recentOnly ? 'translateX(16px)' : 'translateX(0)' }} />
                </button>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Afficher uniquement les {RECENT_COUNT} profils les plus récents
                </span>
              </label>
            </div>

            <p className="text-xs pt-2" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
              <span key={filtered.length} className="mbc-count-pop font-bold" style={{ color: 'var(--color-primary)' }}>{filtered.length}</span> profil{filtered.length > 1 ? 's' : ''} correspond{filtered.length > 1 ? 'ent' : ''} à ces critères
            </p>
          </div>
        </aside>

        {/* ── Résultats — c'est cette colonne qui scrolle ── */}
        <main className="flex-1 min-w-0 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard icon={Users} label="Profils avec CV" value={stats.total} color="#2563eb" />
            <StatCard icon={Sparkles} label="Disponibles" value={stats.available} color="#10b981" />
            <StatCard icon={FolderSearch} label="Résultats" value={filtered.length} color="var(--color-primary)" />
          </div>

          {loadError && (
            <div className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
              <p className="text-sm" style={{ color: '#ef4444' }}>{loadError}</p>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-3xl py-20 text-center"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 20px 50px -12px rgba(11,29,81,0.14)' }}>
              <Users className="h-10 w-10 mx-auto mb-3 opacity-20" style={{ color: 'var(--color-text-muted)' }} />
              <p style={{ color: 'var(--color-text-muted)' }}>Aucun profil ne correspond à cette recherche</p>
            </div>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} sur {filtered.length} profil{filtered.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-4">
                {paged.map(c => <CandidateCard key={c.$id} candidate={c} onOpenProfile={() => setOpenProfile(c)} />)}
              </div>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} accentColor="var(--color-primary)" />
            </>
          )}
        </main>
      </div>

      {openProfile && <CandidateProfileModal candidate={openProfile} onClose={() => setOpenProfile(null)} />}

      <style>{`
        @keyframes mbc-float { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -20px) scale(1.08); } }
        @keyframes mbc-float-slow { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-24px, 24px) scale(1.05); } }
        .mbc-orb { animation: mbc-float 14s ease-in-out infinite; }
        .mbc-orb-slow { animation: mbc-float-slow 18s ease-in-out infinite; }
      `}</style>
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

function CandidateCard({ candidate: c, onOpenProfile }: { candidate: CvThequeCandidate; onOpenProfile: () => void }) {
  return (
    <div className="rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 10px 30px -10px rgba(11,29,81,0.14)',
      }}>
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
            <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--color-primary)' }}>{c.desiredRoles.join(' · ')}</p>
          )}

          <div className="flex items-center gap-4 flex-wrap text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {c.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>}
            {c.mobilityRadiusKm != null && <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />{c.mobilityRadiusKm} km</span>}
            {c.desiredSector.length > 0 && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{c.desiredSector.join(', ')}</span>}
          </div>

          {c.experienceSummary && (
            <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>{c.experienceSummary}</p>
          )}

          {c.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {c.skills.slice(0, 10).map(s => (
                <span key={s} className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={{ background: 'rgba(232,163,61,0.1)', color: 'var(--color-primary)' }}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
          <button onClick={onOpenProfile} type="button"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #E8A33D, #7c3aed)', color: 'white', boxShadow: '0 8px 20px -6px rgba(124,58,237,0.4)' }}>
            <Maximize2 className="h-3.5 w-3.5" /> Profil complet
          </button>
          {c.cvFileId && (
            <a href={`/api/cv/${c.cvFileId}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold no-underline transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 20px rgba(11,29,81,0.25)' }}>
              <ExternalLink className="h-3.5 w-3.5" /> Voir le CV
            </a>
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
          {c.whatsapp && <WhatsAppContact name={c.name} number={c.whatsapp} />}
        </div>
      </div>
    </div>
  )
}
