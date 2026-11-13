'use client'

import Link from 'next/link'
import { WhatsAppContact } from '@/components/recruiter/whatsapp-contact'
import { useMemo, useState } from 'react'
import {
  Users, ExternalLink, AlertCircle, Mail, Phone, MapPin, Navigation, Building2, FolderSearch, Maximize2, FileDown, Search, Info,
  SlidersHorizontal, ArrowRight,
} from 'lucide-react'
import { deleteRecruiterCvTemplate, getRecruiterCvExportVersions, saveRecruiterCvTemplate, type CvThequeCandidate } from './actions'
import { EsnExportDialog } from '@/components/cv-export/esn-export-dialog'
import { CvTemplateManager } from '@/components/cv-export/cv-template-manager'
import type { CvExportAccess } from '@/lib/cv-export/recruiter'
import { SECTORS } from '@/lib/candidate-taxonomy'
import { Pagination } from '@/components/shared/pagination'
import { CandidateAvatar } from '@/components/shared/candidate-avatar'
import { EMPTY_FILTERS, activeFilterCount, filterCandidates, valuesByFrequency, type CvthequeFilters } from '@/lib/cvtheque-search'
import { CvthequeFiltersPanel } from './cvtheque-filters'
import { CandidateProfileModal } from './candidate-profile-modal'

// CV Thèque du recruteur (refonte du 2026-11-13, à la manière des outils de recherche de profils) : plus de bandeau,
// une ligne de titre (« Modèle CV » à droite), la barre de recherche, puis les filtres dans une colonne à gauche
// (cvtheque-filters.tsx) et les profils à droite. Mobile : la barre, puis les filtres repliés derrière « Filtres », puis
// les profils. Règles de recherche pures : src/lib/cvtheque-search.ts.

const PAGE_SIZE = 50

const SEARCH_HELP = 'Tous les mots sont requis ; OR entre deux mots pour l\'un ou l\'autre ; guillemets pour une expression : java "react native" OR kotlin'

