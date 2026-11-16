'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { criteriaOf } from '@/lib/score-breakdown'
import { DEFAULT_WEIGHTS, type ScaleWeights } from '@/lib/scoring-weights'
import type { ActiveScale } from '@/lib/match-scoring'
import { saveScoringWeightsAction } from './actions'

// Poids personnels du recruteur (demande du 2026-11-16, scoring-weights.ts) : un champ par critère du barème de la page,
// total de 100 exigé, poids par défaut en un clic. Enregistrés sur son compte : ils valent pour toutes ses offres.
// Un barème par page (même demande) : le matching sur le Matching IA d'une offre, le score final (screening) sur son pipeline.

const COPY: Record<ActiveScale, { title: string; scope: string }> = {
  matching: { title: 'Pondération du matching', scope: 'les scores du Matching IA (base candidats, viviers)' },
  final: { title: 'Pondération du screening', scope: 'les scores finals des candidats du pipeline' },
}

const toDraft = (w: ScaleWeights): Record<string, string> => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, String(v)]))

/** Poids saisis : null si un champ n'est pas un entier de 0 à 100. */
function readDraft(values: Record<string, string>): Record<string, number> | null {
  const entries = Object.entries(values).map(([k, v]) => [k, /^\d{1,3}$/.test(v.trim()) ? Number(v) : NaN] as const)
  return entries.every(([, n]) => Number.isInteger(n) && n <= 100) ? Object.fromEntries(entries) : null
}

const field = { background: 'var(--color-background, #fff)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

/** `weights` : les poids du recruteur pour le barème `scale` (ceux par défaut s'il n'en a pas). */
export function ScoringWeightsButton({ scale, weights, unreadable }: { scale: ActiveScale; weights: ScaleWeights; unreadable: boolean }) {
  const router = useRouter()
  const idPrefix = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => toDraft(weights))
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const read = readDraft(draft)
  const total = read ? Object.values(read).reduce((sum, n) => sum + n, 0) : null
  const changed = JSON.stringify(read) !== JSON.stringify(weights)

  const openDialog = (next: boolean) => {
    if (next) { setDraft(toDraft(weights)); setError(null) }
    setOpen(next)
  }

  const save = () => startSaving(async () => {
    setError(null)
    const res = await saveScoringWeightsAction(scale, read)
    if (res.error) { setError(res.error); return }
    setOpen(false)
    // Les scores de la page sont recalculés par le serveur avec les nouveaux poids.
    router.refresh()
  })

  return (
    <>
      <button type="button" onClick={() => openDialog(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hero-fg)]"
        style={{ background: 'var(--hero-control)', color: 'var(--hero-fg)', border: '1px solid var(--hero-line)' }}>
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Pondération
      </button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <DialogHeader>
            <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 700 }}>{COPY[scale].title}</DialogTitle>
            <DialogDescription style={{ color: 'var(--color-text-muted)' }}>
              Vos poids, pour toutes vos offres : {COPY[scale].scope} sont recalculés avec eux, sans nouvelle analyse.
              Total de 100 points. Un critère essentiel qui manque plafonne toujours le score ; les e-mails automatiques
              et le vivier général gardent les poids par défaut.
            </DialogDescription>
          </DialogHeader>

          {unreadable && (
            <p role="status" className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
              Vos poids n’ont pas pu être lus : les scores affichés utilisent les poids par défaut.
            </p>
          )}

          <fieldset className="min-w-0">
            <legend className="sr-only">{COPY[scale].title}</legend>
            <ul className="flex flex-col gap-1.5">
              {criteriaOf(scale).map(c => {
                const id = `${idPrefix}-${c.key}`
                return (
                  <li key={c.key} className="flex items-center gap-2 text-[13px]">
                    <label htmlFor={id} className="flex-1 min-w-0 truncate" title={c.help}>
                      {c.label}
                      {c.capped && <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>essentiel</span>}
                    </label>
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>défaut {DEFAULT_WEIGHTS[scale][c.key]}</span>
                    <input id={id} type="number" inputMode="numeric" min={0} max={100} step={1} value={draft[c.key] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value }))}
                      className="w-16 h-8 px-2 rounded-lg text-right tabular-nums text-[13px]" style={field} />
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-xs font-semibold tabular-nums" role="status"
              style={{ color: total === 100 ? 'var(--color-text-muted)' : '#b91c1c' }}>
              Total : {total ?? '—'} / 100{total !== 100 && ' — à ajuster'}
            </p>
          </fieldset>

          {error && <p role="alert" className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}

          <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
            <button type="button" onClick={() => setDraft(toDraft(DEFAULT_WEIGHTS[scale]))} disabled={saving}
              className="text-xs font-semibold underline disabled:opacity-40" style={{ color: 'var(--color-text-muted)' }}>
              Revenir aux poids par défaut
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openDialog(false)} disabled={saving}
                className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ ...field, background: 'transparent' }}>
                Annuler
              </button>
              <button type="button" onClick={save} disabled={total !== 100 || !changed || saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-40"
                style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Enregistrer
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
