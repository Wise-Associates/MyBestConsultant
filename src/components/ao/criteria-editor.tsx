import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, Lock, Plus, RotateCcw, Save, Scale, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { BRAND } from '@/app/admin/candidats/labels'
import { CRITERION_LABELS, MAX_ROLES } from '@/lib/match-scoring'
import {
  CRITERIA_LIMITS, REQUIRED_BY_DEFAULT, STANDARD_KEYS, cleanLabel, criteriaSetProblem, isStandardKey, nextCustomId, weightsSummingTo,
  type CriterionLabel, type OfferCriteriaSet, type OfferCriterion,
} from '@/lib/offer-criteria'

// Critères de matching d'une offre (ADR 0061) : un résumé sur la page (total, répartition des poids, bouton
// « Configurer ») et l'éditeur dans un panneau qui glisse depuis la droite (maquette de l'utilisateur du 2026-11-25,
// « criteres-matching.html »). Critères du barème « matching » (retirables) et critères ajoutés, chacun avec son poids
// (total 100) et ses libellés, chacun avec sa part dans le critère (total 100) et ★ requis. Ajouter ou retirer un
// critère ou un libellé garde les totaux à 100 (les autres sont ajustés en proportion) ; un poids saisi à la main peut
// les déséquilibrer : « Répartir ». Règles et validation : src/lib/offer-criteria.ts (les mêmes que le serveur, seules
// juges de l'enregistrement). Utilisé avant la publication d'un AO (back-office clair, `tone="admin"`) et sur le
// Matching IA d'une offre (jetons du site) : les couleurs lisent les jetons --admin-* s'ils existent, sinon ceux du site ;
// le panneau, rendu dans <body>, reprend la classe `admin-light` pour le back-office. Sans « use client » : importé
// seulement par des composants clients (ses props sont des fonctions).

const SOURCE_LABEL = { saved: 'Enregistrés', ai: 'Proposés par l’IA', default: 'Par défaut' } as const
type Source = keyof typeof SOURCE_LABEL
type SaveResult = { error?: string; message?: string }
type Tone = 'admin' | 'site'

// Couleurs d'état du back-office (nuances 700, lisibles sur blanc : AGENTS.md).
const OK = '#047857'
const KO = '#b91c1c'
const WARN = '#b45309'
const AI = '#6d28d9'

// Une couleur par critère (maquette du 2026-11-25) : repère de la barre des poids, jamais une couleur de texte.
const CRITERION_COLORS: Record<string, string> = {
  poste: '#e8a33d', competences: '#8b5cf6', localisation: '#0ea5e9', domaine: '#1f8a5b', niveau: '#2c2721',
  exigences: '#d97757', projet: '#94a3b8', formation: '#a3a3a8', langue: '#c4b5a0', tjm: '#cbd5e1',
}
const CUSTOM_COLORS = ['#e11d48', '#0d9488', '#4f46e5', '#65a30d']
const colorOf = (c: OfferCriterion) => CRITERION_COLORS[c.id] ?? CUSTOM_COLORS[(Number(c.id.slice(1)) || 0) % CUSTOM_COLORS.length]

/** Critères ajoutés proposés en un clic (maquette), en plus des critères du barème retirés. */
const SUGGESTED_NAMES = ['Disponibilité', 'Certifications', 'Mobilité']

const DEFAULT_INTRO = 'Les CV de cette offre (base candidats, viviers, sourcing) sont notés sur ces critères. Chaque libellé est jugé par l’IA, le score suit vos poids.'

/** Jetons de l'éditeur, posés sur sa racine : back-office clair (--admin-*) s'ils existent, sinon ceux du site. */
function toneVars(tone: Tone): CSSProperties {
  const accent = tone === 'admin' ? BRAND : 'var(--color-primary)'
  return {
    '--crit-panel': 'var(--admin-panel, var(--color-surface))',
    '--crit-raised': 'var(--admin-panel-raised, color-mix(in srgb, var(--color-text) 3%, var(--color-surface)))',
    '--crit-line': 'var(--admin-line, var(--color-border))',
    '--crit-fg': 'var(--admin-fg, var(--color-text))',
    '--crit-muted': 'var(--admin-fg-muted, var(--color-text-muted))',
    '--crit-accent': accent,
    '--crit-accent-fg': tone === 'admin' ? '#fff' : 'var(--color-primary-fg, #fff)',
    // Texte sur fond clair : l'orange de la marque est trop pâle (2,8:1), sa nuance 700 sert au texte.
    '--crit-accent-ink': tone === 'admin' ? '#c2410c' : 'var(--color-primary)',
    '--crit-accent-soft': `color-mix(in srgb, ${accent} 14%, transparent)`,
  } as CSSProperties
}