export function CvthequeClient({ initialCandidates, loadError, cvExport, cvExportError }: {
  initialCandidates: CvThequeCandidate[]
  loadError?: string
  cvExport: CvExportAccess | null
  cvExportError?: string
}) {
  const [exportFor, setExportFor] = useState<CvThequeCandidate | null>(null)
  const [filters, setFilters] = useState<CvthequeFilters>(EMPTY_FILTERS)
  // Texte de la barre : appliqué par Entrée ou « Rechercher », pour que la liste ne saute pas pendant la frappe d'une
  // expression entre guillemets.
  const [draft, setDraft] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [openProfile, setOpenProfile] = useState<CvThequeCandidate | null>(null)
  // « Ajouté depuis » se mesure à l'ouverture de la page.
  const [openedAt] = useState(() => new Date())
  const filterKey = JSON.stringify(filters)
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const options = useMemo(() => ({
    skills: valuesByFrequency(initialCandidates.map(c => c.skills)),
    sectors: valuesByFrequency([[...SECTORS], ...initialCandidates.map(c => c.desiredSector)]),
    languages: valuesByFrequency(initialCandidates.map(c => c.languages.map(l => l.name))),
  }), [initialCandidates])

  const filtered = useMemo(() => filterCandidates(initialCandidates, filters, openedAt), [initialCandidates, filters, openedAt])
  const available = filtered.filter(c => c.openToWork).length
  const activeCount = activeFilterCount(filters)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const narrowed = activeCount > 0 || filters.query.trim() !== ''

  return (
    <div className="min-h-[calc(100vh-68px)]" style={{ background: 'var(--color-surface)' }}>
      <header className="flex items-center gap-3 flex-wrap min-h-16 px-4 sm:px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <FolderSearch className="h-5 w-5 shrink-0" style={{ color: 'var(--color-brand-orange)' }} aria-hidden />
        {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
        <h1 style={{ color: 'var(--color-text)', fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 }}>CV Thèque</h1>
        <span className="flex-1" />
        {cvExport && (
          <CvTemplateManager kind="organisation" template={cvExport.template} storage uploadDenied={cvExport.uploadDenied}
            save={saveRecruiterCvTemplate} remove={deleteRecruiterCvTemplate} />
        )}
      </header>

      {/* Grille dès 1024 px : filtres à gauche sur toute la hauteur, barre puis profils à droite. L'ordre du code est celui
          du mobile (barre, filtres, profils). Deuxième ligne en 1fr : la hauteur de la colonne des filtres s'ajoute sous
          les profils, pas entre la barre et les profils quand il y en a peu. */}
      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="lg:col-start-2 lg:row-start-1">
          <form className="flex items-center gap-2 px-4 sm:px-6 py-4" role="search" aria-label="Rechercher dans la CV Thèque"
            onSubmit={e => { e.preventDefault(); setFilters(f => ({ ...f, query: draft })) }}>
            <div className="flex-1 min-w-0 flex items-center gap-2 h-11 pl-3 pr-1.5 rounded-xl transition-colors focus-within:border-[var(--color-brand-orange)]"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
              <label htmlFor="cvt-query" className="sr-only">Recherche</label>
              <input id="cvt-query" value={draft} onChange={e => setDraft(e.target.value)} maxLength={300}
                placeholder={'Rechercher : Java, "chef de projet", Lyon…'}
                className="flex-1 min-w-0 bg-transparent text-sm outline-none" style={{ color: 'var(--color-text)' }} />
              <button type="submit" className="h-8 px-3 rounded-lg text-xs font-semibold shrink-0"
                style={{ background: 'var(--color-background)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                Rechercher
              </button>
            </div>
            <span className="hidden sm:inline-flex shrink-0" title={SEARCH_HELP} style={{ color: 'var(--color-text-muted)' }}>
              <Info className="h-4 w-4" aria-hidden />
              <span className="sr-only">{SEARCH_HELP}</span>
            </span>
            <button type="button" onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-controls="cvt-filters"
              className="lg:hidden inline-flex items-center gap-1.5 h-11 px-3 rounded-xl text-sm font-semibold shrink-0"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Filtres{activeCount > 0 ? ` · ${activeCount}` : ''}
            </button>
          </form>
          <p className="flex items-center gap-x-3 gap-y-1 flex-wrap px-4 sm:px-6 py-3 text-sm"
            style={{ background: 'color-mix(in srgb, var(--color-brand-orange) 7%, transparent)', color: 'var(--color-text)' }}>
            Vous ne trouvez pas le bon profil ?
            <Link href="/recruiter/mbc-search" className="inline-flex items-center gap-1 font-semibold no-underline hover:underline"
              style={{ color: 'var(--color-brand-orange)' }}>
              Cherchez hors de votre base avec MBC Search <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </p>
        </div>

        <aside id="cvt-filters" aria-label="Filtres de la CV Thèque"
          className={`${filtersOpen ? 'block' : 'hidden'} lg:block lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:self-start lg:sticky lg:top-[68px] lg:h-[calc(100vh-68px)] lg:overflow-y-auto px-4 sm:px-6 lg:px-5 py-5`}
          style={{ borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
          <CvthequeFiltersPanel filters={filters} onChange={setFilters} activeCount={activeCount} options={options} />
        </aside>

        <main className="lg:col-start-2 lg:row-start-2 min-w-0 px-4 sm:px-6 py-5 space-y-4">
          {loadError && (
            <div role="alert" className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#b91c1c' }} />
              <p className="text-sm" style={{ color: '#b91c1c' }}>{loadError}</p>
            </div>
          )}
          {cvExportError && (
            <div role="status" className="flex items-center gap-3 p-4 rounded-2xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#b45309' }} />
              <p className="text-sm" style={{ color: '#b45309' }}>{cvExportError}</p>
            </div>
          )}

          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }} aria-live="polite">
            <strong style={{ color: 'var(--color-text)' }}>{filtered.length} profil{filtered.length > 1 ? 's' : ''}</strong>
            {' '}· dont {available} disponible{available > 1 ? 's' : ''}
            {narrowed && <> · sur {initialCandidates.length} avec CV</>}
            {filtered.length > PAGE_SIZE && <> · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} affichés</>}
          </p>

          {filtered.length === 0 ? (
            <div className="rounded-2xl py-16 px-6 text-center space-y-3" style={{ border: '1px solid var(--color-border)' }}>
              <Users className="h-9 w-9 mx-auto opacity-30" style={{ color: 'var(--color-text-muted)' }} aria-hidden />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {initialCandidates.length === 0 ? 'Aucun profil avec CV dans la CV Thèque pour le moment.' : 'Aucun profil ne correspond à cette recherche.'}
              </p>
              {narrowed && (
                <button type="button" onClick={() => { setDraft(''); setFilters(EMPTY_FILTERS) }}
                  className="text-sm font-semibold" style={{ color: 'var(--color-brand-orange)' }}>
                  Effacer la recherche et les filtres
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {paged.map(c => (
                  <CandidateCard key={c.$id} candidate={c} onOpenProfile={() => setOpenProfile(c)}
                    onExport={cvExport?.template && c.cvFileId ? () => setExportFor(c) : undefined} />
                ))}
              </div>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} accentColor="var(--color-primary)" />
            </>
          )}
        </main>
      </div>

      {openProfile && <CandidateProfileModal candidate={openProfile} onClose={() => setOpenProfile(null)} />}

      {cvExport?.template && (
        // key : choix et compte rendu remis à zéro pour chaque candidat
        <EsnExportDialog key={exportFor?.$id ?? 'none'} candidate={exportFor && { id: exportFor.$id, name: exportFor.name }}
          onClose={() => setExportFor(null)} endpoint="/api/recruiter/cv-export" loadVersions={getRecruiterCvExportVersions}
          esn={cvExport.template.esn} generationDenied={cvExport.generationDenied} quotaLimited />
      )}
    </div>
  )
}

function CandidateCard({ candidate: c, onOpenProfile, onExport }: { candidate: CvThequeCandidate; onOpenProfile: () => void; onExport?: () => void }) {
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
          {onExport && (
            <button type="button" onClick={onExport}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-opacity hover:opacity-90"
              style={{
                background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-primary) 25%, transparent)',
              }}>
              <FileDown className="h-3.5 w-3.5" /> CV format cabinet
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
          {c.whatsapp && <WhatsAppContact name={c.name} number={c.whatsapp} />}
        </div>
      </div>
    </div>
  )
}
