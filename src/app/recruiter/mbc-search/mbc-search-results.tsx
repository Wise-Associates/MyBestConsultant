// Composant client : importé seulement par mbc-search-client.tsx (« use client »), qui en fait du code navigateur.
import { Bookmark, Check, ExternalLink, Loader2, Mail, RotateCcw, SlidersHorizontal, Star, UserRound } from 'lucide-react'
import { REVEAL_BATCH, SENIORITIES, requiredSkillsOf, type MbcCriteria, type ScoredProfile, type Seniority } from '@/lib/mbc-search/rules'
import { Avatar, ChipField, Toggle, orangeTint, surface, type Reveal, type SaveButton } from './mbc-search-ui'

// Profils trouvés, dans le fil de la conversation de MBC Search : lignes classées par score (révéler, enregistrer,
// ouvrir le profil), sélection pour « Révéler la sélection », pages, et critères de la recherche, modifiables à la main.

/** Score sur 100 dans un anneau rempli d'autant. */
function ScoreRing({ score }: { score: number }) {
  return (
    <span className="relative inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0" aria-label={`Score : ${score} sur 100`}
      style={{ background: `conic-gradient(var(--color-brand-orange) ${score}%, var(--color-border) 0)` }}>
      <span className="absolute inset-1 rounded-full" style={{ background: 'var(--color-surface)' }} />
      <span className="relative text-sm font-bold" style={{ color: 'var(--color-text)' }}>{score}</span>
    </span>
  )
}

/** Pastilles des critères : remplis en couleur, manqués barrés. */
function CriteriaPills({ p, criteria }: { p: ScoredProfile; criteria: MbcCriteria }) {
  const pills: { label: string; ok: boolean }[] = []
  if (p.match.title !== 'any') pills.push({ label: 'Intitulé', ok: p.match.title !== 'none' })
  for (const s of criteria.skills.slice(0, 3)) pills.push({ label: s, ok: p.match.skills.includes(s) })
  pills.push({ label: 'E-mail', ok: p.hasEmail }, { label: 'Récent', ok: p.match.fresh })
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Critères remplis">
      {pills.map(c => (
        <li key={c.label} className="text-xs px-1.5 py-0.5 rounded font-semibold"
          style={c.ok ? { background: orangeTint(12), color: 'var(--color-text)' } : { color: 'var(--color-text-muted)', textDecoration: 'line-through', fontWeight: 500 }}>
          {c.label}<span className="sr-only">{c.ok ? ' : rempli' : ' : non rempli'}</span>
        </li>
      ))}
    </ul>
  )
}

