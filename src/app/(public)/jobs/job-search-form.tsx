'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Search } from 'lucide-react'
import { KeywordQueryBuilder, emptyKeywordRows, type KeywordRow } from '@/components/shared/keyword-query-builder'
import { RangeSlider } from '@/components/shared/range-slider'
import { field, fieldStyle, listCardStyle, muted, railCard, railHeading, railHeadingStyle } from '@/components/shared/list-styles'
import { CONTRACT_TYPES, REMOTE_MODES } from '@/lib/job-listing'
import { SENIORITY_MAX } from '@/lib/job-seniority'
import { CONTRACT_LABELS, REMOTE_LABELS } from './labels'

// Critères de la liste publique des offres (/jobs), avec la charte du rail de filtres du tableau de bord recruteur
// (list-styles.ts). Formulaire GET : chaque critère dans l'adresse. Les nombres à côté des contrats et du télétravail
// sont ceux qu'afficherait ce choix (jobFacets, job-listing.ts).

function RailTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 id={id} className={railHeading} style={railHeadingStyle}>{children}</h3>
      {aside}
    </div>
  )
}

/** Choix unique en liste, comme « Statut » du tableau de bord : libellé à gauche, nombre d'offres à droite. */
function Choices({ name, labelledBy, options, counts, total, value, onChange }: {
  name: string
  labelledBy: string
  options: readonly string[]
  counts: Record<string, number>
  /** Nombre de « Tous » (offres sans contrat ou télétravail renseigné comprises). */
  total: number
  value: string
  onChange: (v: string) => void
}) {
  const labels = name === 'contract' ? CONTRACT_LABELS : REMOTE_LABELS
  const all = [{ value: '', label: 'Tous', n: total }, ...options.map(o => ({ value: o, label: labels[o], n: counts[o] ?? 0 }))]
  return (
    <div role="radiogroup" aria-labelledby={labelledBy}>
      <input type="hidden" name={name} value={value} />
      {all.map(opt => {
        const on = value === opt.value
        return (
          <button key={opt.value || 'all'} type="button" role="radio" aria-checked={on} onClick={() => onChange(opt.value)}
            className="w-full h-11 sm:h-8 px-2.5 rounded-lg border-0 flex items-center justify-between text-[13px] cursor-pointer focus-visible:outline-2 focus-visible:outline-(--color-text)"
            style={{
              background: on ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'transparent',
              color: 'var(--color-text)', fontWeight: on ? 600 : 500,
            }}>
            {opt.label} <span className="text-xs tabular-nums" style={muted}>{opt.n}</span>
          </button>
        )
      })}
    </div>
  )
}

const seniorityLabel = (v: number) => v >= SENIORITY_MAX ? `${SENIORITY_MAX} ans et +` : `${v} an${v > 1 ? 's' : ''}`

