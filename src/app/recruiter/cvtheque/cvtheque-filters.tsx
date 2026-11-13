// Composant client : importé seulement par cvtheque-client.tsx (« use client »), qui en fait du code navigateur.
import { useState, type ReactNode } from 'react'
import { MapPin, X } from 'lucide-react'
import { RangeSlider } from '@/components/shared/range-slider'
import { EMPTY_FILTERS, EXPERIENCE_MAX, RADIUS_MAX, normalizeText, type CvthequeFilters } from '@/lib/cvtheque-search'

// Colonne des filtres de la CV Thèque (refonte du 2026-11-13, à la manière des outils de recherche de profils) : titre
// « Filtres » et « Réinitialiser », puis un filtre par donnée réellement connue des profils (règles :
// src/lib/cvtheque-search.ts). Couleurs du thème du site seulement.

const inputCls = 'w-full h-9 px-3 rounded-lg text-sm outline-none transition-colors focus:border-[var(--color-brand-orange)]'
const inputStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

function Label({ htmlFor, hint, children }: { htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-1.5">
      {htmlFor
        ? <label htmlFor={htmlFor} className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{children}</label>
        : <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{children}</span>}
      {hint && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
    </div>
  )
}

function TextFilter({ id, label, hint, value, placeholder, onChange, icon }: {
  id: string; label: string; hint?: string; value: string; placeholder: string; onChange: (v: string) => void; icon?: ReactNode
}) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>{label}</Label>
      <div className="relative">
        {icon && <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }}>{icon}</span>}
        <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={200}
          className={`${inputCls} ${icon ? 'pl-8' : ''}`} style={inputStyle} />
      </div>
    </div>
  )
}

/**
 * Valeurs choisies en puces, avec un champ qui propose celles des profils (liste du navigateur) : un choix dans la liste
 * ou Entrée ajoute la valeur, la croix la retire.
 */
function ChipPicker({ id, label, hint, values, options, placeholder, onChange }: {
  id: string; label: string; hint?: string; values: string[]; options: string[]; placeholder: string; onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const listId = `${id}-options`
  const chosen = new Set(values.map(normalizeText))
  const add = (raw: string) => {
    const v = raw.trim().slice(0, 80)
    setDraft('')
    if (v && !chosen.has(normalizeText(v))) onChange([...values, v])
  }
  return (
    <div>
      <Label htmlFor={id} hint={hint}>{label}</Label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label={`${label} choisies`}>
          {values.map(v => (
            <li key={v} className="inline-flex items-center gap-0.5 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: 'color-mix(in srgb, var(--color-brand-orange) 12%, transparent)', color: 'var(--color-text)' }}>
              {v}
              <button type="button" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}
                className="rounded-full p-0.5 hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input id={id} list={listId} value={draft} placeholder={placeholder} maxLength={80} className={inputCls} style={inputStyle}
        onChange={e => {
          // Choix dans la liste proposée : pas une frappe (Chrome envoie un Event simple, Firefox « insertReplacementText »).
          const native = e.nativeEvent
          const picked = !(native instanceof InputEvent) || native.inputType === 'insertReplacementText'
          if (picked && options.includes(e.target.value)) add(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } }} />
      <datalist id={listId}>
        {options.filter(o => !chosen.has(normalizeText(o))).map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  )
}

const ADDED_CHOICES: { value: CvthequeFilters['addedWithinDays']; label: string }[] = [
  { value: 0, label: 'Depuis toujours' },
  { value: 7, label: '7 derniers jours' },
  { value: 30, label: '30 derniers jours' },
]

export function CvthequeFiltersPanel({ filters, onChange, activeCount, options }: {
  filters: CvthequeFilters
  onChange: (f: CvthequeFilters) => void
  activeCount: number
  /** Valeurs proposées, tirées des profils (les plus fréquentes d'abord). */
  options: { skills: string[]; sectors: string[]; languages: string[] }
}) {
  const set = <K extends keyof CvthequeFilters>(key: K, value: CvthequeFilters[K]) => onChange({ ...filters, [key]: value })
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 style={{ color: 'var(--color-text)', fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 }}>Filtres</h2>
        {/* Garde la recherche de la barre : seuls les filtres de cette colonne repartent à zéro. */}
        <button type="button" onClick={() => onChange({ ...EMPTY_FILTERS, query: filters.query })} disabled={activeCount === 0}
          className="text-sm font-semibold disabled:opacity-40" style={{ color: 'var(--color-brand-orange)' }}>
          Réinitialiser
        </button>
      </div>

      <div>
        <Label>Disponibilité</Label>
        <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={filters.availableOnly} onChange={e => set('availableOnly', e.target.checked)}
            className="w-4 h-4 accent-[var(--color-brand-orange)]" />
          Disponible maintenant
        </label>
      </div>

      <fieldset>
        <legend className="text-[13px] font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Ajouté à la CV Thèque</legend>
        <div className="space-y-1.5">
          {ADDED_CHOICES.map(choice => (
            <label key={choice.value} className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="radio" name="cvtheque-added" checked={filters.addedWithinDays === choice.value}
                onChange={() => set('addedWithinDays', choice.value)} className="w-4 h-4 accent-[var(--color-brand-orange)]" />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label>Années d&apos;expérience</Label>
        <RangeSlider min={0} max={EXPERIENCE_MAX} step={1} value={filters.experience} onChange={v => set('experience', v)}
          formatLabel={v => (v >= EXPERIENCE_MAX ? `${EXPERIENCE_MAX}+ ans` : `${v} an${v > 1 ? 's' : ''}`)} />
      </div>

      <ChipPicker id="cvt-skills" label="Compétences" hint="toutes requises" values={filters.skills} options={options.skills}
        placeholder="Saisir une compétence" onChange={v => set('skills', v)} />

      <TextFilter id="cvt-location" label="Localisation" value={filters.location} placeholder="Ville, région, pays"
        onChange={v => set('location', v)} icon={<MapPin className="h-3.5 w-3.5" />} />

      <div>
        <Label>Rayon de mobilité</Label>
        <RangeSlider min={0} max={RADIUS_MAX} step={5} value={filters.radius} onChange={v => set('radius', v)}
          formatLabel={v => (v >= RADIUS_MAX ? `${RADIUS_MAX}+ km` : `${v} km`)} />
      </div>

      <ChipPicker id="cvt-sectors" label="Secteur" hint="l'un d'eux" values={filters.sectors} options={options.sectors}
        placeholder="Saisir un secteur" onChange={v => set('sectors', v)} />

      <ChipPicker id="cvt-languages" label="Langues parlées" hint="toutes requises" values={filters.languages} options={options.languages}
        placeholder="Saisir une langue" onChange={v => set('languages', v)} />

      <TextFilter id="cvt-company" label="Entreprise actuelle ou passée" value={filters.company} placeholder="Saisir une entreprise"
        onChange={v => set('company', v)} />

      <TextFilter id="cvt-school" label="Formation" value={filters.school} placeholder="École ou diplôme"
        onChange={v => set('school', v)} />

      <TextFilter id="cvt-title" label="Intitulé contenant" hint="postes visés et occupés" value={filters.titleQuery}
        placeholder={'java AND "react native"'} onChange={v => set('titleQuery', v)} />

      <TextFilter id="cvt-experience" label="Expériences contenant" value={filters.experienceQuery}
        placeholder={'"API" OR microservices'} onChange={v => set('experienceQuery', v)} />

      <TextFilter id="cvt-exclude" label="Exclure les profils contenant" value={filters.exclude}
        placeholder="junior stage" onChange={v => set('exclude', v)} />
    </div>
  )
}
