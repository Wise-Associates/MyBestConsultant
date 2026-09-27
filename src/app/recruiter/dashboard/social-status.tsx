'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Share2, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react'
import { NETWORK_LABEL, type Network } from '@/lib/social-content'
import { publishJobToSocialAction } from './actions'

export interface SocialInfo {
  stale?: boolean
  status: 'queued' | 'sent' | 'images_ready' | 'published' | 'partial' | 'failed'
  results: { network: Network; status: 'published' | 'scheduled' | 'failed' | 'skipped'; url?: string }[]
}

const WORKING = ['queued', 'sent', 'images_ready']

// Pastille d'état de la diffusion sur les réseaux + bouton « Publier / Republier ».
export function SocialStatus({ jobId, info, canPublish }: { jobId: string; info?: SocialInfo; canPublish: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const working = !!info && WORKING.includes(info.status) && !info.stale
  const unconfirmed = !!info && WORKING.includes(info.status) && !!info.stale

  // Tant que Make travaille, on rafraîchit l'état toutes les 10 s (bornées : 5 min max).
  useEffect(() => {
    if (!working) return
    let n = 0
    const t = setInterval(() => { if (++n > 30) clearInterval(t); else router.refresh() }, 10_000)
    return () => clearInterval(t)
  }, [working, router])

  if (!info && !canPublish) return null
  const done = info?.results.filter(r => r.status === 'published' || r.status === 'scheduled') ?? []

  function run() {
    setMsg(null)
    start(async () => {
      const r = await publishJobToSocialAction(jobId, !!info)
      if (!r.ok) setMsg(r.message)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap mt-2.5" onClick={e => e.stopPropagation()}>
      {working && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(139,92,246,0.12)', color: '#7c3aed' }}>
          <Loader2 className="h-3 w-3 animate-spin" />{info!.status === 'images_ready' ? 'Visuels prêts, publication…' : 'Création des visuels…'}
        </span>
      )}
      {unconfirmed && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }} title="La diffusion a été lancée, mais aucune confirmation n'est revenue.">
          <Share2 className="h-3 w-3" />Envoyée — confirmation non reçue
        </span>
      )}
      {info && (info.status === 'published' || info.status === 'partial') && (
        <span className="inline-flex items-center gap-1.5 flex-wrap text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: info.status === 'published' ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.14)', color: info.status === 'published' ? '#059669' : '#b45309' }}>
          <Share2 className="h-3 w-3" />
          {info.status === 'published' ? 'Publiée sur' : 'Publiée partiellement :'}
          {done.length === 0 ? ' les réseaux' : done.map((r, i) => (
            r.url
              ? <a key={r.network} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline decoration-dotted">{NETWORK_LABEL[r.network]}{i < done.length - 1 ? ',' : ''}<ExternalLink className="h-2.5 w-2.5" /></a>
              : <span key={r.network}>{NETWORK_LABEL[r.network]}{i < done.length - 1 ? ',' : ''}</span>
          ))}
        </span>
      )}
      {info?.status === 'failed' && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626' }}>
          <AlertCircle className="h-3 w-3" />La diffusion a échoué
        </span>
      )}
      {canPublish && !working && (
        <button type="button" onClick={run} disabled={pending} className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full transition-opacity hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f', border: 'none', cursor: 'pointer' }}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : info ? <RefreshCw className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
          {info ? (info.status === 'failed' ? 'Réessayer' : 'Republier') : 'Publier sur les réseaux'}
        </button>
      )}
      {msg && <span className="text-[11px]" style={{ color: '#dc2626' }}>{msg}</span>}
    </div>
  )
}
