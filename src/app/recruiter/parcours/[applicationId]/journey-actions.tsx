'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, ExternalLink, Loader2, Play, RotateCcw, Undo2, XCircle } from 'lucide-react'
import type { JourneyAction, JourneyPieceKey, PieceTone } from '@/lib/consultant-journey'
import { consultantJourneyAction, startConsultantJourneyAction, type JourneyActionResult } from '../actions'

export interface PieceActionView {
  piece: JourneyPieceKey
  status: string
  label: string
  tone: PieceTone
}

interface Props {
  applicationId: string
  /** null : parcours pas encore démarré. */
  version: number | null
  abandoned: boolean
  advance: { label: string; blockedReason: string | null } | null
  canGoBack: boolean
  pieceActions: PieceActionView[]
  /** Outils existants de l'étape (pipeline, entretiens IA, fiche candidat…). */
  links: { href: string; label: string }[]
}

const TONE_COLOR: Record<PieceTone, string> = { pending: 'var(--color-text)', success: '#047857', danger: '#b91c1c' }

const base = 'w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
const outline = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const primary = { background: 'var(--color-brand-orange)', color: '#1C1C1E', outlineColor: 'var(--color-brand-orange)' }

export function JourneyActions({ applicationId, version, abandoned, advance, canGoBack, pieceActions, links }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abandoning, setAbandoning] = useState(false)
  const [note, setNote] = useState('')

  function run(key: string, call: () => Promise<JourneyActionResult>) {
    setError(null)
    setRunning(key)
    startTransition(async () => {
      const result = await call()
      if (!result.ok) setError(result.error)
      else setAbandoning(false)
      // Relue aussi après un refus : la page montre alors l'état enregistré (autre recruteur, autre onglet).
      router.refresh()
      setRunning(null)
    })
  }

  const act = (key: string, action: JourneyAction) =>
    run(key, () => consultantJourneyAction(applicationId, version, action))
  const spinner = (key: string) => running === key && pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null

  return (
    <section aria-labelledby="journey-actions-title" className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <h2 id="journey-actions-title" className="text-sm" style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: '0.95rem' }}>Actions</h2>

      {error && (
        <p role="alert" className="text-xs rounded-lg px-3 py-2" style={{ background: 'rgba(185,28,28,0.08)', color: '#b91c1c' }}>{error}</p>
      )}

      {version === null ? (
        <button type="button" className={base} style={primary} disabled={pending}
          onClick={() => run('start', () => startConsultantJourneyAction(applicationId))}>
          {spinner('start') ?? <Play className="h-4 w-4" aria-hidden />} Démarrer le parcours
        </button>
      ) : abandoned ? (
        <button type="button" className={base} style={primary} disabled={pending} onClick={() => act('resume', { type: 'resume' })}>
          {spinner('resume') ?? <RotateCcw className="h-4 w-4" aria-hidden />} Reprendre le parcours
        </button>
      ) : (
        <>
          {advance && (
            <div className="space-y-1">
              <button type="button" className={base} style={primary} disabled={pending || advance.blockedReason !== null}
                aria-describedby={advance.blockedReason ? 'journey-advance-blocked' : undefined}
                onClick={() => act('advance', { type: 'advance' })}>
                {advance.label} {spinner('advance') ?? <ArrowRight className="h-4 w-4" aria-hidden />}
              </button>
              {advance.blockedReason && (
                <p id="journey-advance-blocked" className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{advance.blockedReason}</p>
              )}
            </div>
          )}
          {pieceActions.map(a => (
            <button key={`${a.piece}:${a.status}`} type="button" className={base} style={{ ...outline, color: TONE_COLOR[a.tone] }}
              disabled={pending} onClick={() => act(`${a.piece}:${a.status}`, { type: 'piece', piece: a.piece, status: a.status })}>
              {spinner(`${a.piece}:${a.status}`)} {a.label}
            </button>
          ))}
        </>
      )}

      {links.length > 0 && (
        <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {links.map(link => (
            <Link key={link.href} href={link.href} className={`${base} no-underline hover:bg-[rgba(11,29,81,0.03)]`} style={outline}>
              {link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      {version !== null && !abandoned && (
        <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {canGoBack && (
            <button type="button" className={base} style={{ ...outline, color: 'var(--color-text-muted)' }} disabled={pending}
              onClick={() => act('back', { type: 'back' })}>
              {spinner('back') ?? <Undo2 className="h-4 w-4" aria-hidden />} Revenir à l’étape précédente
            </button>
          )}
          {abandoning ? (
            <div className="space-y-2">
              <label htmlFor="journey-abandon-note" className="block text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                Motif de l’abandon (facultatif)
              </label>
              <textarea id="journey-abandon-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                className="w-full rounded-lg px-3 py-2 text-sm" style={{ ...outline, fontWeight: 400 }} />
              <div className="flex gap-2">
                <button type="button" className={base} style={{ ...outline, color: '#b91c1c' }} disabled={pending}
                  onClick={() => act('abandon', { type: 'abandon', note })}>
                  {spinner('abandon')} Confirmer l’abandon
                </button>
                <button type="button" className={base} style={outline} disabled={pending} onClick={() => setAbandoning(false)}>Annuler</button>
              </div>
            </div>
          ) : (
            <button type="button" className={base} style={{ ...outline, color: '#b91c1c' }} disabled={pending} onClick={() => setAbandoning(true)}>
              <XCircle className="h-4 w-4" aria-hidden /> Abandonner le parcours
            </button>
          )}
        </div>
      )}
    </section>
  )
}
