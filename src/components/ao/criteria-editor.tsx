import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Loader2, Plus, RotateCcw, Save, Scale, Sparkles, Star, Trash2, X } from 'lucide-react'
import { CRITERION_LABELS, MAX_ROLES } from '@/lib/match-scoring'
import {
  CRITERIA_LIMITS, STANDARD_KEYS, criteriaSetProblem, isStandardKey, nextCustomId, weightsSummingTo,
  type CriterionLabel, type OfferCriteriaSet, type OfferCriterion,
} from '@/lib/offer-criteria'

// Critères de matching d'une offre (ADR 0061, demande du 2026-11-24) : critères du barème « matching » (retirables) et
// critères ajoutés, chacun avec son poids (total 100) et ses libellés, chacun avec son poids dans le critère (total 100)
// et ★ requis. Ajouter ou retirer un critère ou un libellé garde le total à 100 (les autres sont ajustés en proportion) ;
// un poids saisi à la main peut le déséquilibrer : « Ramener à 100 ». Règles et validation : src/lib/offer-criteria.ts
// (les mêmes que celles du serveur). Utilisé avant la publication d'un AO (back-office clair, jetons --admin-*) et sur le
// Matching IA d'une offre (jetons du site) : chaque couleur lit le jeton de l'admin, sinon celui du site. Sans « use
// client » : importé seulement par des composants clients (ses props sont des fonctions).

const SOURCE_LABEL = { saved: 'Enregistrés', ai: 'Proposés par l’IA', default: 'Par défaut' } as const