const fg: CSSProperties = { color: 'var(--crit-fg)' }
// Tailles des titres en ligne : les règles h2 / h3 de globals.css, hors couche, l'emporteraient sur les classes.
const heading = (fontSize: number, fontWeight: number): CSSProperties => ({ ...fg, fontSize, fontWeight, lineHeight: 1.3 })
const muted: CSSProperties = { color: 'var(--crit-muted)' }
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--crit-accent)]'
// Couleurs qui changent au survol ou au focus : en classes, un style en ligne l'emporterait sur elles.
const tFg = 'text-[color:var(--crit-fg)]'
const tMuted = 'text-[color:var(--crit-muted)]'
const bLine = 'border-[color:var(--crit-line)]'
const bgPanel = 'bg-[var(--crit-panel)]'
const dangerHover = 'hover:bg-[color-mix(in_srgb,#b91c1c_8%,transparent)] hover:text-[#b91c1c]'
const accentHover = 'hover:bg-[var(--crit-accent-soft)] hover:text-[color:var(--crit-accent-ink)]'
const fieldFocus = 'outline-none focus:border-[color:var(--crit-accent)] focus:shadow-[0_0_0_3px_var(--crit-accent-soft)]'
const hoverTint = 'hover:bg-[color-mix(in_srgb,var(--crit-fg)_5%,transparent)]'
const eyebrow = 'text-[10.5px] font-semibold uppercase tracking-[0.05em]'
const accentButton = `inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-2 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`
const accentButtonStyle: CSSProperties = { background: 'var(--crit-accent)', color: 'var(--crit-accent-fg)' }

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const clampWeight = (n: number) => Math.max(1, Math.min(100, Math.round(n)))
/** Poids ramenés à `total` en gardant leurs proportions (chacun au moins 1). */
const rescaled = (weights: number[], total = 100) => weightsSummingTo(weights.length, total, weights)
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/** Ce qui empêche d'enregistrer, une phrase par problème ; le schéma (criteriaSetProblem) reste seul juge. */
function problemsOf(set: OfferCriteriaSet): string[] {
  const total = sum(set.criteria.map(c => c.weight))
  const problems: string[] = []
  if (total !== 100) problems.push(`Total des poids : ${total} au lieu de 100 (${total < 100 ? `il manque ${100 - total}` : `retirez ${total - 100}`} pts).`)
  for (const c of set.criteria) {
    const labels = sum(c.labels.map(l => l.weight))
    if (c.labels.length > 0 && labels !== 100) problems.push(`${c.name || 'Critère ajouté'} : libellés à ${labels} au lieu de 100.`)
  }
  const schema = criteriaSetProblem(set)
  return problems.length === 0 && schema ? [schema] : problems
}

/**
 * Nombre de 1 à 100 saisi au clavier : le texte tapé reste tel quel (champ vidé avant un autre chiffre) et seul un
 * nombre valide est transmis ; une valeur changée ailleurs (boutons −/+, « Répartir ») remplace le texte.
 */
function NumberInput({ value, onCommit, label, className, style, readOnly, title }: {
  value: number; onCommit: (n: number) => void; label: string; className: string; style?: CSSProperties; readOnly?: boolean; title?: string
}) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(String(value))
  }
  return (
    <input inputMode="numeric" value={text} readOnly={readOnly} aria-label={label} title={title} className={className} style={style}
      onChange={e => {
        const next = e.target.value.replace(/\D/g, '').slice(0, 3)
        setText(next)
        const n = Number(next)
        if (next && n >= 1 && n <= 100) {
          setShown(n)
          onCommit(n)
        }
      }}
      onBlur={() => setText(String(value))} />
  )
}

function WeightStepper({ value, onChange, name }: { value: number; onChange: (n: number) => void; name: string }) {
  const step = `grid h-full w-6 shrink-0 place-items-center text-[15px] disabled:opacity-40 ${hoverTint} ${focusRing}`
  return (
    <div className={`flex h-8 shrink-0 items-center overflow-hidden rounded-[9px] border ${bLine} focus-within:border-[color:var(--crit-accent)] focus-within:shadow-[0_0_0_3px_var(--crit-accent-soft)]`}
      style={{ background: 'var(--crit-raised)' }}>
      <button type="button" aria-label={`Diminuer le poids de ${name}`} disabled={value <= 1} onClick={() => onChange(clampWeight(value - 1))} className={step} style={muted}>−</button>
      <NumberInput value={value} onCommit={onChange} label={`Poids de ${name}`}
        className="w-[38px] bg-transparent pr-0.5 text-right text-[14px] font-bold tabular-nums outline-none" style={fg} />
      <span className="pr-2 text-[11px]" style={muted}>pts</span>
      <button type="button" aria-label={`Augmenter le poids de ${name}`} disabled={value >= 100} onClick={() => onChange(clampWeight(value + 1))} className={step} style={muted}>+</button>
    </div>
  )
}

const Swatch = ({ color }: { color: string }) => <i aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />

