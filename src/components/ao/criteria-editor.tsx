import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SubmitEvent } from 'react'
import {
  AlertTriangle, ArrowUp, Check, ChevronRight, Loader2, Lock, Plus, RotateCcw, Save, Scale, SlidersHorizontal, Sparkles, Trash2, Undo2, X,
} from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { BRAND } from '@/app/admin/candidats/labels'
import { MAX_ROLES } from '@/lib/match-scoring'
import {
  CRITERIA_LIMITS, CRITERION_NAMES, DEFAULT_KEYS, REQUIRED_BY_DEFAULT, STANDARD_KEYS, cleanLabel, criteriaSetProblem, isStandardKey, nextCustomId,
  weightsSummingTo, type CriterionLabel, type OfferCriteriaSet, type OfferCriterion,
} from '@/lib/offer-criteria'
import { REVISION_LIMITS, criteriaChanges, type ChatTurn, type CriteriaChange, type RevisionRequest, type RevisionResult } from '@/lib/criteria-revision'
import type { TitleRequest, TitleSuggestion, TitleSuggestionsResult } from '@/lib/search/related-titles'

// Critères de matching d'une offre (ADR 0061, 0062) : un résumé sur la page (total, répartition des poids, bouton
// « Configurer ») et l'éditeur dans un panneau qui glisse depuis la droite. Dans le panneau (demande du 2026-11-25) :
// à gauche l'assistant des critères — le recruteur écrit ce qu'il faut changer, l'IA rend les critères modifiés, à relire
// ou annuler, jamais enregistrés sans « Enregistrer » ; à droite les critères en éléments dépliables, dans l'ordre et sous
// les noms de MBC Search (Intitulé, Lieu, Séniorité, Compétences, Secteur), chacun avec son poids (total 100) et ses
// libellés (part dans le critère, total 100, ★ requis) ; sous Intitulé, les autres intitulés du métier et des propositions
// tirées du dictionnaire de la classification et des CV. Ajouter ou retirer un critère ou un libellé garde les totaux à
// 100 (les autres sont ajustés en proportion) ; un poids saisi à la main peut les déséquilibrer : « Répartir ». Règles et
// validation : src/lib/offer-criteria.ts (les mêmes que le serveur, seul juge de l'enregistrement). Utilisé avant la
// publication d'un AO (back-office clair, `tone="admin"`) et sur le Matching IA d'une offre (jetons du site) : les
// couleurs lisent les jetons --admin-* s'ils existent, sinon ceux du site ; le panneau, rendu dans <body>, reprend la
// classe `admin-light` pour le back-office. Sans « use client » : importé seulement par des composants clients (ses
// props sont des fonctions).

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

