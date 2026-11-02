'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Share2, AlertTriangle, Check, Clock } from 'lucide-react'
import { NETWORK_LABEL, type Network } from '@/lib/social-content'
import type { JobState } from '@/lib/recruiter-dashboard'
import { publishJobToSocialAction } from './actions'

export interface SocialInfo {
  stale?: boolean
  status: 'queued' | 'sent' | 'images_ready' | 'published' | 'partial' | 'failed'
  results: { network: Network; status: 'published' | 'scheduled' | 'failed' | 'skipped'; url?: string }[]
  /** Âge de la dernière diffusion (« il y a 3 j »), calculé par la page. */
  age?: string
}

const WORKING = ['queued', 'sent', 'images_ready']

export interface Publish { pending: boolean; message: string | null; run: (again: boolean) => void }

/** Lancer (ou relancer) la diffusion d'une offre ; partagé par la colonne « Diffusion » et le menu de la ligne. */
export function usePublish(jobId: string): Publish {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  function run(again: boolean) {
    setMessage(null)
    start(async () => {
      try {
        const r = await publishJobToSocialAction(jobId, again)
        if (!r.ok) setMessage(r.message)
      } catch {
        setMessage('La diffusion n’a pas pu être lancée. Réessayez dans quelques minutes.')
      }
      router.refresh()
    })
  }
  return { pending, message, run }
}

const line = 'inline-flex items-center gap-1.5 text-xs'
const linkButton = 'font-semibold underline underline-offset-2 cursor-pointer bg-transparent border-0 p-0 disabled:opacity-50'

// Colonne « Diffusion » de « Mes offres » : réseaux où l'offre est publiée, puis l'état de la dernière diffusion
// (jamais « publiée » sans résultat reçu de Make) et le bouton qui la lance ou la relance.
export function SocialStatus({ info, state, shared, canPublish, publish }: {
  info?: SocialInfo; state: JobState; shared: boolean; canPublish: boolean; publish: Publish
}) {
  const router = useRouter()
  const working = !!info && WORKING.includes(info.status) && !info.stale
  const unconfirmed = !!info && WORKING.includes(info.status) && !!info.stale

  // Tant que la publication est en cours (visuel puis Make), on rafraîchit l'état toutes les 10 s (bornées : 5 min max).
  useEffect(() => {
    if (!working) return
    let n = 0
    const t = setInterval(() => { if (++n > 30) clearInterval(t); else router.refresh() }, 10_000)
    return () => clearInterval(t)
  }, [working, router])

  const done = info?.results.filter(r => r.status === 'published' || r.status === 'scheduled') ?? []
  const online = state === 'online' && !shared

  let status: ReactNode
  if (shared) status = <span className={line} style={{ color: 'var(--color-text-muted)' }}>Gérée par la plateforme</span>
  else if (!online) status = <span className={line} style={{ color: 'var(--color-text-muted)' }}>Hors ligne</span>
  else if (publish.pending) status = <span className={line} style={{ color: '#1d4ed8' }}><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Lancement…</span>
  else if (working) status = (
    <span className={line} style={{ color: '#1d4ed8' }}>
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />{info?.status === 'queued' ?'Création du visuel…' : 'Publication en cours…'}
    </span>
  )
  else if (unconfirmed) status = (
    <span className={line} style={{ color: '#b45309' }} title="La diffusion a été lancée, mais aucune confirmation n'est revenue.">
      <Clock className="h-3 w-3" aria-hidden />Envoyée, sans confirmation
    </span>
  )
  else if (info?.status === 'published') status = <span className={line} style={{ color: '#047857' }}><Check className="h-3 w-3" strokeWidth={2.6} aria-hidden />Publiée {info.age}</span>
  else if (info?.status === 'partial') status = <span className={line} style={{ color: '#b45309' }}><AlertTriangle className="h-3 w-3" aria-hidden />En partie publiée {info.age}</span>
  else if (info?.status === 'failed') status = (
    <span className={line} style={{ color: '#b91c1c' }}>
      <AlertTriangle className="h-3 w-3" aria-hidden />Échec
      {canPublish && <>{' · '}<button type="button" onClick={() => publish.run(true)} className={linkButton} style={{ color: 'inherit' }}>Réessayer</button></>}
    </span>
  )
  else if (canPublish) status = (
    <button type="button" onClick={() => publish.run(false)} className={`${linkButton} text-xs text-left`} style={{ color: 'var(--color-primary)' }}>
      Publier maintenant
    </button>
  )
  else status = <span className={line} style={{ color: 'var(--color-text-muted)' }}>Non diffusée</span>

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span aria-hidden className="shrink-0 w-8 h-8 rounded-[9px] flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', color: online ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
        <Share2 className="h-3.5 w-3.5" />
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
          {done.length === 0 ? 'Réseaux sociaux' : done.map((r, i) => (
            <span key={r.network}>
              {i > 0 && ' · '}
              {r.url
                ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: 'inherit' }}>{NETWORK_LABEL[r.network]}</a>
                : NETWORK_LABEL[r.network]}
            </span>
          ))}
        </span>
        {status}
        {publish.message && <span role="alert" className="text-[11px]" style={{ color: '#b91c1c' }}>{publish.message}</span>}
      </div>
    </div>
  )
}