export function ResultRow({ p, criteria, reveal, active, selected, save, inVivier, busy, onOpen, onSelect, onReveal }: {
  p: ScoredProfile; criteria: MbcCriteria; reveal?: Reveal; active: boolean; selected: boolean; save: SaveButton; inVivier: boolean; busy: boolean
  onOpen: () => void; onSelect: () => void; onReveal: () => void
}) {
  const full = reveal?.state === 'done' ? reveal.profile : null
  const name = full?.name || [p.firstName, p.lastNameMasked].filter(Boolean).join(' ') || 'Profil sans nom'
  const iconBtn = 'inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
  return (
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,13rem)_auto_auto] items-center gap-x-3 gap-y-2 px-4 py-3"
      style={{ borderTop: '1px solid var(--color-border)', background: active ? orangeTint(6) : undefined }}>
      <input type="checkbox" checked={selected} onChange={onSelect} disabled={Boolean(full) || reveal?.state === 'missing'}
        aria-label={`Sélectionner ${name}`} className="w-4 h-4 accent-[var(--color-brand-orange)] disabled:opacity-30" />
      <Avatar name={name} photoUrl={full?.photoUrl} />
      <button type="button" onClick={onOpen} className="min-w-0 text-left" aria-current={active ? 'true' : undefined}>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
            {full ? name : <>{p.firstName || 'Profil'} <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{p.lastNameMasked}</span></>}
          </span>
          {full && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: orangeTint(14), color: 'var(--color-text)' }}>Révélé</span>}
          {inVivier && <span className="text-xs font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' }}><Check className="h-3 w-3" /> Dans votre vivier</span>}
          {reveal?.state === 'missing' && <span className="text-xs px-1.5 py-0.5 rounded" style={{ ...surface, color: 'var(--color-text-muted)' }}>Introuvable chez Apollo</span>}
        </span>
        <span className="block text-sm truncate" style={{ color: 'var(--color-text-muted)' }}>{[full?.title || p.title, full?.company || p.company].filter(Boolean).join(' · ')}</span>
        {full?.location && <span className="block text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{full.location}</span>}
      </button>
      <div className="col-start-3 col-span-2 sm:col-start-auto sm:col-span-1 row-start-2 sm:row-start-auto"><CriteriaPills p={p} criteria={criteria} /></div>
      <div className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto"><ScoreRing score={p.score} /></div>
      <div className="hidden sm:flex items-center gap-1.5 justify-end">
        <button type="button" onClick={save.onToggle} disabled={save.disabled} aria-pressed={save.saved}
          aria-label={save.saved ? `Retirer ${name} de votre sélection` : `Enregistrer ${name}${full ? '' : ' (révèle le profil : 1 crédit)'}`}
          title={save.reason ?? (save.saved ? 'Retirer de votre sélection' : full ? 'Enregistrer dans votre sélection' : 'Enregistrer : révèle le profil (1 crédit)')}
          className={`${iconBtn} disabled:opacity-40`} style={save.saved ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-brand-orange)' } : { ...surface, color: 'var(--color-text-muted)' }}>
          {save.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" fill={save.saved ? 'currentColor' : 'none'} />}
        </button>
        {full ? (
          <>
            {full.linkedinUrl
              ? <a href={full.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`LinkedIn de ${name}`} className={`${iconBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}><ExternalLink className="h-4 w-4" /></a>
              : <span className={iconBtn} />}
            {full.email
              ? <a href={`mailto:${full.email}`} aria-label={`Écrire à ${name}`} className={`${iconBtn} no-underline`} style={{ ...surface, color: 'var(--color-text)' }}><Mail className="h-4 w-4" /></a>
              : <span className={iconBtn} />}
          </>
        ) : reveal?.state !== 'missing' && (
          <button type="button" onClick={onReveal} disabled={busy || reveal?.state === 'loading' || save.saving}
            className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-bold disabled:opacity-40 whitespace-nowrap" style={{ ...surface, color: 'var(--color-text)' }}>
            {reveal?.state === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserRound className="h-3.5 w-3.5" />} Révéler · 1
          </button>
        )}
      </div>
    </li>
  )
}

/** Critères de la recherche en puces, en une ligne lisible (compétences obligatoires marquées d'une étoile). */
export function CriteriaSummary({ criteria }: { criteria: MbcCriteria }) {
  const required = requiredSkillsOf(criteria).map(s => s.toLowerCase())
  const chips: { key: string; label: string; star?: boolean }[] = [
    ...criteria.titles.map(t => ({ key: `t-${t}`, label: t })),
    ...criteria.skills.map(s => ({ key: `s-${s}`, label: s, star: required.includes(s.toLowerCase()) })),
    ...criteria.locations.map(l => ({ key: `l-${l}`, label: l })),
    ...criteria.seniorities.map(s => ({ key: `n-${s}`, label: SENIORITIES[s] })),
    ...(criteria.sectors ?? []).map(s => ({ key: `c-${s}`, label: s })),
    ...(criteria.emailOnly ? [{ key: 'email', label: 'E-mail disponible' }] : []),
    ...(criteria.recentOnly ? [{ key: 'recent', label: 'Mis à jour < 6 mois' }] : []),
  ]
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Critères de la recherche">
      {chips.map(c => (
        <li key={c.key} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
          style={c.star ? { background: orangeTint(12), border: '1px solid var(--color-brand-orange)', color: 'var(--color-text)' } : { ...surface, color: 'var(--color-text)' }}>
          {c.star && <Star className="h-3 w-3" fill="currentColor" style={{ color: 'var(--color-brand-orange)' }} aria-label="obligatoire" />}
          {c.label}
        </li>
      ))}
    </ul>
  )
}

/** Critères modifiables à la main, puis « Relancer » (aussi utilisé sans brief : critères saisis par le recruteur). */
export function CriteriaEditor({ criteria, onChange, onRun, running, disabled, problem, runLabel }: {
  criteria: MbcCriteria; onChange: (c: MbcCriteria) => void; onRun: () => void; running: boolean; disabled: boolean
  problem: string | null; runLabel: string
}) {
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const toggleRequired = (skill: string) => {
    const req = requiredSkillsOf(criteria)
    const on = req.some(r => r.toLowerCase() === skill.toLowerCase())
    onChange({ ...criteria, requiredSkills: on ? req.filter(r => r.toLowerCase() !== skill.toLowerCase()) : [...req, skill] })
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 p-4" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-background)' }}>
      <ChipField id="mbc-titles" label="Intitulés" hint="1 au moins" placeholder="ex : Data Engineer" values={criteria.titles}
        onChange={v => onChange({ ...criteria, titles: v })} />
      <ChipField id="mbc-skills" label="Compétences" hint="★ = obligatoire" placeholder="ex : Spark" values={criteria.skills}
        onChange={v => onChange({ ...criteria, skills: v })} starred={requiredSkillsOf(criteria)} onStar={toggleRequired} />
      <ChipField id="mbc-locations" label="Lieu" placeholder="ex : Lyon, France" values={criteria.locations}
        onChange={v => onChange({ ...criteria, locations: v })} />
      <ChipField id="mbc-sectors" label="Secteur de l'employeur" hint="en anglais" placeholder="ex : Banking" values={criteria.sectors ?? []}
        onChange={v => onChange({ ...criteria, sectors: v })} />
      <fieldset className="sm:col-span-2">
        <legend className="text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>Séniorité</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SENIORITIES) as Seniority[]).map(s => {
            const on = criteria.seniorities.includes(s)
            return (
              <button key={s} type="button" onClick={() => onChange({ ...criteria, seniorities: toggleIn(criteria.seniorities, s) as Seniority[] })} aria-pressed={on}
                className="px-2.5 py-1 rounded-full text-xs font-semibold"
                style={on ? { background: orangeTint(12), color: 'var(--color-text)', border: '1px solid var(--color-brand-orange)' } : { ...surface, color: 'var(--color-text-muted)' }}>
                {SENIORITIES[s]}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div className="sm:col-span-2 grid gap-x-6 sm:grid-cols-2">
        <Toggle label="E-mail disponible seulement" checked={criteria.emailOnly ?? false} onChange={v => onChange({ ...criteria, emailOnly: v })} />
        <Toggle label="Mis à jour depuis moins de 6 mois" checked={criteria.recentOnly ?? false} onChange={v => onChange({ ...criteria, recentOnly: v })} />
      </div>
      <div className="sm:col-span-2 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onRun} disabled={disabled || Boolean(problem)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40"
          style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} {runLabel}
        </button>
        {problem && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{problem}</p>}
      </div>
    </div>
  )
}

/** Bloc des profils de la dernière recherche, dans le fil : en-tête, critères, lignes, pages. */
export function ResultsBlock({
  total, page, lastPage, listed, hiddenByRecent, criteria, busy, editing, onToggleEditing, editor, selectable, selected, quotaLeft,
  renderRow, onSelectAll, onRevealSelection, onPage,
}: {
  total: number; page: number; lastPage: number; listed: ScoredProfile[]; hiddenByRecent: number; criteria: MbcCriteria; busy: boolean
  editing: boolean; onToggleEditing: () => void; editor: React.ReactNode
  selectable: string[]; selected: string[]; quotaLeft: number | null
  renderRow: (p: ScoredProfile) => React.ReactNode
  onSelectAll: (ids: string[]) => void; onRevealSelection: () => void; onPage: (page: number) => void
}) {
  const allSelected = selectable.length > 0 && selectable.every(id => selected.includes(id))
  const short = quotaLeft !== null && quotaLeft < selected.length
  return (
    <section className="rounded-2xl overflow-hidden" style={surface} aria-label="Profils trouvés" aria-busy={busy}>
      <div className="px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <strong style={{ color: 'var(--color-text)' }}>{total.toLocaleString('fr-FR')} profil{total > 1 ? 's' : ''}</strong>
            {lastPage > 0 && <> · page {page} sur {lastPage}</>} · classés par score
          </p>
          <span className="flex-1" />
          <button type="button" onClick={onToggleEditing} aria-expanded={editing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ ...surface, color: 'var(--color-text)' }}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> {editing ? 'Fermer les critères' : 'Modifier les critères'}
          </button>
        </div>
        <CriteriaSummary criteria={criteria} />
      </div>
      {editing && editor}

      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        {selectable.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
            <input type="checkbox" checked={allSelected} className="w-4 h-4 accent-[var(--color-brand-orange)]"
              onChange={() => onSelectAll(allSelected ? [] : selectable.slice(0, REVEAL_BATCH))} />
            {selected.length > 0 ? `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}` : `Tout sélectionner (${REVEAL_BATCH} au plus)`}
          </label>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onRevealSelection} disabled={busy || selected.length === 0 || short}
          title={short && quotaLeft !== null ? `Il vous reste ${quotaLeft} profil${quotaLeft > 1 ? 's' : ''} complet${quotaLeft > 1 ? 's' : ''} aujourd'hui.` : undefined}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 whitespace-nowrap"
          style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          <UserRound className="h-3.5 w-3.5" /> Révéler {selected.length > 0 ? `la sélection · ${selected.length} crédit${selected.length > 1 ? 's' : ''}` : 'la sélection'}
        </button>
      </div>

      {listed.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
          {hiddenByRecent > 0
            ? 'Aucun profil récent sur cette page : retirez le filtre « Mis à jour depuis moins de 6 mois » ou passez à la page suivante.'
            : 'Aucun profil pour ces critères. Dites-moi ce qui peut être assoupli (lieu, séniorité, compétence obligatoire), ou modifiez les critères.'}
        </p>
      ) : (
        <ul style={{ opacity: busy ? 0.5 : 1 }}>{listed.map(renderRow)}</ul>
      )}

      <nav className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 text-xs" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }} aria-label="Pages de résultats">
        <span>
          Nom de famille masqué tant que le profil n’est pas révélé
          {hiddenByRecent > 0 ? ` · ${hiddenByRecent} profil${hiddenByRecent > 1 ? 's' : ''} ancien${hiddenByRecent > 1 ? 's' : ''} masqué${hiddenByRecent > 1 ? 's' : ''}` : ''}
        </span>
        {lastPage > 1 && (
          <span className="flex gap-2">
            <button type="button" onClick={() => onPage(page - 1)} disabled={busy || page <= 1}
              className="px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>Précédente</button>
            <button type="button" onClick={() => onPage(page + 1)} disabled={busy || page >= lastPage}
              className="px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40" style={{ ...surface, color: 'var(--color-text)' }}>Suivante</button>
          </span>
        )}
      </nav>
    </section>
  )
}