export function JobSearchForm({
  initialKeywords, initialExclude, initialLocation, initialContract, initialRemote, initialSeniority, contractCounts, remoteCounts, contractTotal, remoteTotal,
  hasActiveFilters,
}: {
  initialKeywords: KeywordRow[]
  initialExclude: KeywordRow[]
  initialLocation: string
  initialContract: string
  initialRemote: string
  initialSeniority: [number, number]
  contractCounts: Record<string, number>
  remoteCounts: Record<string, number>
  contractTotal: number
  remoteTotal: number
  /** Un critère est appliqué : « Effacer tous les filtres » est proposé. */
  hasActiveFilters: boolean
}) {
  const [keywords, setKeywords] = useState<KeywordRow[]>(initialKeywords.length ? initialKeywords : emptyKeywordRows())
  const [exclude, setExclude] = useState<KeywordRow[]>(initialExclude.length ? initialExclude : emptyKeywordRows())
  const [contract, setContract] = useState(initialContract)
  const [remote, setRemote] = useState(initialRemote)
  const [seniority, setSeniority] = useState<[number, number]>(initialSeniority)
  const allSeniority = seniority[0] === 0 && seniority[1] >= SENIORITY_MAX

  return (
    <form method="GET" aria-labelledby="search-title" className="flex flex-col gap-3.5">
      {/* Taille écrite ici : la règle globale des titres (globals.css, modèle du site) l'emporte sur les classes. */}
      <h2 id="search-title" style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.4 }}>
        Mes critères de recherche
      </h2>

      <div className={`${railCard} flex flex-col gap-4`} style={listCardStyle}>
        <section aria-labelledby="f-keywords">
          <RailTitle id="f-keywords">Postes, compétences, mots-clés</RailTitle>
          <KeywordQueryBuilder rows={keywords} onChange={setKeywords} label="Postes, compétences ou mots-clés"
            placeholder="ex. : AMOA, Java, Lyon…" addLabel="Ajouter un mot-clé" formNames={{ term: 'kw', op: 'kwOp' }} />
        </section>

        <section aria-labelledby="f-exclude">
          <RailTitle id="f-exclude">Exclure les offres contenant</RailTitle>
          <KeywordQueryBuilder rows={exclude} onChange={setExclude} label="Mots à exclure"
            placeholder="ex. : stage, alternance…" addLabel="Ajouter une exclusion" formNames={{ term: 'exclude', op: 'excludeOp' }} />
        </section>

        <section aria-labelledby="f-location">
          <RailTitle id="f-location">Localisation</RailTitle>
          <div className={`${field} flex items-center gap-2`} style={fieldStyle}>
            <MapPin className="h-4 w-4 shrink-0" style={muted} aria-hidden />
            <input name="location" defaultValue={initialLocation} aria-labelledby="f-location"
              placeholder="Ville, département, région"
              className="mbc-search-input w-full h-full text-[13px] outline-none bg-transparent border-0"
              style={{ color: 'var(--color-text)' }} />
          </div>
        </section>

        <section aria-labelledby="f-seniority">
          <RailTitle id="f-seniority" aside={
            <span className="text-xs" style={muted}>{allSeniority ? 'Toutes' : `${seniorityLabel(seniority[0])} – ${seniorityLabel(seniority[1])}`}</span>
          }>
            Séniorité
          </RailTitle>
          <input type="hidden" name="senMin" value={seniority[0]} />
          <input type="hidden" name="senMax" value={seniority[1]} />
          <RangeSlider min={0} max={SENIORITY_MAX} step={1} value={seniority} onChange={setSeniority} formatLabel={seniorityLabel} />
        </section>
      </div>

      <div className={`${railCard} flex flex-col gap-3`} style={listCardStyle}>
        <div>
          <RailTitle id="f-contract">Type de contrat</RailTitle>
          <Choices name="contract" labelledBy="f-contract" options={CONTRACT_TYPES} counts={contractCounts} total={contractTotal} value={contract} onChange={setContract} />
        </div>
        <div>
          <RailTitle id="f-remote">Télétravail</RailTitle>
          <Choices name="remote" labelledBy="f-remote" options={REMOTE_MODES} counts={remoteCounts} total={remoteTotal} value={remote} onChange={setRemote} />
        </div>
      </div>

      {/* Toujours visibles (demande du 2026-11-13) : collés en bas de la colonne des critères sur grand écran (elle
          défile seule), en bas de l'écran sur mobile tant que les critères sont affichés. */}
      <div className={`${railCard} sticky bottom-0 z-10 flex flex-col gap-1`}
        style={{ ...listCardStyle, boxShadow: '0 -10px 24px -12px rgba(0,0,0,0.18)', paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}>
        {/* Bouton principal du tableau de bord (« Créer une offre ») : couleurs du thème. */}
        <button type="submit"
          className="mbc-search-submit w-full h-11 sm:h-10 px-5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-(--color-primary)"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', border: '1px solid var(--color-primary)' }}>
          Rechercher les offres <Search className="mbc-search-submit-icon h-4 w-4" aria-hidden />
        </button>
        {hasActiveFilters && (
          <Link href="/jobs" className="flex items-center justify-center h-11 sm:h-9 text-[13px] font-semibold no-underline hover:underline" style={{ color: 'var(--color-primary)' }}>
            Effacer tous les filtres
          </Link>
        )}
      </div>
    </form>
  )
}