/** Répartition des poids, critère par critère (manque hachuré). */
function WeightsBar({ criteria }: { criteria: OfferCriterion[] }) {
  const total = sum(criteria.map(c => c.weight))
  const scale = Math.max(total, 100)
  return (
    <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-md" style={{ background: 'color-mix(in srgb, var(--crit-fg) 8%, transparent)' }}>
      {criteria.map(c => (
        <i key={c.id} title={`${c.name} · ${c.weight}`} className="block h-full transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${(c.weight / scale) * 100}%`, background: colorOf(c) }} />
      ))}
      {total < 100 && (
        <i title={`Manque ${100 - total}`} className="block h-full"
          style={{ width: `${100 - total}%`, background: `repeating-linear-gradient(45deg, ${KO}33 0 4px, transparent 4px 8px)` }} />
      )}
    </div>
  )
}

/** Légende de la barre : nom et poids de chaque critère. */
function KeysLine({ criteria }: { criteria: OfferCriterion[] }) {
  return (
    <ul className="mt-[7px] flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={muted} aria-label="Poids des critères">
      {criteria.map(c => (
        <li key={c.id} className="inline-flex items-center gap-[5px]">
          <Swatch color={colorOf(c)} />{c.name || 'Critère ajouté'} <b className="font-semibold tabular-nums" style={fg}>{c.weight}</b>
        </li>
      ))}
    </ul>
  )
}

function TotalFigure({ total }: { total: number }) {
  const ok = total === 100
  return (
    <span className="flex items-center gap-1.5 text-[20px] font-bold tracking-[-0.02em] tabular-nums">
      <span style={{ color: ok ? OK : KO }}>{total}</span>
      <small className="text-[12px] font-medium" style={muted}>/ 100</small>
      {ok ? <Check size={14} strokeWidth={3} color={OK} aria-label="total juste" /> : <AlertTriangle size={14} color={KO} aria-label="total faux" />}
    </span>
  )
}

function SourceBadge({ source, badge }: { source?: Source; badge?: string }) {
  if (source === 'ai') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${AI}1A`, color: AI }}>
        <Sparkles size={11} aria-hidden />{SOURCE_LABEL.ai}
      </span>
    )
  }
  const text = badge ?? (source && SOURCE_LABEL[source])
  if (!text) return null
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'color-mix(in srgb, var(--crit-fg) 7%, transparent)', color: 'var(--crit-muted)' }}>{text}</span>
}

interface DrawerProps {
  criteria: OfferCriteriaSet
  onChange: (next: OfferCriteriaSet) => void
  /** D'où viennent les critères (pastille ; « Proposés par l'IA », « Par défaut » : pas encore enregistrés). */
  source?: Source
  /** Pastille libre (« Propres »…) quand `source` ne s'applique pas. */
  badge?: string
  /** Pourquoi l'IA n'a pas proposé les critères ; vide sinon. */
  notice?: string
  /** Enregistre les critères ; `message` remplace `savedText`. Absent : pas de bouton. */
  save?: (criteria: OfferCriteriaSet) => Promise<SaveResult>
  savedText?: string
  /** « Revenir aux critères de l'offre » (critères propres) : libellé, critères montrés ensuite et action. */
  reset?: { label: string; to: OfferCriteriaSet; run: () => Promise<SaveResult> }
  title?: string
  intro?: ReactNode
  /** Libellé du bouton qui ouvre le panneau. */
  openLabel?: string
  /** `admin` : back-office clair (orange de la marque) ; `site` : jetons du site. */
  tone?: Tone
  /** Une ligne (titre, pastille, bouton) sans la répartition des poids : détail d'un candidat. */
  compact?: boolean
  className?: string
  style?: CSSProperties
}

/** Résumé des critères et bouton qui ouvre leur éditeur dans un panneau à droite. */
export function CriteriaDrawer({
  criteria, onChange, source, badge, notice = '', save, reset, title = 'Critères de matching', intro = DEFAULT_INTRO,
  savedText = 'Critères enregistrés : la section Sourcing et la publication les utiliseront.', openLabel = 'Configurer les critères',
  tone = 'site', compact = false, className = '', style,
}: DrawerProps) {
  const id = useId()
  // Version enregistrée, pour « Modifications non enregistrées » ; null : rien d'enregistré (proposition, défaut).
  const [baseline, setBaseline] = useState<string | null>(() => (source && source !== 'saved' ? null : JSON.stringify(criteria)))
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const dirty = !!save && baseline !== JSON.stringify(criteria)
  const problems = problemsOf(criteria)
  const total = sum(criteria.criteria.map(c => c.weight))

  const change = (next: OfferCriteriaSet) => {
    setSaveState(null)
    onChange(next)
  }

  async function run(action: () => Promise<SaveResult>, done: string, onSuccess: () => void) {
    setSaving(true)
    setSaveState(null)
    const res = await action().catch((): SaveResult => ({ error: 'Enregistrement interrompu : connexion perdue, réessayez.' }))
    setSaving(false)
    if (!res.error) onSuccess()
    const text = res.error ?? res.message ?? done
    setSaveState(text ? { tone: res.error ? 'error' : 'ok', text } : null)
  }

  const onSave = save && (() => {
    const saved = criteria
    return run(() => save(saved), savedText, () => setBaseline(JSON.stringify(saved)))
  })
  const onReset = reset && (() => run(reset.run, '', () => {
    setBaseline(JSON.stringify(reset.to))
    onChange(reset.to)
  }))

  const status = saveState && (
    <p role="status" className="text-xs" style={{ color: saveState.tone === 'ok' ? OK : KO }}>{saveState.text}</p>
  )
  const labels = criteria.criteria.flatMap(c => c.labels)
  const required = labels.filter(l => l.required).length

  return (
    <Sheet>
      <div className={className} style={{ ...toneVars(tone), ...style }}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 id={`${id}-summary`} className="flex flex-wrap items-center gap-2" style={heading(14, 600)}>
              <Scale size={15} aria-hidden />{title}<SourceBadge source={source} badge={badge} />
            </h4>
            {!compact && (
              <p className="mt-1 text-xs" style={muted}>
                {plural(criteria.criteria.length, 'critère')} · {plural(labels.length, 'libellé')}{required ? ` · ${required} requis` : ''}
              </p>
            )}
          </div>
          <SheetTrigger className={compact ? `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${bLine} ${bgPanel} ${tFg} hover:bg-[color-mix(in_srgb,var(--crit-fg)_5%,var(--crit-panel))] ${focusRing}` : accentButton}
            style={compact ? undefined : accentButtonStyle}
            aria-describedby={`${id}-summary`}>
            <SlidersHorizontal size={14} aria-hidden />{openLabel}
          </SheetTrigger>
        </div>
        {!compact && (
          <div className="mt-3 flex items-center gap-4">
            <TotalFigure total={total} />
            <div className="min-w-0 flex-1"><WeightsBar criteria={criteria.criteria} /><KeysLine criteria={criteria.criteria} /></div>
          </div>
        )}
        {(notice || problems.length > 0 || dirty || saveState) && (
          <div className="mt-2 space-y-1">
            {notice && <p className="text-xs" style={{ color: WARN }}>L’IA n’a pas proposé les critères ({notice.replace(/\.$/, '')}) : critères par défaut, à compléter.</p>}
            {problems.length > 0 && <p className="text-xs" style={{ color: KO }}>{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1})` : ''}</p>}
            {dirty && !saveState && <p className="text-xs" style={{ color: WARN }}>Modifications non enregistrées.</p>}
            {status}
          </div>
        )}
      </div>

      <SheetContent className={`max-w-[1120px] ${tone === 'admin' ? 'admin-light' : ''}`}
        style={{ ...toneVars(tone), background: 'var(--admin-bg, var(--color-background))', color: 'var(--crit-fg)' }}>
        <CriteriaEditor criteria={criteria} onChange={change} source={source} badge={badge} notice={notice} title={title} intro={intro}
          problems={problems} total={total} dirty={dirty} saving={saving} status={status} onSave={onSave} reset={reset && onReset && { label: reset.label, run: onReset }} />
      </SheetContent>
    </Sheet>
  )
}

