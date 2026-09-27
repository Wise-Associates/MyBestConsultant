'use client'

import { useState, useEffect, useRef } from 'react'
import { Users2, ExternalLink, Copy, Check, Loader2, AlertCircle, X, Lock, Globe, HelpCircle } from 'lucide-react'
import { findLinkedInGroupsForJob, type SuggestedGroup } from './groups-actions'
import { previewPostText } from './actions'

const VIS_CFG: Record<SuggestedGroup['visibility'], { label: string; icon: typeof Globe; color: string }> = {
  public: { label: 'Public', icon: Globe, color: '#16a34a' },
  private: { label: 'Privé', icon: Lock, color: '#B8860B' },
  unknown: { label: 'À vérifier', icon: HelpCircle, color: '#8a90a8' },
}

export function GroupsModal({ jobId, title, onClose }: { jobId: string; title: string; onClose: () => void }) {
  const [groups, setGroups] = useState<SuggestedGroup[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [postText, setPostText] = useState('')
  const [copied, setCopied] = useState(false)
  const searchedRef = useRef(false)

  useEffect(() => {
    // Guard against React StrictMode's dev double-invoke — the search calls Claude
    // with web search (real cost) and writes to the queue, it must run once per open.
    if (searchedRef.current) return
    searchedRef.current = true

    findLinkedInGroupsForJob(jobId).then(res => {
      setError(res.error ?? '')
      setGroups(res.groups)
      setLoading(false)
    })
    previewPostText(jobId).then(setPostText)
  }, [jobId])

  function copyText() {
    navigator.clipboard.writeText(postText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(11,29,81,0.55)' }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ background: '#fff', maxHeight: '85vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: '#e2e5f0' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#0B1D5110' }}>
              <Users2 className="w-4 h-4" style={{ color: '#0B1D51' }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold" style={{ color: '#0B1D51' }}>Groupes LinkedIn suggérés</p>
              <p className="text-xs mt-0.5 truncate" style={{ color: '#8a90a8' }}>{title}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 shrink-0">
            <X className="w-4 h-4" style={{ color: '#5a6080' }} />
          </button>
        </div>

        {/* Copy post text banner */}
        <div className="px-5 py-3 flex items-center justify-between gap-3 shrink-0" style={{ background: '#f8f9fc', borderBottom: '1px solid #e2e5f0' }}>
          <p className="text-xs" style={{ color: '#5a6080' }}>Copie le texte du post avant d&apos;ouvrir un groupe</p>
          <button onClick={copyText} disabled={!postText}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 disabled:opacity-40"
            style={{ background: copied ? '#16a34a' : '#0B1D51', color: '#fff' }}>
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copié !' : 'Copier le texte'}
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#B8860B' }} />
              <p className="text-xs" style={{ color: '#8a90a8' }}>Recherche de groupes pertinents…</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
              <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#e05555' }} />
              <p className="text-xs" style={{ color: '#991b1b' }}>{error}</p>
            </div>
          ) : groups && groups.length > 0 ? (
            <div className="space-y-2.5">
              {groups.map((g, i) => {
                const vc = VIS_CFG[g.visibility]
                return (
                  <div key={i} className="rounded-xl border p-3.5" style={{ borderColor: '#e2e5f0' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold" style={{ color: '#0B1D51' }}>{g.name}</p>
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                            style={{ background: `${vc.color}15`, color: vc.color }}>
                            <vc.icon className="w-2.5 h-2.5" />{vc.label}
                          </span>
                        </div>
                        {g.reason && <p className="text-xs mt-1 leading-relaxed" style={{ color: '#8a90a8' }}>{g.reason}</p>}
                      </div>
                      <a href={g.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-opacity hover:opacity-80"
                        style={{ background: '#f0f1f7', color: '#0B1D51' }}>
                        <ExternalLink className="w-3 h-3" />Ouvrir
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Users2 className="w-8 h-8 mx-auto mb-2" style={{ color: '#d0d4e8' }} />
              <p className="text-sm" style={{ color: '#adb5cc' }}>Aucun groupe trouvé pour cette offre</p>
            </div>
          )}
        </div>

        {/* Footer disclaimer */}
        <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid #e2e5f0', background: '#fafbfd' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: '#adb5cc' }}>
            Suggestions générées par IA à partir d&apos;une recherche web — vérifie chaque groupe sur LinkedIn avant de publier.
            La publication dans un groupe reste manuelle : LinkedIn ne permet pas de poster dans un groupe via API, même avec un compte connecté.
          </p>
        </div>
      </div>
    </div>
  )
}