/** Critères créés proposés en un clic, après les critères du barème absents. */
const SUGGESTED_NAMES = ['Disponibilité', 'Certifications', 'Mobilité']
/** Ce qu'une demande peut préciser (suggestions de MBC Search) : un clic ajoute la ligne à compléter. */
const HINTS = DEFAULT_KEYS.map(key => CRITERION_NAMES[key])

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
// Pastille « + … » des suggestions (même dessin que celles de MBC Search).
const chip = `inline-flex items-center gap-1 rounded-full border ${bLine} ${bgPanel} ${tFg} px-2.5 py-1 text-[12px] font-semibold hover:border-[color:var(--crit-accent)] hover:text-[color:var(--crit-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const clampWeight = (n: number) => Math.max(1, Math.min(100, Math.round(n)))
/** Poids ramenés à `total` en gardant leurs proportions (chacun au moins 1). */
const rescaled = (weights: number[], total = 100) => weightsSummingTo(weights.length, total, weights)
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
/** Métier principal de l'offre (premier libellé d'Intitulé) : celui dont on propose les autres intitulés. */
const mainTitle = (set: OfferCriteriaSet) => set.criteria.find(c => c.id === 'poste')?.labels[0]?.label ?? ''

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
 * nombre valide est transmis ; une valeur changée ailleurs (boutons −/+, « Répartir », assistant) remplace le texte.
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

/**
 * Échange avec l'assistant : demandes, réponses (avec les critères d'avant, pour annuler), erreurs et notes de l'écran
 * (annulation) ; seuls demandes et réponses sont renvoyées à l'IA.
 */
type ChatEntry =
  | { role: 'recruteur'; text: string }
  | { role: 'assistant'; text: string; changes: CriteriaChange[]; before: OfferCriteriaSet; after: string }
  | { role: 'erreur'; text: string }
  | { role: 'note'; text: string }
type TitlesState = { state: 'loading' } | { state: 'done'; titles: TitleSuggestion[]; note?: string } | { state: 'error'; text: string }

/** Premier message de l'assistant, écrit sans IA d'après les critères montrés à l'ouverture. */
function welcomeOf(set: OfferCriteriaSet, source?: Source): string {
  const from = source === 'ai' ? 'proposés par l’IA d’après l’offre' : source === 'default' ? 'par défaut, tirés de l’offre' : 'en vigueur'
  const list = set.criteria.map(c => `${c.name || 'critère ajouté'} ${c.weight}`).join(', ')
  // Espaces insécables dans les guillemets : « et le texte restent sur la même ligne.
  return `Voici les critères ${from} : ${list}. Dites-moi ce qu’il faut changer (« Kafka indispensable », « ajoutez l’anglais courant »), ou modifiez-les directement dans la liste.`
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
  /** Assistant des critères (ADR 0062) ; absent : pas d'assistant, les critères prennent toute la largeur. */
  revise?: (input: RevisionRequest) => Promise<RevisionResult>
  /** Autres intitulés proposés pour le métier de l'offre (ADR 0062) ; absent : pas de propositions. */
  suggestTitles?: (input: TitleRequest) => Promise<TitleSuggestionsResult>
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
  criteria, onChange, source, badge, notice = '', save, reset, revise, suggestTitles, title = 'Critères de matching', intro = DEFAULT_INTRO,
  savedText = 'Critères enregistrés : la section Sourcing et la publication les utiliseront.', openLabel = 'Configurer les critères',
  tone = 'site', compact = false, className = '', style,
}: DrawerProps) {
  const id = useId()
  // Version enregistrée, pour « Modifications non enregistrées » ; null : rien d'enregistré (proposition, défaut).
  const [baseline, setBaseline] = useState<string | null>(() => (source && source !== 'saved' ? null : JSON.stringify(criteria)))
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Gardés tant que la page est ouverte, panneau fermé compris : échange, demande en cours d'écriture, éléments dépliés,
  // critères changés par la dernière réponse, propositions d'intitulés par métier.
  const [welcome] = useState(() => welcomeOf(criteria, source))
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [open, setOpen] = useState<string[]>(['poste'])
  const [changed, setChanged] = useState<CriteriaChange[]>([])
  const [titles, setTitles] = useState<Record<string, TitlesState>>({})
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

  /** Propositions d'autres intitulés pour le métier principal, demandées une fois par métier (de nouveau après une erreur). */
  function loadTitles(set: OfferCriteriaSet) {
    const main = mainTitle(set)
    if (!suggestTitles || main.length < 2 || (titles[main] && titles[main].state !== 'error')) return
    setTitles(t => ({ ...t, [main]: { state: 'loading' } }))
    const poste = set.criteria.find(c => c.id === 'poste')?.labels.map(l => l.label) ?? []
    suggestTitles({ title: main, exclude: [...poste, ...set.alternativeTitles].slice(0, 20) })
      .then(res => setTitles(t => ({ ...t, [main]: res.error === undefined ? { state: 'done', titles: res.titles, note: res.note } : { state: 'error', text: res.error } })))
      .catch(() => setTitles(t => ({ ...t, [main]: { state: 'error', text: 'Propositions indisponibles : connexion perdue.' } })))
  }

  function toggle(criterionId: string) {
    const opening = !open.includes(criterionId)
    setOpen(o => (opening ? [...o, criterionId] : o.filter(x => x !== criterionId)))
    if (opening && criterionId === 'poste') loadTitles(criteria)
  }

  async function ask(text: string) {
    const message = text.trim()
    if (!revise || asking || message.length < 2) return
    const history: ChatTurn[] = chat.flatMap(e => (e.role === 'recruteur' || e.role === 'assistant' ? [{ role: e.role, text: e.text }] : [])).slice(-REVISION_LIMITS.turns)
    const before = criteria
    setChat(c => [...c, { role: 'recruteur', text: message }])
    setDraft('')
    setAsking(true)
    const res = await revise({ criteria: before, message, history })
      .catch((): RevisionResult => ({ error: 'Demande interrompue : connexion perdue, réessayez.' }))
    setAsking(false)
    if (res.error !== undefined) {
      setChat(c => [...c, { role: 'erreur', text: res.error }])
      // La demande revient dans le champ, pour la renvoyer telle quelle ou la reformuler.
      setDraft(d => d || message)
      return
    }
    const changes = criteriaChanges(before, res.criteria)
    setChat(c => [...c, { role: 'assistant', text: res.reply, changes, before, after: JSON.stringify(res.criteria) }])
    // Poids seulement ajustés en proportion : la barre des poids le montre, pas de pastille ni de dépliage.
    const touched = changes.filter(ch => ch.kind === 'added' || ch.kind === 'labels')
    setChanged(touched)
    setOpen(o => [...new Set([...o, ...touched.map(ch => ch.id)])])
    change(res.criteria)
  }

  function undo(entry: Extract<ChatEntry, { role: 'assistant' }>) {
    setChanged([])
    setChat(c => [...c, { role: 'note', text: 'Modification annulée : les critères sont revenus à leur état d’avant.' }])
    change(entry.before)
  }

  const status = saveState && (
    <p role="status" className="text-xs" style={{ color: saveState.tone === 'ok' ? OK : KO }}>{saveState.text}</p>
  )
  const labels = criteria.criteria.flatMap(c => c.labels)
  const required = labels.filter(l => l.required).length

  return (
    <Sheet onOpenChange={next => { if (next && open.includes('poste')) loadTitles(criteria) }}>
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

      <SheetContent className={`${revise ? 'max-w-[1240px]' : 'max-w-[1120px]'} ${tone === 'admin' ? 'admin-light' : ''}`}
        style={{ ...toneVars(tone), background: 'var(--admin-bg, var(--color-background))', color: 'var(--crit-fg)' }}>
        <section className="flex min-h-full flex-col lg:h-full">
          {/* Pendant une demande à l'assistant, pas de retour aux critères de l'offre : sa réponse les remplacerait. */}
          <EditorHeader title={title} source={source} badge={badge} intro={intro} notice={notice} busy={saving || asking} reset={reset && onReset && { label: reset.label, run: onReset }} />
          <div className={`lg:min-h-0 lg:flex-1 ${revise ? 'lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]' : 'lg:flex lg:flex-col'}`}>
            {revise && (
              <Assistant welcome={welcome} chat={chat} draft={draft} onDraft={setDraft} asking={asking} onAsk={ask} onUndo={undo} current={JSON.stringify(criteria)} />
            )}
            {/* Pendant une demande à l'assistant, les critères ne se modifient pas : sa réponse les remplacera. */}
            <fieldset disabled={asking} aria-busy={asking} className="min-w-0 transition-opacity disabled:opacity-60 motion-reduce:transition-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <legend className="sr-only">Critères</legend>
              <CriteriaList criteria={criteria} onChange={change} problems={problems} total={total} dirty={dirty} saving={saving} status={status}
                onSave={onSave} open={open} onToggle={toggle} onOpen={ids => setOpen(o => [...new Set([...o, ...ids])])} changed={changed}
                titles={suggestTitles ? titles[mainTitle(criteria)] ?? null : undefined} onLoadTitles={() => loadTitles(criteria)} />
            </fieldset>
          </div>
        </section>
      </SheetContent>
    </Sheet>
  )
}

/** En-tête du panneau : titre, explication, légende, retour aux critères de l'offre, fermeture. */
function EditorHeader({ title, source, badge, intro, notice, busy, reset }: {
  title: string; source?: Source; badge?: string; intro: ReactNode; notice: string; busy: boolean; reset?: { label: string; run: () => void }
}) {
  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b px-3.5 py-3.5 md:flex-row md:items-start md:gap-4 md:px-5 md:pb-3.5 md:pt-[18px]" style={{ background: 'var(--crit-panel)', borderColor: 'var(--crit-line)' }}>
      <div className="min-w-0 flex-1">
        <SheetTitle className="flex flex-wrap items-center gap-2 tracking-[-0.01em]" style={heading(17, 700)}>
          <Scale size={18} aria-hidden />{title}<SourceBadge source={source} badge={badge} />
        </SheetTitle>
        <p className="mt-1 max-w-[720px] text-[12.5px] leading-normal" style={muted}>{intro}</p>
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
          <button type="button" onClick={reset.run} disabled={busy}
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
  )
}

/** Ce que la réponse a changé, en une ligne par sorte de changement. */
function ChangesList({ changes, reply }: { changes: CriteriaChange[]; reply: string }) {
  if (changes.length === 0) {
    // Une question de l'assistant ne change rien, normal ; une réponse qui annonce un changement absent de ses critères
    // (vu avec un petit modèle de repli, 2026-11-26) est signalée : la liste à droite fait foi.
    return reply.trim().endsWith('?')
      ? <p className="mt-1.5 text-[11.5px]" style={muted}>Aucun critère changé.</p>
      : (
        <p className="mt-1.5 text-[11.5px] font-semibold" style={{ color: WARN }}>
          <AlertTriangle size={12} className="-mt-0.5 mr-1 inline" aria-hidden />
          Aucun critère n’a changé : la réponse de l’assistant ne contenait aucune modification. Reformulez votre demande, ou
          ajoutez le critère avec « + » sous la liste.
        </p>
      )
  }
  const names = (kind: CriteriaChange['kind']) => changes.filter(c => c.kind === kind).map(c => c.name || 'critère ajouté')
  const lines = [['Ajouté', names('added')], ['Modifié', names('labels')], ['Retiré', names('removed')], ['Poids ajusté', names('weight')]] as const
  return (
    <ul className="mt-1.5 space-y-0.5 text-[11.5px]" style={muted}>
      {lines.filter(([, list]) => list.length > 0).map(([label, list]) => (
        <li key={label}><b className="font-semibold" style={fg}>{label}{list.length > 1 ? 's' : ''} :</b> {list.join(', ')}</li>
      ))}
    </ul>
  )
}

/** Colonne de gauche : échange avec l'assistant et champ de la demande, avec les suggestions de MBC Search. */
function Assistant({ welcome, chat, draft, onDraft, asking, onAsk, onUndo, current }: {
  welcome: string
  chat: ChatEntry[]
  draft: string
  onDraft: (text: string) => void
  asking: boolean
  onAsk: (text: string) => void
  onUndo: (entry: Extract<ChatEntry, { role: 'assistant' }>) => void
  /** Critères affichés (JSON) : « Annuler » seulement tant qu'ils sont ceux de la dernière réponse. */
  current: string
}) {
  const id = useId()
  const input = useRef<HTMLTextAreaElement>(null)
  const lastAnswer = chat.findLastIndex(e => e.role === 'assistant')

  const addHint = (hint: string) => {
    const next = `${draft.trimEnd()}${draft.trim() ? '\n' : ''}${hint} : `.slice(0, REVISION_LIMITS.message)
    onDraft(next)
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.length, next.length)
    })
  }
  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    onAsk(draft)
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    onAsk(draft)
  }

  const bubble = 'max-w-[92%] rounded-2xl px-3 py-2 text-[12.5px] leading-normal'
  return (
    <aside aria-labelledby={`${id}-title`} className="flex flex-col border-b lg:min-h-0 lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--crit-line)', background: 'var(--crit-panel)' }}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <Sparkles size={15} color={AI} aria-hidden />
        <h3 id={`${id}-title`} style={heading(13.5, 700)}>Assistant des critères</h3>
        <span className="ml-auto text-[11px]" style={muted}>Rien n’est enregistré sans vous</span>
      </div>
      <div role="log" aria-live="polite" aria-label="Échange avec l’assistant" className="flex max-h-64 flex-col gap-2.5 overflow-y-auto px-4 pb-3 lg:max-h-none lg:flex-1">
        <p className={`${bubble} self-start border`} style={{ background: 'var(--crit-raised)', borderColor: 'var(--crit-line)', ...fg }}>{welcome}</p>
        {chat.map((e, i) => e.role === 'recruteur' ? (
          <p key={i} className={`${bubble} self-end whitespace-pre-line rounded-br-md`} style={{ background: 'var(--crit-accent-soft)', ...fg }}>{e.text}</p>
        ) : e.role === 'note' ? (
          <p key={i} className="self-center text-[11.5px]" style={muted}>{e.text}</p>
        ) : e.role === 'erreur' ? (
          <p key={i} role="alert" className={`${bubble} self-start border`} style={{ background: `${KO}0F`, borderColor: `${KO}33`, color: KO }}>
            <AlertTriangle size={13} className="-mt-0.5 mr-1 inline" aria-hidden />{e.text}
          </p>
        ) : (
          <div key={i} className={`${bubble} self-start rounded-bl-md border`} style={{ background: 'var(--crit-raised)', borderColor: 'var(--crit-line)', ...fg }}>
            <p>{e.text}</p>
            <ChangesList changes={e.changes} reply={e.text} />
            {i === lastAnswer && e.changes.length > 0 && e.after === current && (
              <button type="button" onClick={() => onUndo(e)} disabled={asking}
                className={`mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold underline disabled:opacity-50 ${focusRing}`} style={fg}>
                <Undo2 size={12} aria-hidden />Annuler cette modification
              </button>
            )}
          </div>
        ))}
        {asking && (
          <p className={`${bubble} self-start inline-flex items-center gap-2 border`} style={{ background: 'var(--crit-raised)', borderColor: 'var(--crit-line)', ...muted }}>
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden />L’assistant modifie les critères…
          </p>
        )}
      </div>
      <form onSubmit={submit} className="border-t px-3 pb-3 pt-2.5" style={{ borderColor: 'var(--crit-line)' }}>
        <div className={`rounded-xl border ${bLine} focus-within:border-[color:var(--crit-accent)] focus-within:shadow-[0_0_0_3px_var(--crit-accent-soft)]`} style={{ background: 'var(--admin-bg, var(--color-background))' }}>
          <label htmlFor={`${id}-ask`} className="sr-only">Votre demande à l’assistant des critères</label>
          <textarea id={`${id}-ask`} ref={input} rows={3} value={draft} maxLength={REVISION_LIMITS.message} onChange={e => onDraft(e.target.value)} onKeyDown={onKey}
            placeholder="Ex. : Kafka indispensable, télétravail 2 jours par semaine, anglais courant…"
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] outline-none placeholder:text-[color:var(--crit-muted)]" style={fg} />
          <div className="flex items-end gap-2 px-2 pb-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[11.5px]" style={muted}>Précisez :</span>
              {HINTS.map(h => (
                <button key={h} type="button" onClick={() => addHint(h)} className={cn(chip, 'px-2 py-0.5 text-[11.5px]')}>
                  <Plus size={12} strokeWidth={2.4} aria-hidden />{h}
                </button>
              ))}
            </div>
            <button type="submit" aria-label="Envoyer la demande" disabled={asking || draft.trim().length < 2}
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`} style={accentButtonStyle}>
              {asking ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUp size={16} strokeWidth={2.4} aria-hidden />}
            </button>
          </div>
        </div>
        <p className="mt-1.5 hidden text-[11px] sm:block" style={muted}>Entrée pour envoyer · Maj + Entrée pour aller à la ligne</p>
      </form>
    </aside>
  )
}

