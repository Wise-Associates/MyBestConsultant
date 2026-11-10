'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CheckCircle2, ChevronRight, FolderOpen, Send, Timer, X } from 'lucide-react'
import { proposalStatus } from '@/lib/hunter-match'
import { parseProposalFilter, proposalCounts, proposalsShown, type ProposalFilter } from '@/lib/hunter-dashboard'

/** Proposition telle que la liste l'affiche (date déjà écrite par le serveur : même texte au rendu et dans le navigateur). */
export interface DashboardProposal {
  applicationId: string
  profileName: string
  jobTitle: string
  company: string
  status: string
  dateLabel: string
}

const FILTER_CARDS: { filter: ProposalFilter; label: string; icon: typeof Send }[] = [
  { filter: 'toutes', label: 'Propositions envoyées', icon: Send },
  { filter: 'en-cours', label: 'En cours de traitement', icon: Timer },
  { filter: 'retenus', label: 'Profils retenus', icon: CheckCircle2 },
]

const LIST_TITLE: Record<ProposalFilter, string> = {
  toutes: 'Toutes vos propositions', 'en-cours': 'Propositions en cours de traitement', retenus: 'Profils retenus',
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2'
const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }

/** Filtre écrit dans l'adresse sans nouvelle entrée d'historique ni nouveau rendu serveur (comme « Mes offres »). */
function writeFilter(filter: ProposalFilter | null) {
  const url = new URL(window.location.href)
  if (filter) url.searchParams.set('propositions', filter)
  else url.searchParams.delete('propositions')
  window.history.replaceState(window.history.state, '', url)
}

/**
 * Tableau de bord du chasseur : cartes de chiffres, offres suggérées, propositions, colonne de droite. Les cartes
 * filtrent la liste des propositions (demande du 2026-11-10), « Profils dans mon vivier » mène au vivier. Grand écran
 * (1440 px et plus) : trois colonnes, filtres dans le rail de gauche qui reste visible au défilement ; en dessous,
 * filtres en ligne au-dessus du contenu. `suggestions`, `welcome` et `aside` sont rendus par le serveur ; `welcome`
 * (vivier vide) remplace les offres et les propositions, qui seraient vides. Une seule couleur d'accent, celle du thème
 * (revue du 2026-11-10 : « trop de couleurs », AGENTS.md) ; couleurs seulement pour le statut des propositions.
 */
export function DashboardBoard({ vivierCount, proposals, initialFilter, suggestions, welcome, aside }: {
  vivierCount: number
  proposals: DashboardProposal[]
  initialFilter: string | null
  suggestions: React.ReactNode
  welcome: React.ReactNode | null
  aside: React.ReactNode
}) {
  const [filter, setFilter] = useState<ProposalFilter | null>(() => parseProposalFilter(initialFilter))
  const counts = proposalCounts(proposals)
  const shown = proposalsShown(proposals, filter)

  const toggle = (next: ProposalFilter) => {
    const value = filter === next ? null : next
    setFilter(value)
    writeFilter(value)
  }

  return (
    <div className="min-[90rem]:grid min-[90rem]:grid-cols-[240px_minmax(0,1fr)_360px] min-[90rem]:gap-6 min-[90rem]:items-start">
      <div className="mb-6 min-[90rem]:mb-0 min-[90rem]:sticky min-[90rem]:top-[84px]">
        <div className="flex justify-end mb-4">
          <Link href="/hunter/vivier" className={`inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl text-sm font-semibold no-underline transition-opacity hover:opacity-80 min-[90rem]:w-full ${focusRing}`}
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
            <FolderOpen className="h-4 w-4" aria-hidden />Ajouter des CV
          </Link>
        </div>
        {/* Filtres de la liste des propositions : lignes compactes, le chiffre à droite (comme les filtres des rails de
            l'espace recruteur) ; « Profils dans mon vivier » ne filtre rien, il mène au vivier. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 min-[90rem]:grid-cols-1 gap-2">
          <Link href="/hunter/vivier" className={`${filterRow} no-underline hover:bg-[var(--color-background)] ${focusRing}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <FilterLabel label="Profils dans mon vivier" icon={FolderOpen} />
            <span className="flex items-center gap-1"><Count value={vivierCount} /><ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--color-text-muted)' }} aria-hidden /></span>
          </Link>
          {FILTER_CARDS.map(c => {
            const active = filter === c.filter
            return (
              <button key={c.filter} type="button" onClick={() => toggle(c.filter)} aria-pressed={active}
                title={active ? 'Retirer le filtre' : `Afficher : ${c.label.toLowerCase()}`}
                className={`${filterRow} cursor-pointer text-left ${active ? '' : 'hover:bg-[var(--color-background)]'} ${focusRing}`}
                style={{ background: active ? 'var(--color-background)' : 'var(--color-surface)', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}` }}>
                <FilterLabel label={c.label} icon={c.icon} active={active} />
                <Count value={counts[c.filter]} />
              </button>
            )
          })}
        </div>
      </div>

      {/* 1024 à 1440 px : offres et propositions à gauche, colonne de droite ; à partir de 1440 px, ces deux colonnes
          rejoignent la grille à trois colonnes (contents). */}
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start min-[90rem]:contents">
        <div className="space-y-6 min-w-0">
          {welcome ?? <>
            {suggestions}

            <section className="rounded-3xl overflow-hidden" style={card} aria-labelledby="hunter-proposals-title">
              <div className="px-5 sm:px-6 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <h2 id="hunter-proposals-title" aria-live="polite" className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>
                  {filter ? LIST_TITLE[filter] : 'Dernières propositions'}
                </h2>
                <div className="flex items-center gap-3">
                  {filter && (
                    <button type="button" onClick={() => { setFilter(null); writeFilter(null) }}
                      className={`inline-flex items-center gap-1 text-xs font-semibold cursor-pointer rounded ${focusRing}`} style={{ color: 'var(--color-text-muted)' }}>
                      <X className="h-3.5 w-3.5" aria-hidden />Retirer le filtre
                    </button>
                  )}
                  <Link href="/hunter/propositions" className="text-xs font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Tout voir →</Link>
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="px-6 py-10 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
                  {proposals.length === 0
                    ? <>Vous n’avez encore proposé aucun profil. <Link href="/hunter/offres" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Parcourir les offres</Link></>
                    : 'Aucune proposition pour ce filtre.'}
                </p>
              ) : (
                <ul>
                  {shown.map(p => {
                    const st = proposalStatus(p.status)
                    return (
                      <li key={p.applicationId} className="px-5 sm:px-6 py-3.5 flex items-center gap-3 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.profileName} <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>→ {p.jobTitle}</span></p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{p.company || 'Entreprise'} · {p.dateLabel}</p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${st.color}1f`, color: st.color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />{st.label}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>}
        </div>

        {aside}
      </div>
    </div>
  )
}

const filterRow = 'flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 min-h-11 transition-colors'

function FilterLabel({ label, icon: Icon, active = false }: { label: string; icon: typeof Send; active?: boolean }) {
  return (
    <span className="flex items-center gap-2 min-w-0 text-[13px]" style={{ color: 'var(--color-text)', fontWeight: active ? 600 : 500 }}>
      <Icon className="h-4 w-4 shrink-0" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-muted)' }} aria-hidden />
      <span className="leading-tight">{label}</span>
    </span>
  )
}

function Count({ value }: { value: number }) {
  return <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{value}</span>
}
