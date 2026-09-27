'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Users2, ExternalLink, Copy, Check, Loader2, Lock, Globe, HelpCircle,
  SkipForward, Clock, CheckCircle2, ListTodo, Briefcase,
} from 'lucide-react'
import { updateGroupStatus, type GroupQueueItem } from './actions'
import { previewPostText } from '@/app/admin/linkedin-posts/actions'

const VIS_CFG: Record<GroupQueueItem['visibility'], { label: string; icon: typeof Globe; color: string }> = {
  public: { label: 'Public', icon: Globe, color: '#34d399' },
  private: { label: 'Privé', icon: Lock, color: '#B8860B' },
  unknown: { label: 'À vérifier', icon: HelpCircle, color: '#8a90a8' },
}

type Filter = 'pending' | 'done' | 'skipped' | 'all'

function Row({ item, onStatusChange }: { item: GroupQueueItem; onStatusChange: (id: string, status: GroupQueueItem['status']) => void }) {
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [isPending, startTransition] = useTransition()
  const vc = VIS_CFG[item.visibility]

  async function copyText() {
    setCopying(true)
    const text = await previewPostText(item.jobId)
    if (text) {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    setCopying(false)
  }

  function openAndMarkDone() {
    window.open(item.groupUrl, '_blank', 'noopener,noreferrer')
    startTransition(async () => {
      const res = await updateGroupStatus(item.$id, 'done')
      if (res.ok) onStatusChange(item.$id, 'done')
    })
  }

  function skip() {
    startTransition(async () => {
      const res = await updateGroupStatus(item.$id, 'skipped')
      if (res.ok) onStatusChange(item.$id, 'skipped')
    })
  }

  return (
    <div className="rounded-xl p-4"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        opacity: item.status === 'skipped' ? 0.5 : 1,
      }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(184,134,11,0.12)', color: '#B8860B' }}>
              <Briefcase className="h-3 w-3" />{item.jobTitle}
            </span>
            {item.status === 'done' && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                <CheckCircle2 className="h-2.5 w-2.5" />Fait
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-white">{item.groupName}</p>
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: `${vc.color}18`, color: vc.color }}>
              <vc.icon className="h-2.5 w-2.5" />{vc.label}
            </span>
          </div>
          {item.reason && <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.reason}</p>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={copyText} disabled={copying}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.06)', color: copied ? '#34d399' : 'rgba(255,255,255,0.6)' }}>
            {copying ? <Loader2 className="h-3 w-3 animate-spin" /> : copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copié' : 'Copier texte'}
          </button>
          {item.status !== 'done' && (
            <button onClick={skip} disabled={isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
              <SkipForward className="h-3 w-3" />Passer
            </button>
          )}
          <button onClick={openAndMarkDone} disabled={isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
            style={{
              background: item.status === 'done' ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #0B1D51, #162466)',
              color: item.status === 'done' ? 'rgba(255,255,255,0.5)' : '#fff',
              border: item.status === 'done' ? '1px solid rgba(184,134,11,0.2)' : '1px solid rgba(184,134,11,0.35)',
            }}>
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            {item.status === 'done' ? 'Rouvrir' : 'Ouvrir & marquer fait'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function GroupsQueueClient({ initialItems }: { initialItems: GroupQueueItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [filter, setFilter] = useState<Filter>('pending')

  function onStatusChange(id: string, status: GroupQueueItem['status']) {
    setItems(prev => prev.map(i => i.$id === id ? { ...i, status, doneAt: status === 'done' ? new Date().toISOString() : null } : i))
  }

  const stats = useMemo(() => {
    const today = new Date().toDateString()
    return {
      pending: items.filter(i => i.status === 'pending').length,
      doneToday: items.filter(i => i.status === 'done' && i.doneAt && new Date(i.doneAt).toDateString() === today).length,
      total: items.length,
    }
  }, [items])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter(i => i.status === filter)
  }, [items, filter])

  const TABS: { id: Filter; label: string }[] = [
    { id: 'pending', label: 'À faire' },
    { id: 'done', label: 'Faites' },
    { id: 'skipped', label: 'Passées' },
    { id: 'all', label: 'Toutes' },
  ]

  return (
    <div className="min-h-full p-8 space-y-6" style={{ color: 'rgba(255,255,255,0.87)' }}>

      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>INTELLIGENCE</p>
        <h1 className="text-[28px] font-bold tracking-tight text-white">Groupes LinkedIn</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          File d&apos;attente des groupes suggérés — publication manuelle, en un clic depuis ici
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'À faire', value: stats.pending, icon: Clock, accent: '#B8860B' },
          { label: 'Faites aujourd\'hui', value: stats.doneToday, icon: CheckCircle2, accent: '#34d399' },
          { label: 'Total suggéré', value: stats.total, icon: ListTodo, accent: '#60a5fa' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${s.accent}18` }}>
              <s.icon className="h-5 w-5" style={{ color: s.accent }} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: filter === t.id ? 'rgba(184,134,11,0.15)' : 'rgba(255,255,255,0.04)',
              color: filter === t.id ? '#B8860B' : 'rgba(255,255,255,0.5)',
              border: filter === t.id ? '1px solid rgba(184,134,11,0.3)' : '1px solid rgba(255,255,255,0.07)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Users2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p style={{ color: 'rgba(255,255,255,0.3)' }}>
              {filter === 'pending' ? 'Aucun groupe en attente' : 'Rien ici pour le moment'}
            </p>
            <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Lance une recherche de groupes depuis une offre dans LinkedIn Posts pour en ajouter ici.
            </p>
          </div>
        ) : (
          filtered.map(item => <Row key={item.$id} item={item} onStatusChange={onStatusChange} />)
        )}
      </div>
    </div>
  )
}