/** Colonne de droite : barre des poids collée en haut, critères dépliables, ajout d'un critère. */
function CriteriaList({ criteria, onChange, problems, total, dirty, saving, status, onSave, open, onToggle, onOpen, changed, titles, onLoadTitles }: {
  criteria: OfferCriteriaSet
  onChange: (next: OfferCriteriaSet) => void
  problems: string[]
  total: number
  dirty: boolean
  saving: boolean
  status: ReactNode
  onSave?: () => void
  open: string[]
  onToggle: (id: string) => void
  onOpen: (ids: string[]) => void
  /** Critères ajoutés ou modifiés par la dernière réponse de l'assistant. */
  changed: CriteriaChange[]
  /** Propositions d'autres intitulés : undefined sans propositions, null pas encore demandées pour ce métier. */
  titles: TitlesState | null | undefined
  onLoadTitles: () => void
}) {
  const id = useId()
  // Champ à placer sous le curseur après un ajout (nouveau libellé, nouveau critère).
  const [focus, setFocus] = useState('')
  const [altText, setAltText] = useState('')
  const list = criteria.criteria
  const full = list.length >= CRITERIA_LIMITS.criteria
  const present = new Set(list.map(c => c.name.toLowerCase()))
  const suggestions = [
    ...STANDARD_KEYS.filter(key => !list.some(c => c.id === key)).map(key => ({ key: key as string, name: CRITERION_NAMES[key] })),
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
    const newId = key === 'custom' ? nextCustomId(criteria) : key
    const added: OfferCriterion = { id: newId, name: isStandardKey(newId) ? CRITERION_NAMES[newId] : name, weight: 5, labels: [] }
    const weights = rescaled(list.map(c => c.weight), 95)
    setCriteria([...list.map((c, k) => ({ ...c, weight: weights[k] })), added])
    onOpen([added.id])
    if (!name && !isStandardKey(added.id)) setFocus(`name:${added.id}`)
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

  const removeButton = (c: OfferCriterion, i: number) => (
    <button type="button" onClick={() => removeCriterion(i)} disabled={list.length <= 1} aria-label={`Supprimer le critère ${c.name || 'ajouté'}`} title="Supprimer le critère"
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tMuted} ${dangerHover} disabled:opacity-40 ${focusRing}`}>
      <Trash2 size={15} aria-hidden />
    </button>
  )

  /** Libellés d'un critère replié, en une ligne : « Java ★ · Spring · Kafka ». */
  const summaryOf = (c: OfferCriterion) => {
    if (c.labels.length === 0) return 'Jugé d’après l’offre dans son ensemble'
    const text = c.labels.map(l => `${l.label || 'nouveau libellé'}${l.required ? ' ★' : ''}`).join(' · ')
    return c.id === 'poste' && criteria.alternativeTitles.length > 0 ? `${text} · ${plural(criteria.alternativeTitles.length, 'autre intitulé')}` : text
  }

  const alternatives = criteria.alternativeTitles
  const altFull = alternatives.length >= CRITERIA_LIMITS.alternatives
  const shownTitles = titles?.state === 'done'
    ? titles.titles.filter(s => !alternatives.some(a => a.toLowerCase() === s.title.toLowerCase()))
    : []

  return (
    <>
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

        <ul className="flex flex-col gap-2.5" aria-label="Critères de matching">
          {list.map((c, i) => {
            const labelsTotal = sum(c.labels.map(l => l.weight))
            const labelsOk = c.labels.length === 0 || labelsTotal === 100
            const requiredCount = c.labels.filter(l => l.required).length
            const maxLabels = c.id === 'poste' ? MAX_ROLES : CRITERIA_LIMITS.labels
            const name = c.name || 'ce critère'
            const isOpen = open.includes(c.id)
            const panelId = `${id}-${c.id}`
            const byAssistant = changed.find(ch => ch.id === c.id)?.kind
            return (
              <li key={c.id} className="overflow-hidden rounded-[14px] border"
                style={{ background: 'var(--crit-panel)', borderColor: !labelsOk ? `${KO}55` : byAssistant ? `${AI}66` : 'var(--crit-line)' }}>
                <div className="flex items-center gap-2 py-2 pl-1.5 pr-3">
                  <button type="button" aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={() => onToggle(c.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left ${hoverTint} ${focusRing}`}>
                    <ChevronRight size={16} aria-hidden className={`shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-90' : ''}`} style={muted} />
                    <Swatch color={colorOf(c)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate text-[14px] font-semibold" style={fg}>{c.name || 'Nouveau critère'}</span>
                        {byAssistant && (
                          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: `${AI}14`, color: AI }}>
                            <Sparkles size={10} aria-hidden />{byAssistant === 'added' ? 'Ajouté' : 'Modifié'} par l’assistant
                          </span>
                        )}
                        {!labelsOk && <span className="text-[11px] font-semibold" style={{ color: KO }}>libellés à {labelsTotal} / 100</span>}
                      </span>
                      <span className="mt-px block truncate text-[11.5px]" style={muted}>
                        {c.weight} % du score{requiredCount ? ` · ${requiredCount} requis` : ''} — {summaryOf(c)}
                      </span>
                    </span>
                  </button>
                  <WeightStepper value={c.weight} name={c.name || 'critère ajouté'} onChange={weight => setCriterion(i, { weight })} />
                  {removeButton(c, i)}
                </div>
                <div aria-hidden className="h-[3px]" style={{ background: 'color-mix(in srgb, var(--crit-fg) 6%, transparent)' }}>
                  <i className="block h-full" style={{ width: `${Math.min(100, c.weight)}%`, background: colorOf(c) }} />
                </div>

                {isOpen && (
                  <div id={panelId} role="region" aria-label={`Détail de ${name}`}>
                    {!isStandardKey(c.id) && (
                      <label className="flex items-center gap-2 px-3.5 pt-2.5 text-[12px]" style={muted}>
                        Nom du critère
                        <input value={c.name} maxLength={CRITERIA_LIMITS.name} placeholder="Disponibilité, Expérience bancaire…" autoFocus={focus === `name:${c.id}`}
                          onChange={e => setCriterion(i, { name: e.target.value })}
                          className={`min-w-0 flex-1 rounded-[7px] border ${bLine} bg-transparent px-2 py-1 text-[13px] font-semibold ${fieldFocus}`} style={fg} />
                      </label>
                    )}
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
                          <span className="text-[11px] font-normal normal-case tracking-normal">utilisés pour rechercher les CV · {alternatives.length} / {CRITERIA_LIMITS.alternatives}</span>
                        </p>
                        <ul className="flex flex-wrap gap-[5px]" aria-label="Autres intitulés du métier">
                          {alternatives.map(t => (
                            <li key={t} className={`inline-flex items-center gap-[5px] rounded-[7px] border ${bLine} ${bgPanel} py-[3px] pl-2 pr-1 text-[12px]`} style={fg}>
                              {t}
                              <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange({ ...criteria, alternativeTitles: alternatives.filter(x => x !== t) })}
                                className={`grid h-4 w-4 place-items-center rounded text-[13px] leading-none ${tMuted} ${dangerHover} ${focusRing}`}>×</button>
                            </li>
                          ))}
                          {!altFull && (
                            <li>
                              <input value={altText} onChange={e => setAltText(e.target.value)} onKeyDown={onAltKey} onBlur={() => addAlternatives(altText)}
                                placeholder="+ Ajouter un intitulé, Entrée" aria-label="Ajouter un autre intitulé du métier"
                                className={`min-w-[190px] rounded-[7px] border border-dashed ${bLine} bg-transparent px-2 py-[3px] text-[12px] ${fieldFocus}`} style={fg} />
                            </li>
                          )}
                        </ul>
                        {titles !== undefined && (
                          <TitleProposals state={titles} shown={shownTitles} full={altFull} main={mainTitle(criteria)} onLoad={onLoadTitles}
                            onAdd={t => onChange({ ...criteria, alternativeTitles: [...alternatives, t].slice(0, CRITERIA_LIMITS.alternatives) })} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-4 border-t border-dashed pt-3.5" style={{ borderColor: 'var(--crit-line)' }}>
          {full ? <p className="text-[12px]" style={muted}>{CRITERIA_LIMITS.criteria} critères au plus.</p> : (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[12px]" style={muted}>Ajouter un critère :</span>
              {suggestions.map(s => (
                <button key={`${s.key}:${s.name}`} type="button" onClick={() => addCriterion(s.key, s.name)} className={chip}>
                  <Plus size={12} strokeWidth={2.4} aria-hidden />{s.name}
                </button>
              ))}
              <button type="button" onClick={() => addCriterion('custom')} className={cn(chip, 'border-dashed')}>
                <Plus size={12} strokeWidth={2.4} aria-hidden />Autre critère
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Autres intitulés proposés pour le métier principal : dictionnaire de la classification, puis métiers des CV. */
function TitleProposals({ state, shown, full, main, onLoad, onAdd }: {
  state: TitlesState | null; shown: TitleSuggestion[]; full: boolean; main: string; onLoad: () => void; onAdd: (title: string) => void
}) {
  if (!main) return null
  return (
    <div className="mt-2.5 text-[12px]" style={muted}>
      {state === null ? (
        <button type="button" onClick={onLoad} className={`inline-flex items-center gap-1 font-semibold underline ${focusRing}`} style={fg}>
          <Sparkles size={12} color={AI} aria-hidden />Proposer d’autres intitulés pour « {main} »
        </button>
      ) : state.state === 'loading' ? (
        <p role="status" className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden />Recherche d’intitulés dans les CV…</p>
      ) : state.state === 'error' ? (
        <p role="status" style={{ color: KO }}>
          Propositions indisponibles : {state.text.replace(/\.$/, '')}.{' '}
          <button type="button" onClick={onLoad} className={`font-semibold underline ${focusRing}`}>Réessayer</button>
        </p>
      ) : shown.length === 0 ? (
        <p role="status">Aucun autre intitulé trouvé pour « {main} » dans le dictionnaire ni dans les CV.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5">Suggestions :</span>
          {shown.map(s => (
            <button key={s.title} type="button" disabled={full} onClick={() => onAdd(s.title)} className={chip}
              title={s.count === null ? 'Autre écriture du métier (dictionnaire de la classification des CV)' : `Porté par ${s.count} CV classés qui exercent ce métier`}>
              <Plus size={12} strokeWidth={2.4} aria-hidden />{s.title}
              {s.count !== null && <span className="font-normal tabular-nums" style={muted}>· {s.count} CV</span>}
            </button>
          ))}
        </div>
      )}
      {state?.state === 'done' && state.note && <p className="mt-1" style={{ color: WARN }}>{state.note}</p>}
    </div>
  )
}