/** Contenu du panneau : en-tête, barre des poids collée en haut, critères avec libellés, critères sans libellé, ajouts. */
function CriteriaEditor({ criteria, onChange, source, badge, notice, title, intro, problems, total, dirty, saving, status, onSave, reset }: {
  criteria: OfferCriteriaSet
  onChange: (next: OfferCriteriaSet) => void
  source?: Source
  badge?: string
  notice: string
  title: string
  intro: ReactNode
  problems: string[]
  total: number
  dirty: boolean
  saving: boolean
  status: ReactNode
  onSave?: () => void
  reset?: { label: string; run: () => void }
}) {
  // Champ à placer sous le curseur après un ajout (nouveau libellé, nouveau critère).
  const [focus, setFocus] = useState('')
  const [altText, setAltText] = useState('')
  const list = criteria.criteria
  const full = list.length >= CRITERIA_LIMITS.criteria
  const present = new Set(list.map(c => c.name.toLowerCase()))
  const suggestions = [
    ...STANDARD_KEYS.filter(key => !list.some(c => c.id === key)).map(key => ({ key: key as string, name: CRITERION_LABELS[key] })),
    ...SUGGESTED_NAMES.filter(name => !present.has(name.toLowerCase())).map(name => ({ key: 'custom', name })),
  ]

  const setCriteria = (next: OfferCriterion[]) => onChange({ ...criteria, criteria: next })
  const setCriterion = (i: number, patch: Partial<OfferCriterion>) => setCriteria(list.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  const setLabels = (i: number, labels: CriterionLabel[]) => setCriterion(i, { labels })
  const setLabel = (i: number, li: number, patch: Partial<CriterionLabel>) => setLabels(i, list[i].labels.map((l, k) => (k === li ? { ...l, ...patch } : l)))

  function removeCriterion(i: number) {
    const rest = list.filter((_, k) => k !== i)
    const weights = rescaled(rest.map(c => c.weight))
    setCriteria(rest.map((c, k) => ({ ...c, weight: weights[k] })))
  }

  function addCriterion(key: string, name = '') {
    const id = key === 'custom' ? nextCustomId(criteria) : key
    const added: OfferCriterion = { id, name: isStandardKey(id) ? CRITERION_LABELS[id] : name, weight: 5, labels: [] }
    const weights = rescaled(list.map(c => c.weight), 95)
    setCriteria([...list.map((c, k) => ({ ...c, weight: weights[k] })), added])
    if (!name && !isStandardKey(id)) setFocus(`name:${id}`)
  }

  function addLabel(i: number) {
    const c = list[i]
    const share = c.labels.length > 0 ? sum(c.labels.map(l => l.weight)) / c.labels.length : 100
    const weights = rescaled([...c.labels.map(l => l.weight), share])
    // Lieu, séniorité, formation, secteur, langue : un libellé ajouté est requis comme le plafond du barème (★ à retirer).
    setLabels(i, [...c.labels.map((l, k) => ({ ...l, weight: weights[k] })), { label: '', weight: weights[c.labels.length], required: REQUIRED_BY_DEFAULT.has(c.id) }])
    setFocus(`label:${c.id}:${c.labels.length}`)
  }

  function removeLabel(i: number, li: number) {
    const rest = list[i].labels.filter((_, k) => k !== li)
    const weights = rescaled(rest.map(l => l.weight))
    setLabels(i, rest.map((l, k) => ({ ...l, weight: weights[k] })))
  }

  function rebalanceLabels(i: number) {
    const weights = rescaled(list[i].labels.map(l => l.weight))
    setLabels(i, list[i].labels.map((l, k) => ({ ...l, weight: weights[k] })))
  }
  function rebalanceCriteria() {
    const weights = rescaled(list.map(c => c.weight))
    setCriteria(list.map((c, k) => ({ ...c, weight: weights[k] })))
  }

  function addAlternatives(text: string) {
    const seen = new Set(criteria.alternativeTitles.map(t => t.toLowerCase()))
    const added = text.split(',').map(t => cleanLabel(t)).filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    setAltText('')
    if (added.length > 0) onChange({ ...criteria, alternativeTitles: [...criteria.alternativeTitles, ...added].slice(0, CRITERIA_LIMITS.alternatives) })
  }
  function onAltKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' && e.key !== ',') return
    e.preventDefault()
    addAlternatives(altText)
  }

  const nameField = (c: OfferCriterion, i: number, size: string) => isStandardKey(c.id) ? (
    <span className={`flex min-w-0 items-center gap-[7px] font-semibold ${size}`} style={fg}><Swatch color={colorOf(c)} /><span className="truncate">{c.name}</span></span>
  ) : (
    <span className="flex min-w-0 items-center gap-[7px]">
      <Swatch color={colorOf(c)} />
      <input value={c.name} maxLength={CRITERIA_LIMITS.name} placeholder="Nom du critère" aria-label="Nom du critère ajouté" autoFocus={focus === `name:${c.id}`}
        onChange={e => setCriterion(i, { name: e.target.value })}
        className={`min-w-0 flex-1 rounded-[7px] border border-transparent bg-transparent px-1.5 py-1 font-semibold hover:border-[color:var(--crit-line)] ${fieldFocus} ${size}`} style={fg} />
    </span>
  )
  const removeButton = (c: OfferCriterion, i: number) => (
    <button type="button" onClick={() => removeCriterion(i)} disabled={list.length <= 1} aria-label={`Supprimer le critère ${c.name || 'ajouté'}`} title="Supprimer le critère"
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tMuted} ${dangerHover} disabled:opacity-40 ${focusRing}`}>
      <Trash2 size={15} aria-hidden />
    </button>
  )
  const shareBar = (c: OfferCriterion, width: number) => (
    <div aria-hidden className="h-[3px]" style={{ background: 'color-mix(in srgb, var(--crit-fg) 6%, transparent)' }}>
      <i className="block h-full" style={{ width: `${Math.min(100, width)}%`, background: colorOf(c) }} />
    </div>
  )

  const rich = list.map((c, i) => ({ c, i })).filter(({ c }) => c.labels.length > 0 || c.id === 'poste')
  const lite = list.map((c, i) => ({ c, i })).filter(({ c }) => c.labels.length === 0 && c.id !== 'poste')

  return (
    <section className="min-h-full">
      <header className="flex flex-col gap-1.5 border-b px-3.5 py-3.5 md:flex-row md:items-start md:gap-4 md:px-5 md:pb-3.5 md:pt-[18px]" style={{ background: 'var(--crit-panel)', borderColor: 'var(--crit-line)' }}>
        <div className="min-w-0 flex-1">
          <SheetTitle className="flex flex-wrap items-center gap-2 tracking-[-0.01em]" style={heading(17, 700)}>
            <Scale size={18} aria-hidden />{title}<SourceBadge source={source} badge={badge} />
          </SheetTitle>
          <p className="mt-1 max-w-[640px] text-[12.5px] leading-normal" style={muted}>{intro}</p>
          {notice && <p className="mt-1.5 text-xs" style={{ color: WARN }}>L’IA n’a pas proposé les critères ({notice.replace(/\.$/, '')}) : critères par défaut, à compléter.</p>}
          <ul className="mt-2 flex flex-col gap-1.5 text-[12px] md:flex-row md:flex-wrap md:gap-x-3.5" style={muted}>
            <li className="inline-flex items-center gap-[5px]">
              <span className="inline-flex h-5 items-center whitespace-nowrap rounded-full border px-[7px] text-[11.5px] font-semibold"
                style={{ background: 'var(--crit-accent-soft)', borderColor: 'color-mix(in srgb, var(--crit-accent) 35%, transparent)', color: 'var(--crit-accent-ink)' }}>★ Requis</span>
              s’il manque, le score reste sous 65
            </li>
            <li><b style={fg}>Poids</b> des critères : total 100</li>
            <li><b style={fg}>Libellés</b> d’un critère : total 100</li>
          </ul>
          {reset && (
            <button type="button" onClick={reset.run} disabled={saving}
              className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline disabled:opacity-50 ${focusRing}`} style={fg}>
              <RotateCcw size={13} aria-hidden />{reset.label}
            </button>
          )}
        </div>
        {/* Sur mobile, au-dessus du titre : le bouton de fermeture reste en haut du panneau. */}
        <div className="order-first flex items-center gap-3 md:order-none md:self-start">
          <span className="inline-flex items-center gap-[5px] text-[11.5px]" style={muted}><Lock size={13} aria-hidden />Jamais montrés aux candidats</span>
          <SheetClose aria-label="Fermer" className={`ml-auto grid h-8 w-8 place-items-center rounded-lg ${hoverTint} ${focusRing}`} style={muted}>
            <X size={17} aria-hidden />
          </SheetClose>
        </div>
      </header>

      <div role="region" aria-label="Répartition des poids" className="sticky top-0 z-[5] flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-b px-3.5 py-2.5 md:flex-nowrap md:gap-4 md:px-5 md:py-3"
        style={{ background: 'var(--crit-panel)', borderColor: 'var(--crit-line)' }}>
        <div className="flex min-w-[118px] flex-col">
          <span className={eyebrow} style={muted}>Total des poids</span>
          <TotalFigure total={total} />
        </div>
        <div className="order-3 min-w-0 basis-full md:order-none md:flex-1 md:basis-auto">
          <WeightsBar criteria={list} />
          <div className="hidden md:block"><KeysLine criteria={list} /></div>
        </div>
        {dirty && (
          <span className="hidden items-center gap-[5px] whitespace-nowrap text-[11.5px] md:flex" style={{ color: 'var(--crit-accent-ink)' }}>
            <i aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--crit-accent)' }} />Modifications non enregistrées
          </span>
        )}
        {onSave && (
          <button type="button" onClick={onSave} disabled={saving || problems.length > 0} className={`ml-auto md:ml-0 ${accentButton}`} style={accentButtonStyle}>
            {saving ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Save size={14} aria-hidden />}Enregistrer
          </button>
        )}
        {status && <div className="order-4 basis-full">{status}</div>}
      </div>

      <div className="px-3.5 pb-4 pt-3 md:px-5 md:pb-5 md:pt-4">
        {problems.length > 0 && (
          <div role="alert" className="mb-3.5 flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-[9px] text-[12.5px]"
            style={{ background: `${KO}0F`, borderColor: `${KO}33`, color: KO }}>
            <AlertTriangle size={14} aria-hidden />
            <span className="min-w-0 flex-1">{onSave ? 'Enregistrement impossible. ' : 'Critères à corriger. '}{problems.join(' ')}</span>
            {total !== 100 && <button type="button" onClick={rebalanceCriteria} className={`font-semibold underline ${focusRing}`}>Ramener le total à 100</button>}
          </div>
        )}

        <div className="gap-x-3.5 lg:columns-2">
          {rich.map(({ c, i }) => {
            const labelsTotal = sum(c.labels.map(l => l.weight))
            const labelsOk = labelsTotal === 100
            const requiredCount = c.labels.filter(l => l.required).length
            const maxLabels = c.id === 'poste' ? MAX_ROLES : CRITERIA_LIMITS.labels
            const name = c.name || 'ce critère'
            return (
              <article key={c.id} className="mb-3.5 break-inside-avoid overflow-hidden rounded-[14px] border"
                style={{ background: 'var(--crit-panel)', borderColor: c.labels.length > 0 && !labelsOk ? `${KO}55` : 'var(--crit-line)' }}>
                <div className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-3">
                  <div className="min-w-0 flex-1">
                    {nameField(c, i, 'text-[14px]')}
                    <p className="mt-px text-[11.5px]" style={muted}>
                      {c.labels.length > 0 ? plural(c.labels.length, 'libellé') : 'Sans libellé'}{requiredCount ? ` · ${requiredCount} requis` : ''} · {c.weight} % du score
                    </p>
                  </div>
                  <WeightStepper value={c.weight} name={c.name || 'critère ajouté'} onChange={weight => setCriterion(i, { weight })} />
                  {removeButton(c, i)}
                </div>
                {shareBar(c, c.weight)}

                <div className="px-2 pb-1.5 pt-1">
                  {c.labels.length > 1 ? (
                    <div aria-hidden className={`grid grid-cols-[1fr_44px_32px_26px] gap-1.5 px-1.5 py-1 md:grid-cols-[1fr_92px_74px_28px] ${eyebrow}`} style={muted}>
                      <span>Libellé</span><span className="text-right">Part</span><span className="invisible text-center md:visible">Requis</span><span />
                    </div>
                  ) : <div className="h-1.5" />}
                  {c.labels.length === 0 && <p className="px-1.5 pb-1 text-[12px]" style={muted}>Jugé d’après l’offre dans son ensemble : ajoutez un libellé pour le préciser.</p>}
                  <ul aria-label={`Libellés de ${name}`}>
                    {c.labels.map((l, li) => {
                      const text = l.label || 'nouveau libellé'
                      return (
                        <li key={li} className={`grid grid-cols-[1fr_44px_32px_26px] items-center gap-1.5 rounded-lg py-[3px] md:grid-cols-[1fr_92px_74px_28px] md:px-1.5 ${hoverTint}`}>
                          <input value={l.label} maxLength={CRITERIA_LIMITS.label} placeholder="Nouveau libellé" aria-label={`Libellé ${li + 1} de ${name}`}
                            autoFocus={focus === `label:${c.id}:${li}`} onChange={e => setLabel(i, li, { label: e.target.value })}
                            className={`w-full min-w-0 rounded-[7px] border border-transparent bg-transparent px-2 py-1.5 text-[13px] hover:border-[color:var(--crit-line)] hover:bg-[var(--crit-panel)] ${fieldFocus}`} style={fg} />
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden className="hidden h-1 flex-1 overflow-hidden rounded-[3px] md:block" style={{ background: 'color-mix(in srgb, var(--crit-fg) 7%, transparent)' }}>
                              <i className="block h-full rounded-[3px]" style={{ width: `${Math.min(100, l.weight)}%`, background: colorOf(c) }} />
                            </span>
                            <NumberInput value={l.weight} onCommit={weight => setLabel(i, li, { weight })} label={`Part de « ${text} » dans ${name}`}
                              readOnly={c.labels.length === 1} title={c.labels.length === 1 ? 'Un seul libellé : 100' : undefined}
                              className={`w-9 rounded-[7px] border ${bLine} ${bgPanel} px-[5px] py-[5px] text-right text-[12.5px] font-semibold tabular-nums read-only:opacity-60 ${fieldFocus}`}
                              style={fg} />
                          </span>
                          <button type="button" aria-pressed={l.required} aria-label={`« ${text} » requis`} title={l.required ? 'Requis : retirer ★' : 'Marquer requis (★)'}
                            onClick={() => setLabel(i, li, { required: !l.required })}
                            className={`inline-flex h-[26px] items-center justify-center gap-1 rounded-full border text-[11.5px] font-semibold ${l.required ? '' : `border-dashed ${bLine} ${tMuted} hover:border-[color:var(--crit-accent)] hover:text-[color:var(--crit-accent-ink)]`} ${focusRing}`}
                            style={l.required ? { background: 'var(--crit-accent-soft)', borderColor: 'color-mix(in srgb, var(--crit-accent) 35%, transparent)', color: 'var(--crit-accent-ink)' } : undefined}>
                            ★<span className="hidden md:inline">Requis</span>
                          </button>
                          <button type="button" onClick={() => removeLabel(i, li)} aria-label={`Retirer « ${text} »`} title="Retirer le libellé"
                            className={`grid h-[26px] w-[26px] place-items-center rounded-[7px] ${tMuted} ${dangerHover} ${focusRing}`}>
                            <X size={13} strokeWidth={2.2} aria-hidden />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 pb-2.5 pt-1.5">
                  <button type="button" onClick={() => addLabel(i)} disabled={c.labels.length >= maxLabels}
                    className={`-ml-1.5 inline-flex items-center gap-[5px] rounded-[7px] px-1.5 py-1 text-[12.5px] font-semibold ${tFg} ${accentHover} disabled:opacity-40 ${focusRing}`}>
                    <Plus size={13} strokeWidth={2.4} aria-hidden />Ajouter un libellé
                  </button>
                  {c.labels.length > 1 && (labelsOk ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: `${OK}14`, color: OK }}>
                      <Check size={12} strokeWidth={3} aria-hidden />100 / 100
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums" style={{ background: `${KO}0F`, color: KO }}>{labelsTotal} / 100</span>
                      <button type="button" onClick={() => rebalanceLabels(i)} title="Ramener le total à 100 en gardant les proportions"
                        className={`text-[11.5px] font-semibold underline ${focusRing}`} style={{ color: KO }}>Répartir</button>
                    </span>
                  ))}
                </div>

                {c.id === 'poste' && (
                  <div className="border-t px-3.5 pb-3 pt-2.5" style={{ borderColor: 'var(--crit-line)', background: 'var(--crit-raised)' }}>
                    <p className={`mb-[7px] flex flex-wrap justify-between gap-x-2 ${eyebrow}`} style={muted}>
                      <span>Autres intitulés du métier</span>
                      <span className="text-[11px] font-normal normal-case tracking-normal">utilisés pour rechercher les CV</span>
                    </p>
                    <ul className="flex flex-wrap gap-[5px]" aria-label="Autres intitulés du métier">
                      {criteria.alternativeTitles.map(t => (
                        <li key={t} className={`inline-flex items-center gap-[5px] rounded-[7px] border ${bLine} ${bgPanel} py-[3px] pl-2 pr-1 text-[12px]`} style={fg}>
                          {t}
                          <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange({ ...criteria, alternativeTitles: criteria.alternativeTitles.filter(x => x !== t) })}
                            className={`grid h-4 w-4 place-items-center rounded text-[13px] leading-none ${tMuted} ${dangerHover} ${focusRing}`}>×</button>
                        </li>
                      ))}
                      {criteria.alternativeTitles.length < CRITERIA_LIMITS.alternatives && (
                        <li>
                          <input value={altText} onChange={e => setAltText(e.target.value)} onKeyDown={onAltKey} onBlur={() => addAlternatives(altText)}
                            placeholder="+ Ajouter un intitulé, Entrée" aria-label="Ajouter un autre intitulé du métier"
                            className={`min-w-[190px] rounded-[7px] border border-dashed ${bLine} bg-transparent px-2 py-[3px] text-[12px] ${fieldFocus}`} style={fg} />
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {lite.length > 0 && (
          <div className="mt-2.5">
            <h3 className={`mb-2 flex flex-wrap items-baseline gap-2 uppercase tracking-[0.06em]`} style={{ ...heading(11, 600), color: 'var(--crit-muted)' }}>
              Sans libellé <em className="text-[11px] font-normal not-italic normal-case tracking-normal">— jugés d’après l’offre dans son ensemble</em>
            </h3>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {lite.map(({ c, i }) => (
                <li key={c.id} className="relative overflow-hidden rounded-xl border pb-2 pl-3 pr-2.5 pt-2.5" style={{ background: 'var(--crit-panel)', borderColor: 'var(--crit-line)' }}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">{nameField(c, i, 'text-[13.5px]')}</div>
                    <WeightStepper value={c.weight} name={c.name || 'critère ajouté'} onChange={weight => setCriterion(i, { weight })} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <button type="button" onClick={() => addLabel(i)}
                      className={`-ml-1.5 inline-flex items-center gap-[5px] rounded-[7px] px-1.5 py-1 text-[12px] font-semibold ${tFg} ${accentHover} ${focusRing}`}>
                      <Plus size={13} strokeWidth={2.4} aria-hidden />Libellé
                    </button>
                    {removeButton(c, i)}
                  </div>
                  {/* Poids d'un critère sans libellé souvent petits (2 à 5) : barre ×4 pour rester visible. */}
                  <div className="absolute inset-x-0 bottom-0">{shareBar(c, c.weight * 4)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-dashed pt-3.5" style={{ borderColor: 'var(--crit-line)' }}>
          <button type="button" onClick={() => addCriterion('custom')} disabled={full}
            className={`inline-flex items-center gap-1.5 rounded-[10px] border border-dashed ${bLine} ${bgPanel} ${tFg} px-3 py-2 text-[12.5px] font-semibold ${accentHover} disabled:opacity-40 ${focusRing}`}>
            <Plus size={14} aria-hidden />Ajouter un critère
          </button>
          {suggestions.length > 0 && !full && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]" style={muted}>
              Suggestions :
              {suggestions.map(s => (
                <button key={`${s.key}:${s.name}`} type="button" onClick={() => addCriterion(s.key, s.name)}
                  className={`rounded-full border ${bLine} ${bgPanel} ${tFg} px-2.5 py-[3px] text-[12px] hover:border-[color:var(--crit-accent)] hover:text-[color:var(--crit-accent-ink)] ${focusRing}`}>
                  + {s.name}
                </button>
              ))}
            </div>
          )}
          {full && <span className="text-[12px]" style={muted}>{CRITERIA_LIMITS.criteria} critères au plus.</span>}
        </div>
      </div>
    </section>
  )
}
