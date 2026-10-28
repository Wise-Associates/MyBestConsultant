'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, SearchX } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { primaryButton, secondaryButton } from '@/app/admin/candidats/labels'
import { VIVIER_MATCH_MIN_SCORE, matchingOffers, newOffersFor } from '@/lib/vivier-matching'
import { syncVivierCvMatching, type VivierCv } from './actions'

// Vivier général : bouton et fenêtre des CV qui ne correspondent à aucune offre ouverte. « Synchroniser » les compare,
// un par un, aux offres ouvertes publiées depuis leur dernière comparaison. La boucle appartient à ce composant, monté
// tant que le vivier a des CV : elle continue si la fenêtre est fermée, et le bouton affiche alors la progression.
export function UnmatchedCvs({ cvs, openOffers, onUpdated }: {
  /** CV au profil créé et sans offre correspondante. */
  cvs: VivierCv[]
  openOffers: { $id: string; title: string }[]
  onUpdated: (cv: VivierCv) => void
}) {
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const stopRef = useRef(false)

  const rows = cvs.map(cv => ({ cv, fresh: newOffersFor(cv.offerScores, openOffers).length }))
  const toSync = rows.filter(r => r.fresh > 0).map(r => r.cv)

  async function sync() {
    const openIds = new Set(openOffers.map(o => o.$id))
    const targets = toSync
    stopRef.current = false
    setStopping(false)
    setResult(null)
    setProgress({ done: 0, total: targets.length })
    let done = 0
    let found = 0
    let error = ''
    try {
      for (const cv of targets) {
        if (stopRef.current) break
        const res = await syncVivierCvMatching(cv.$id)
        if (res.cv) {
          onUpdated(res.cv)
          if (matchingOffers(res.cv.offerScores, openIds).length > 0) found++
        }
        done++
        setProgress({ done, total: targets.length })
        // Refus (adresse non vérifiée, quota du jour) ou IA indisponible : les CV suivants échoueraient de même.
        if (res.error) { error = res.error; break }
      }
    } catch (e) {
      // Appel interrompu (réseau, délai dépassé, site redéployé) : la boucle s'arrête, l'erreur est affichée.
      console.error('Vivier : synchronisation interrompue', e)
      error = 'La synchronisation a été interrompue (connexion ou serveur indisponible). Rechargez la page puis réessayez.'
    } finally {
      setProgress(null)
      setStopping(false)
    }
    const summary = found > 0
      ? `${found} CV correspond${found > 1 ? 'ent' : ''} désormais à une offre.`
      : 'Aucun CV comparé ne correspond aux nouvelles offres.'
    if (error) setResult({ ok: false, text: done > 1 ? `${error} ${summary}` : error })
    else setResult({ ok: true, text: done < targets.length ? `Synchronisation arrêtée. ${summary}` : summary })
  }

  function stop() {
    stopRef.current = true
    setStopping(true)
  }

  const nothingToSync = toSync.length === 0

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={cvs.length === 0 && !progress}
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
        style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#92400e' }}>
        {progress ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <SearchX className="h-4 w-4" aria-hidden />}
        {progress ? `Synchronisation ${progress.done}/${progress.total}` : `Sans offre correspondante (${cvs.length})`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="admin-light sm:max-w-130 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--admin-panel)' }}>
          <DialogHeader>
            <DialogTitle className="text-admin-fg" style={{ fontSize: '1.05rem' }}>CV sans offre correspondante</DialogTitle>
            <DialogDescription style={{ color: 'var(--admin-fg-muted)' }}>
              Aucune de vos offres ouvertes n&apos;atteint {VIVIER_MATCH_MIN_SCORE}/100 pour ces CV. « Synchroniser » les compare aux
              offres publiées depuis leur dernière comparaison.
            </DialogDescription>
          </DialogHeader>

          {rows.length === 0 ? (
            <p className="text-sm text-admin-fg-muted">Tous vos CV correspondent à au moins une offre ouverte.</p>
          ) : (
            <ul className="divide-y divide-admin-line rounded-lg border border-admin-line">
              {rows.map(({ cv, fresh }) => (
                <li key={cv.$id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-admin-fg">{cv.candidateName || cv.fileName}</p>
                    {cv.title && <p className="truncate text-xs text-admin-fg-muted">{cv.title}</p>}
                  </div>
                  <span className="shrink-0 text-xs font-semibold" style={{ color: fresh > 0 ? '#b45309' : 'var(--admin-fg-muted)' }}>
                    {fresh > 0 ? `${fresh} nouvelle${fresh > 1 ? 's' : ''} offre${fresh > 1 ? 's' : ''}` : 'À jour'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div aria-live="polite">
            {progress && (
              <p className="flex items-center gap-2 text-sm text-admin-fg">
                <Loader2 size={15} className="animate-spin shrink-0" aria-hidden />
                {stopping ? 'Arrêt après le CV en cours…' : `Comparaison du CV ${Math.min(progress.done + 1, progress.total)} sur ${progress.total}…`}
              </p>
            )}
            {result && (
              <p className="flex items-start gap-2 text-sm" style={{ color: result.ok ? '#047857' : '#b91c1c' }}>
                {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
                {result.text}
              </p>
            )}
          </div>

          <DialogFooter>
            {progress ? (
              <button type="button" onClick={stop} disabled={stopping} style={{ ...secondaryButton, justifyContent: 'center' }}>Arrêter</button>
            ) : (
              <button type="button" onClick={() => setOpen(false)} style={{ ...secondaryButton, justifyContent: 'center' }}>Fermer</button>
            )}
            <button type="button" onClick={sync} disabled={!!progress || nothingToSync}
              style={{ ...primaryButton, justifyContent: 'center', opacity: progress || nothingToSync ? 0.6 : 1 }}>
              {progress ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
              {nothingToSync ? 'Aucune nouvelle offre' : `Synchroniser (${toSync.length} CV)`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