const C = {
  panel: 'var(--admin-panel, var(--color-surface))',
  raised: 'var(--admin-panel-raised, color-mix(in srgb, var(--color-text) 3%, var(--color-surface)))',
  line: 'var(--admin-line, var(--color-border))',
  lineStrong: 'var(--admin-line-strong, var(--color-border))',
  fg: 'var(--admin-fg, var(--color-text))',
  muted: 'var(--admin-fg-muted, var(--color-text-muted))',
}
const control: CSSProperties = { height: 38, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}`, color: C.fg, padding: '0 12px', fontSize: 13 }
const fieldLabel: CSSProperties = { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }
const optionStyle: CSSProperties = { background: C.panel }
const secondaryButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: C.panel,
  border: `1px solid ${C.lineStrong}`, color: C.fg, fontSize: 13, fontWeight: 500, cursor: 'pointer',
}

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)
const toWeight = (text: string) => Math.max(0, Math.min(100, Math.round(Number(text)) || 0))
/** Poids ramenés à `total` en gardant leurs proportions (chacun au moins 1). */
const rescaled = (weights: number[], total = 100) => weightsSummingTo(weights.length, total, weights)

const weightInput: CSSProperties = { ...control, width: 64, padding: '0 8px', textAlign: 'right' }
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-1'
const iconButton = `inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-[color-mix(in_srgb,currentColor_10%,transparent)] disabled:opacity-40 ${focusRing}`

const DEFAULT_INTRO = 'Les CV des candidats de cette offre (base candidats, viviers, sourcing) sont notés sur ces critères : chaque libellé est jugé par l’IA, le score suit vos poids. Poids des critères : total 100 ; libellés d’un critère : total 100. ★ requis : s’il manque au candidat, son score reste sous 65 (lieu, séniorité, formation, secteur et langue sont requis par défaut, comme dans le barème). Jamais publiés ni montrés aux candidats.'

export function CriteriaEditor({
  criteria, source, notice = '', onChange, save, title = 'Critères de matching', intro = DEFAULT_INTRO,
  saveLabel = 'Enregistrer les critères', savedText = 'Critères enregistrés : la section Sourcing et la publication les utiliseront.',
  invalidSuffix = 'La publication attend des critères valides.', reset,
}: {
  criteria: OfferCriteriaSet
  /** D'où viennent les critères (pastille) ; absent : pas de pastille. */
  source?: keyof typeof SOURCE_LABEL
  /** Pourquoi l'IA n'a pas proposé les critères ; vide sinon. */
  notice?: string
  onChange: (next: OfferCriteriaSet) => void
  /** Enregistre les critères ; `message` remplace `savedText`. Absent : pas de bouton. */
  save?: (criteria: OfferCriteriaSet) => Promise<{ error?: string; message?: string }>
  title?: string
  intro?: ReactNode
  saveLabel?: string
  savedText?: string
  invalidSuffix?: string
  /** « Revenir aux critères de l'offre » (critères propres) : l'action et son libellé. */
  reset?: { label: string; run: () => Promise<{ error?: string; message?: string }> }
}) {
  const id = useId()
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // Texte saisi tel quel : une virgule tapée ne doit pas disparaître avant le mot suivant.
  const [alternatives, setAlternatives] = useState(criteria.alternativeTitles.join(', '))
  const problem = criteriaSetProblem(criteria)
  const total = sum(criteria.criteria.map(c => c.weight))
  const missing = STANDARD_KEYS.filter(key => !criteria.criteria.some(c => c.id === key))

  const change = (next: OfferCriteriaSet) => {
    setSaveState(null)
    onChange(next)
  }
  const setCriteria = (list: OfferCriterion[]) => change({ ...criteria, criteria: list })
  const setCriterion = (i: number, patch: Partial<OfferCriterion>) => setCriteria(criteria.criteria.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  const setLabels = (i: number, labels: CriterionLabel[]) => setCriterion(i, { labels })

  function removeCriterion(i: number) {
    const rest = criteria.criteria.filter((_, k) => k !== i)
    const weights = rescaled(rest.map(c => c.weight))
    setCriteria(rest.map((c, k) => ({ ...c, weight: weights[k] })))
  }

  function addCriterion(key: string) {
    const added: OfferCriterion = key === 'custom'
      ? { id: nextCustomId(criteria), name: '', weight: 5, labels: [] }
      : { id: key, name: isStandardKey(key) ? CRITERION_LABELS[key] : key, weight: 5, labels: [] }
    const weights = rescaled(criteria.criteria.map(c => c.weight), 95)
    setCriteria([...criteria.criteria.map((c, k) => ({ ...c, weight: weights[k] })), added])
  }

  function addLabel(i: number) {
    const labels = criteria.criteria[i].labels
    const share = labels.length > 0 ? sum(labels.map(l => l.weight)) / labels.length : 100
    const weights = rescaled([...labels.map(l => l.weight), share])
    setLabels(i, [...labels.map((l, k) => ({ ...l, weight: weights[k] })), { label: '', weight: weights[labels.length], required: false }])
  }

  function removeLabel(i: number, li: number) {
    const rest = criteria.criteria[i].labels.filter((_, k) => k !== li)
    const weights = rescaled(rest.map(l => l.weight))
    setLabels(i, rest.map((l, k) => ({ ...l, weight: weights[k] })))
  }

  async function run(action: () => Promise<{ error?: string; message?: string }>, done: string) {
    setSaving(true)
    setSaveState(null)
    const res = await action().catch(() => ({ error: 'Enregistrement interrompu : connexion perdue, réessayez.', message: undefined }))
    setSaving(false)
    const text = res.error ?? res.message ?? done
    setSaveState(text ? { tone: res.error ? 'error' : 'ok', text } : null)
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl p-4" style={{ background: C.raised, border: `1px solid ${C.line}` }}>
      <div>
        <h4 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-sm font-semibold" style={{ color: C.fg }}>
          <Scale size={15} aria-hidden />{title}
          {source && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: C.panel, color: C.muted }}>
              {source === 'ai' && <Sparkles size={12} aria-hidden />}{SOURCE_LABEL[source]}
            </span>
          )}
        </h4>
        <p className="mt-1 text-xs" style={{ color: C.muted }}>{intro}</p>
        {notice && (
          <p className="mt-2 text-xs" style={{ color: '#b45309' }}>
            L’IA n’a pas proposé les critères ({notice.replace(/\.$/, '')}) : critères par défaut, à compléter.
          </p>
        )}
      </div>

      <ol className="space-y-3">
        {criteria.criteria.map((c, i) => {
          const custom = !isStandardKey(c.id)
          const labelsTotal = sum(c.labels.map(l => l.weight))
          const maxLabels = c.id === 'poste' ? MAX_ROLES : CRITERIA_LIMITS.labels
          return (
            <li key={c.id} className="rounded-lg p-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="flex flex-wrap items-end gap-2">
                {custom ? (
                  <label className="min-w-0 flex-1">
                    <span style={{ ...fieldLabel, display: 'block' }}>Critère ajouté</span>
                    <input value={c.name} maxLength={CRITERIA_LIMITS.name} onChange={e => setCriterion(i, { name: e.target.value })}
                      placeholder="ex. Expérience bancaire" className={focusRing} style={{ ...control, width: '100%' }} />
                  </label>
                ) : (
                  <p className="min-w-0 flex-1 self-center text-sm font-semibold" style={{ color: C.fg }}>{c.name}</p>
                )}
                <label>
                  <span style={{ ...fieldLabel, display: 'block' }}>Poids</span>
                  <input type="number" min={1} max={100} step={1} inputMode="numeric" value={c.weight} className={focusRing}
                    onChange={e => setCriterion(i, { weight: toWeight(e.target.value) })} aria-label={`Poids du critère ${c.name || 'ajouté'}`} style={weightInput} />
                </label>
                <button type="button" onClick={() => removeCriterion(i)} disabled={criteria.criteria.length <= 1} aria-label={`Retirer le critère ${c.name || 'ajouté'}`}
                  title="Retirer le critère" className={iconButton} style={{ color: C.muted }}>
                  <Trash2 size={15} aria-hidden />
                </button>
              </div>

              {c.labels.length > 0 && (
                <ul className="mt-3 space-y-2" aria-label={`Libellés de ${c.name || 'ce critère'}`}>
                  {c.labels.map((l, li) => (
                    <li key={li} className="flex flex-wrap items-center gap-2">
                      <input value={l.label} maxLength={CRITERIA_LIMITS.label} aria-label={`Libellé ${li + 1} de ${c.name || 'ce critère'}`} className={focusRing}
                        onChange={e => setLabels(i, c.labels.map((x, k) => (k === li ? { ...x, label: e.target.value } : x)))}
                        style={{ ...control, flex: '1 1 12rem', minWidth: 0 }} />
                      <input type="number" min={1} max={100} step={1} inputMode="numeric" value={l.weight} aria-label={`Poids de « ${l.label || 'libellé'} » dans le critère`}
                        className={focusRing} onChange={e => setLabels(i, c.labels.map((x, k) => (k === li ? { ...x, weight: toWeight(e.target.value) } : x)))} style={weightInput} />
                      <button type="button" aria-pressed={l.required} onClick={() => setLabels(i, c.labels.map((x, k) => (k === li ? { ...x, required: !x.required } : x)))}
                        aria-label={`« ${l.label || 'libellé'} » requis`} title={l.required ? 'Requis : retirer ★' : 'Marquer requis (★)'}
                        className={iconButton} style={{ color: l.required ? '#c2410c' : C.muted }}>
                        <Star size={15} fill={l.required ? 'currentColor' : 'none'} aria-hidden />
                      </button>
                      <button type="button" onClick={() => removeLabel(i, li)} aria-label={`Retirer « ${l.label || 'libellé'} »`} title="Retirer le libellé"
                        className={iconButton} style={{ color: C.muted }}>
                        <X size={15} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <button type="button" onClick={() => addLabel(i)} disabled={c.labels.length >= maxLabels}
                  className={`inline-flex items-center gap-1 font-semibold disabled:opacity-40 ${focusRing}`} style={{ color: C.fg }}>
                  <Plus size={13} aria-hidden />Ajouter un libellé
                </button>
                {c.labels.length === 0 && <span style={{ color: C.muted }}>Sans libellé : jugé d’après l’offre dans son ensemble.</span>}
                {c.labels.length > 0 && labelsTotal !== 100 && (
                  <>
                    <span style={{ color: '#b91c1c' }}>Libellés : {labelsTotal} sur 100</span>
                    <button type="button" onClick={() => setLabels(i, c.labels.map((l, k) => ({ ...l, weight: rescaled(c.labels.map(x => x.weight))[k] })))}
                      className={`font-semibold underline ${focusRing}`} style={{ color: C.fg }}>Ramener à 100</button>
                  </>
                )}
              </div>

              {c.id === 'poste' && (
                <label className="mt-3 block">
                  <span style={{ ...fieldLabel, display: 'block' }}>Autres intitulés du métier (recherche des CV, séparés par des virgules)</span>
                  <input value={alternatives} placeholder="ex. Ingénieur études et développement Java" className={focusRing}
                    onChange={e => {
                      setAlternatives(e.target.value)
                      const titles = e.target.value.split(',').map(t => t.trim()).filter(Boolean).slice(0, CRITERIA_LIMITS.alternatives)
                      change({ ...criteria, alternativeTitles: titles })
                    }}
                    style={{ ...control, width: '100%' }} />
                </label>
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`${id}-add`}>Ajouter un critère</label>
        <select id={`${id}-add`} value="" disabled={criteria.criteria.length >= CRITERIA_LIMITS.criteria} className={focusRing}
          onChange={e => { if (e.target.value) addCriterion(e.target.value) }} style={{ ...control, minWidth: 220 }}>
          <option value="" style={optionStyle}>Ajouter un critère…</option>
          {missing.map(key => <option key={key} value={key} style={optionStyle}>{CRITERION_LABELS[key]}</option>)}
          <option value="custom" style={optionStyle}>Critère personnalisé</option>
        </select>
        <span className="text-xs font-semibold" style={{ color: total === 100 ? C.muted : '#b91c1c' }}>Total des poids : {total} sur 100</span>
        {total !== 100 && (
          <button type="button" onClick={() => setCriteria(criteria.criteria.map((c, k) => ({ ...c, weight: rescaled(criteria.criteria.map(x => x.weight))[k] })))}
            className={`text-xs font-semibold underline ${focusRing}`} style={{ color: C.fg }}>Ramener à 100</button>
        )}
      </div>

      <div role="status" aria-live="polite" className="space-y-2">
        {problem && <p className="text-xs" style={{ color: '#b91c1c' }}>{problem} {invalidSuffix}</p>}
        {saveState && <p className="text-xs" style={{ color: saveState.tone === 'ok' ? '#047857' : '#b91c1c' }}>{saveState.text}</p>}
      </div>
      {(save || reset) && (
        <div className="flex flex-wrap items-center gap-3">
          {save && (
            <button type="button" onClick={() => run(() => save(criteria), savedText)} disabled={saving || !!problem}
              className={focusRing} style={{ ...secondaryButton, opacity: saving || problem ? 0.5 : 1 }}>
              {saving ? <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Save size={15} aria-hidden />}
              {saveLabel}
            </button>
          )}
          {reset && (
            <button type="button" onClick={() => run(reset.run, '')} disabled={saving}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold underline disabled:opacity-50 ${focusRing}`} style={{ color: C.fg }}>
              <RotateCcw size={13} aria-hidden />{reset.label}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
