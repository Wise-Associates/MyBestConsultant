'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { filtersSummary, type CvthequeFilters } from '@/lib/cvtheque-search'
import { DESCRIPTION_MAX, NAME_MAX, type SavedSearch } from '@/lib/saved-searches'
import { createSavedSearchAction, updateSavedSearchAction } from './saved-search-actions'

// Fenêtre « Enregistrer la recherche » de la CV Thèque (ADR 0046) : nom (obligatoire), description, e-mails (activés par
// défaut), et le rappel des critères enregistrés. Recherche enregistrée ouverte : « Enregistrer les modifications » la
// remplace, « Enregistrer comme nouvelle recherche » en crée une autre.

const field = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' } as const

export function SaveSearchDialog({ open, onOpenChange, filters, current, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: CvthequeFilters
  /** Recherche enregistrée ouverte dans la liste, s'il y en a une. */
  current: SavedSearch | null
  onSaved: (search: SavedSearch, created: boolean) => void
}) {
  // Champs remplis à l'ouverture (la fenêtre est montée à nouveau à chaque ouverture : key dans la CV Thèque).
  const [name, setName] = useState(current?.name ?? '')
  const [description, setDescription] = useState(current?.description ?? '')
  const [emailAlerts, setEmailAlerts] = useState(current?.emailAlerts ?? true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const criteria = filtersSummary(filters)

  function save(asNew: boolean) {
    setError(null)
    startTransition(async () => {
      const input = { name, description, emailAlerts, filters }
      const res = current && !asNew ? await updateSavedSearchAction(current.id, input) : await createSavedSearchAction(input)
      if (res.error || !res.search) {
        setError(res.error ?? 'L’enregistrement a échoué. Réessayez.')
        return
      }
      onSaved(res.search, !current || asNew)
    })
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 700 }}>{current ? 'Modifier la recherche' : 'Enregistrer la recherche'}</DialogTitle>
          <DialogDescription style={{ color: 'var(--color-text-muted)' }}>
            Les nouveaux candidats qui répondront à ces critères apparaîtront dans vos alertes, et par e-mail si vous le souhaitez.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={e => { e.preventDefault(); save(false) }}>
          <div>
            <label htmlFor="ss-name" className="block text-[13px] font-semibold mb-1.5">Nom de la recherche</label>
            <input id="ss-name" value={name} onChange={e => setName(e.target.value)} maxLength={NAME_MAX} required autoFocus
              placeholder="Ex. : Modeleurs Revit seniors — Madagascar"
              className="w-full h-10 px-3 rounded-lg text-sm outline-none focus:border-[var(--color-brand-orange)]" style={field} />
          </div>
          <div>
            <label htmlFor="ss-description" className="block text-[13px] font-semibold mb-1.5">
              Description <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>(facultative)</span>
            </label>
            <textarea id="ss-description" value={description} onChange={e => setDescription(e.target.value)} maxLength={DESCRIPTION_MAX} rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y focus:border-[var(--color-brand-orange)]" style={field} />
          </div>
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={emailAlerts} onChange={e => setEmailAlerts(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-orange)]" />
            <span>Recevoir un e-mail pour chaque nouveau candidat</span>
          </label>

          <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
            <p className="font-semibold mb-1">Critères enregistrés</p>
            <ul className="space-y-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {criteria.map(c => <li key={c}>{c}</li>)}
            </ul>
          </div>

          {error && <p role="alert" className="text-xs" style={{ color: '#b91c1c' }}>{error}</p>}

          <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-end">
            {current && (
              <button type="button" onClick={() => save(true)} disabled={pending}
                className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ ...field, background: 'transparent' }}>
                Enregistrer comme nouvelle recherche
              </button>
            )}
            <button type="submit" disabled={pending || !name.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {current ? 'Enregistrer les modifications' : 'Enregistrer'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
