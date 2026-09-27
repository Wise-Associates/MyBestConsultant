'use client'

import { useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import { KeywordQueryBuilder, emptyKeywordRows, type KeywordRow } from '@/components/shared/keyword-query-builder'
import { RangeSlider } from '@/components/shared/range-slider'
import { SENIORITY_MAX } from '@/lib/job-seniority'

const CONTRACT_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'mission', label: 'Mission' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'cdi', label: 'CDI' },
  { value: 'cdd', label: 'CDD' },
]
const REMOTE_OPTIONS = [
  { value: '', label: 'Tous' },
  { value: 'remote', label: 'Full remote' },
  { value: 'hybrid', label: 'Hybride' },
  { value: 'onsite', label: 'Présentiel' },
]

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm font-bold mb-2 block" style={{ color: 'var(--color-text)' }}>
      {children}
    </label>
  )
}

function ToggleGroup({ name, options, value, onChange }: {
  name: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={value} />
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className="mbc-search-pill px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
          style={value === opt.value
            ? { background: 'var(--navbar-bg)', color: 'white', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' }
            : { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function JobSearchForm({
  initialKeywords, initialExclude, initialLocation, initialContract, initialRemote, initialSeniority,
}: {
  initialKeywords: KeywordRow[]
  initialExclude: KeywordRow[]
  initialLocation: string
  initialContract: string
  initialRemote: string
  initialSeniority: [number, number]
}) {
  const [keywords, setKeywords] = useState<KeywordRow[]>(initialKeywords.length ? initialKeywords : emptyKeywordRows())
  const [exclude, setExclude] = useState<KeywordRow[]>(initialExclude.length ? initialExclude : emptyKeywordRows())
  const [contract, setContract] = useState(initialContract)
  const [remote, setRemote] = useState(initialRemote)
  const [seniority, setSeniority] = useState<[number, number]>(initialSeniority)

  return (
    <form method="GET" className="mbc-search-panel rounded-3xl p-6 sm:p-8 space-y-7" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.35)' }}>
      <div>
        <FieldLabel>Postes / Compétences / Mots-clés</FieldLabel>
        <KeywordQueryBuilder rows={keywords} onChange={setKeywords}
          placeholder="ex : Développeur, React, Lyon…" addLabel="Ajouter un mot-clé"
          formNames={{ term: 'kw', op: 'kwOp' }} />
      </div>

      <div>
        <FieldLabel>Exclure les offres contenant les mots</FieldLabel>
        <KeywordQueryBuilder rows={exclude} onChange={setExclude}
          placeholder="ex : Stage, Alternance…" addLabel="Ajouter une exclusion"
          formNames={{ term: 'exclude', op: 'excludeOp' }} />
      </div>

      <div>
        <FieldLabel>Localisation</FieldLabel>
        <div className="flex items-center gap-2 px-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <MapPin className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
          <input name="location" defaultValue={initialLocation}
            placeholder="Ville, région…"
            className="mbc-search-input w-full py-2.5 text-sm outline-none bg-transparent border-0"
            style={{ color: 'var(--color-text)' }} />
        </div>
      </div>

      <div>
        <FieldLabel>Séniorité (années d&apos;expérience)</FieldLabel>
        <input type="hidden" name="senMin" value={seniority[0]} />
        <input type="hidden" name="senMax" value={seniority[1]} />
        <RangeSlider min={0} max={SENIORITY_MAX} step={1} value={seniority} onChange={setSeniority}
          formatLabel={v => v >= SENIORITY_MAX ? `${SENIORITY_MAX}+ ans` : `${v} an${v > 1 ? 's' : ''}`} />
      </div>

      <div>
        <FieldLabel>Type de contrat</FieldLabel>
        <ToggleGroup name="contract" options={CONTRACT_OPTIONS} value={contract} onChange={setContract} />
      </div>
      <div>
        <FieldLabel>Télétravail</FieldLabel>
        <ToggleGroup name="remote" options={REMOTE_OPTIONS} value={remote} onChange={setRemote} />
      </div>

      <button type="submit"
        className="mbc-search-submit w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:-translate-y-0.5"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)', boxShadow: '0 10px 24px rgba(0,0,0,0.2)' }}>
        Rechercher les offres <Search className="mbc-search-submit-icon h-4 w-4" />
      </button>
    </form>
  )
}
