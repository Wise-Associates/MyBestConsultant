'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  Send, CheckCircle2, Clock, AlertCircle, Zap, User,
  RefreshCw, ExternalLink, TrendingUp, Calendar, Briefcase,
  ChevronDown, ChevronUp, Search, Settings, Eye, X,
  MapPin, Tag, BarChart2, Users2,
} from 'lucide-react'
import { postJobAction, saveLinkedInChannelConfig, previewPostText } from './actions'
import type { LinkedInPostJob, LinkedInChannelConfig } from './actions'
import { GroupsModal } from './groups-modal'

const CONTRACT: Record<string, string> = { cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', mission: 'Mission' }
const REMOTE: Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Remote' }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return 'à l\'instant'
  if (h < 24) return `il y a ${h}h`
  const d = Math.floor(h / 24)
  return d < 7 ? `il y a ${d}j` : fmtDate(iso)
}

// ── Preview Modal ─────────────────────────────────────────────────

function PreviewModal({ jobId, title, onClose }: { jobId: string; title: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useState(() => {
    previewPostText(jobId).then(t => { setText(t); setLoading(false) })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(11,29,81,0.55)' }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{ background: '#fff' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#e2e5f0' }}>
          <div>
            <p className="text-sm font-bold" style={{ color: '#0B1D51' }}>Aperçu du post LinkedIn</p>
            <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: '#8a90a8' }}>{title}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100">
            <X className="w-4 h-4" style={{ color: '#5a6080' }} />
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-5 h-5 animate-spin" style={{ color: '#B8860B' }} />
            </div>
          ) : (
            <div className="rounded-xl p-4 text-sm whitespace-pre-wrap leading-relaxed"
              style={{ background: '#f8f9fc', color: '#1e2540', fontFamily: 'inherit', border: '1px solid #e2e5f0' }}>
              {text || 'Impossible de charger l\'aperçu'}
            </div>
          )}
        </div>
        <div className="px-5 pb-5">
          <p className="text-xs" style={{ color: '#adb5cc' }}>
            Ce texte sera publié sur LinkedIn via {' '}
            <span style={{ color: '#0B1D51', fontWeight: 600 }}>Make.com</span> ou votre profil personnel.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Config Panel ──────────────────────────────────────────────────

function ConfigPanel({ cfg }: { cfg: LinkedInChannelConfig }) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'make' | 'direct'>(cfg.channel)
  const [makeUrl, setMakeUrl] = useState(cfg.makeWebhookUrl)
  const [appUrl, setAppUrl] = useState(cfg.appPublicUrl)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    setSaving(true)
    startTransition(async () => {
      await saveLinkedInChannelConfig({ channel, makeWebhookUrl: makeUrl, appPublicUrl: appUrl })
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: '#fff', borderColor: '#e2e5f0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#0B1D5110' }}>
            <Settings className="w-4 h-4" style={{ color: '#0B1D51' }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold" style={{ color: '#0B1D51' }}>Configuration du canal</p>
            <p className="text-xs" style={{ color: '#8a90a8' }}>
              {cfg.channel === 'make' ? 'Make.com (page entreprise)' : 'LinkedIn direct (profil personnel)'}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: '#8a90a8' }} />
          : <ChevronDown className="w-4 h-4" style={{ color: '#8a90a8' }} />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t" style={{ borderColor: '#f0f1f7' }}>
          <div className="pt-4">
            <p className="text-xs font-semibold mb-3" style={{ color: '#5a6080' }}>CANAL DE PUBLICATION</p>
            <div className="grid grid-cols-2 gap-3">
              {(['make', 'direct'] as const).map(ch => (
                <button key={ch}
                  onClick={() => setChannel(ch)}
                  className="rounded-xl border-2 p-4 text-left transition-all"
                  style={{
                    borderColor: channel === ch ? '#0B1D51' : '#e2e5f0',
                    background: channel === ch ? '#0B1D5108' : '#fff',
                  }}>
                  <div className="flex items-center gap-2 mb-2">
                    {ch === 'make'
                      ? <Zap className="w-4 h-4" style={{ color: channel === ch ? '#B8860B' : '#adb5cc' }} />
                      : <User className="w-4 h-4" style={{ color: channel === ch ? '#0B1D51' : '#adb5cc' }} />}
                    <span className="text-sm font-semibold" style={{ color: channel === ch ? '#0B1D51' : '#8a90a8' }}>
                      {ch === 'make' ? 'Make.com' : 'LinkedIn direct'}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: '#adb5cc' }}>
                    {ch === 'make' ? 'Page entreprise via webhook' : 'Profil personnel via OAuth'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {channel === 'make' && (
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: '#5a6080' }}>
                URL WEBHOOK MAKE.COM
              </label>
              <input
                value={makeUrl}
                onChange={e => setMakeUrl(e.target.value)}
                placeholder="https://hook.eu2.make.com/..."
                className="w-full text-sm rounded-xl px-3 py-2.5 border outline-none"
                style={{ borderColor: '#e2e5f0', color: '#0B1D51' }}
              />
            </div>
          )}

          {channel === 'direct' && !cfg.linkedinConnected && (
            <div className="rounded-xl p-3 flex items-center gap-2"
              style={{ background: '#fff3cd', border: '1px solid #ffc10733' }}>
              <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#B8860B' }} />
              <p className="text-xs" style={{ color: '#7a5c00' }}>
                LinkedIn non connecté.{' '}
                <a href="/admin/linkedin" className="underline font-semibold">
                  Connectez votre compte
                </a>{' '}dans Scraping LinkedIn.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold block mb-1.5" style={{ color: '#5a6080' }}>
              URL PUBLIQUE DE L'APP (dans les posts)
            </label>
            <input
              value={appUrl}
              onChange={e => setAppUrl(e.target.value)}
              placeholder="https://mybestconsultant.com"
              className="w-full text-sm rounded-xl px-3 py-2.5 border outline-none"
              style={{ borderColor: '#e2e5f0', color: '#0B1D51' }}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || isPending}
            className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            style={{ background: saved ? '#16a34a' : '#0B1D51', color: '#fff' }}>
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : null}
            {saved ? 'Enregistré !' : 'Enregistrer la configuration'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Job Card ──────────────────────────────────────────────────────

function JobCard({ job, cfg, onPosted }: {
  job: LinkedInPostJob
  cfg: LinkedInChannelConfig
  onPosted: (id: string) => void
}) {
  const [posting, setPosting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [preview, setPreview] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [isPending, startTransition] = useTransition()

  const alreadyPosted = !!job.linkedinPostedAt

  const canPost = cfg.channel === 'make'
    ? !!cfg.makeWebhookUrl
    : cfg.linkedinConnected

  function handlePost() {
    setPosting(true)
    startTransition(async () => {
      const res = await postJobAction(job.$id)
      if (res.ok) {
        setStatus('ok')
        onPosted(job.$id)
      } else {
        setStatus('error')
        setErrMsg(res.error ?? 'Erreur')
      }
      setPosting(false)
    })
  }

  return (
    <>
      {preview && <PreviewModal jobId={job.$id} title={job.title} onClose={() => setPreview(false)} />}
      {showGroups && <GroupsModal jobId={job.$id} title={job.title} onClose={() => setShowGroups(false)} />}
      <div className="rounded-xl border transition-all"
        style={{
          background: '#fff',
          borderColor: status === 'ok' ? '#16a34a44' : status === 'error' ? '#e0555544' : '#e2e5f0',
          borderLeftWidth: 3,
          borderLeftColor: alreadyPosted ? '#16a34a' : status === 'error' ? '#e05555' : '#e2e5f0',
        }}>
        <div className="px-4 py-3 flex items-center gap-4">

          {/* Statut icône */}
          <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: alreadyPosted ? '#16a34a12' : '#f0f1f7' }}>
            {alreadyPosted || status === 'ok'
              ? <CheckCircle2 className="w-4 h-4" style={{ color: '#16a34a' }} />
              : status === 'error'
                ? <AlertCircle className="w-4 h-4" style={{ color: '#e05555' }} />
                : <Clock className="w-4 h-4" style={{ color: '#B8860B' }} />}
          </div>

          {/* Infos */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: '#0B1D51' }}>{job.title}</p>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
              {job.location && (
                <span className="flex items-center gap-0.5 text-xs" style={{ color: '#8a90a8' }}>
                  <MapPin className="w-3 h-3" />{job.location}
                </span>
              )}
              {job.contractType && (
                <span className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                  style={{ background: '#0B1D5110', color: '#0B1D51' }}>
                  {CONTRACT[job.contractType] ?? job.contractType}
                </span>
              )}
              {job.remote && (
                <span className="text-xs px-1.5 py-0.5 rounded-md"
                  style={{ background: '#f0f1f7', color: '#5a6080' }}>
                  {REMOTE[job.remote] ?? job.remote}
                </span>
              )}
              {job.salary && (
                <span className="text-xs font-medium" style={{ color: '#B8860B' }}>
                  {job.salary.toLocaleString('fr-FR')} €
                </span>
              )}
            </div>
            {/* Skills */}
            {job.skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {job.skills.slice(0, 5).map(s => (
                  <span key={s} className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: '#f4f5f9', color: '#5a6080' }}>
                    {s}
                  </span>
                ))}
                {job.skills.length > 5 && (
                  <span className="text-xs" style={{ color: '#adb5cc' }}>+{job.skills.length - 5}</span>
                )}
              </div>
            )}
            {alreadyPosted && (
              <p className="text-xs mt-1" style={{ color: '#16a34a' }}>
                Publié {timeAgo(job.linkedinPostedAt!)}
              </p>
            )}
            {status === 'error' && (
              <p className="text-xs mt-1" style={{ color: '#e05555' }}>{errMsg}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setPreview(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="Aperçu du post">
              <Eye className="w-3.5 h-3.5" style={{ color: '#8a90a8' }} />
            </button>
            <button onClick={() => setShowGroups(true)}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="Groupes LinkedIn suggérés">
              <Users2 className="w-3.5 h-3.5" style={{ color: '#8a90a8' }} />
            </button>
            <button
              onClick={handlePost}
              disabled={posting || isPending || !canPost}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all disabled:opacity-40"
              style={{
                background: alreadyPosted ? '#f0f1f7' : '#0B1D51',
                color: alreadyPosted ? '#5a6080' : '#fff',
              }}>
              {posting
                ? <RefreshCw className="w-3 h-3 animate-spin" />
                : alreadyPosted
                  ? <RefreshCw className="w-3 h-3" />
                  : <Send className="w-3 h-3" />}
              {alreadyPosted ? 'Republier' : 'Publier'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Accordion Section ─────────────────────────────────────────────

function Section({ title, count, icon: Icon, color, children, defaultOpen = true }: {
  title: string
  count: number
  icon: React.ElementType
  color: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#e2e5f0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50"
        style={{ background: '#fff' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span className="text-sm font-bold" style={{ color: '#0B1D51' }}>{title}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: `${color}18`, color }}>
            {count}
          </span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4" style={{ color: '#adb5cc' }} />
          : <ChevronDown className="w-4 h-4" style={{ color: '#adb5cc' }} />}
      </button>
      {open && (
        <div className="border-t" style={{ borderColor: '#f0f1f7' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Filters ───────────────────────────────────────────────────────

function Filters({ search, setSearch, contract, setContract, remote, setRemote, contracts, remotes }: {
  search: string; setSearch: (v: string) => void
  contract: string; setContract: (v: string) => void
  remote: string; setRemote: (v: string) => void
  contracts: string[]; remotes: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#adb5cc' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher une offre..."
          className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border outline-none"
          style={{ borderColor: '#e2e5f0', color: '#0B1D51', background: '#fff' }}
        />
      </div>
      <select value={contract} onChange={e => setContract(e.target.value)}
        className="text-sm rounded-xl border px-3 py-2 outline-none"
        style={{ borderColor: '#e2e5f0', color: '#5a6080', background: '#fff' }}>
        <option value="">Tous contrats</option>
        {contracts.map(c => <option key={c} value={c}>{CONTRACT[c] ?? c}</option>)}
      </select>
      <select value={remote} onChange={e => setRemote(e.target.value)}
        className="text-sm rounded-xl border px-3 py-2 outline-none"
        style={{ borderColor: '#e2e5f0', color: '#5a6080', background: '#fff' }}>
        <option value="">Tous modes</option>
        {remotes.map(r => <option key={r} value={r}>{REMOTE[r] ?? r}</option>)}
      </select>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────

export function LinkedInPostsClient({ jobs: initialJobs, cfg }: {
  jobs: LinkedInPostJob[]
  cfg: LinkedInChannelConfig
}) {
  const [jobs, setJobs] = useState(initialJobs)
  const [search, setSearch] = useState('')
  const [contract, setContract] = useState('')
  const [remote, setRemote] = useState('')

  function onPosted(id: string) {
    setJobs(prev => prev.map(j => j.$id === id ? { ...j, linkedinPostedAt: new Date().toISOString() } : j))
  }

  const contracts = useMemo(() => [...new Set(jobs.map(j => j.contractType).filter(Boolean))], [jobs])
  const remotes = useMemo(() => [...new Set(jobs.map(j => j.remote).filter(Boolean))], [jobs])

  const filtered = useMemo(() => jobs.filter(j => {
    if (search && !j.title.toLowerCase().includes(search.toLowerCase()) &&
      !j.location?.toLowerCase().includes(search.toLowerCase())) return false
    if (contract && j.contractType !== contract) return false
    if (remote && j.remote !== remote) return false
    return true
  }), [jobs, search, contract, remote])

  const toPost = filtered.filter(j => !j.linkedinPostedAt)
  const posted = filtered.filter(j => !!j.linkedinPostedAt)

  const postedThisWeek = jobs.filter(j => j.linkedinPostedAt &&
    (Date.now() - new Date(j.linkedinPostedAt).getTime()) < 7 * 24 * 3600 * 1000)

  const canPost = cfg.channel === 'make' ? !!cfg.makeWebhookUrl : cfg.linkedinConnected

  return (
    <div className="min-h-screen" style={{ background: '#f4f5f9' }}>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#0B1D51' }}>
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#0B1D51' }}>LinkedIn Posts</h1>
              <p className="text-sm" style={{ color: '#8a90a8' }}>Diffusez vos offres sur LinkedIn</p>
            </div>
          </div>
          <a href="/admin/linkedin"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium"
            style={{ color: '#5a6080', borderColor: '#d0d4e8', background: '#fff' }}>
            <ExternalLink className="w-3 h-3" />
            Scraping LinkedIn
          </a>
        </div>

        {/* Canal actif banner */}
        <div className="rounded-2xl p-4 flex items-center justify-between"
          style={{
            background: canPost
              ? 'linear-gradient(135deg, #0B1D51 0%, #1a2f7a 100%)'
              : '#fff',
            border: canPost ? 'none' : '1px solid #e2e5f0',
          }}>
          {canPost ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.15)' }}>
                  {cfg.channel === 'make'
                    ? <Zap className="w-4 h-4 text-white" />
                    : <User className="w-4 h-4 text-white" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {cfg.channel === 'make' ? 'Make.com — Page entreprise' : 'LinkedIn direct — Profil personnel'}
                  </p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {cfg.channel === 'make' ? cfg.makeWebhookUrl?.slice(0, 48) + '...' : 'Connecté via OAuth'}
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'rgba(184,134,11,0.3)', color: '#f5d060' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                Actif
              </span>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5" style={{ color: '#e05555' }} />
              <p className="text-sm" style={{ color: '#0B1D51' }}>
                Canal non configuré — dépliez la configuration ci-dessous
              </p>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: TrendingUp, label: 'Total publiés', value: jobs.filter(j => j.linkedinPostedAt).length, color: '#0B1D51' },
            { icon: Calendar, label: 'Cette semaine', value: postedThisWeek.length, color: '#B8860B' },
            { icon: Briefcase, label: 'En attente', value: jobs.filter(j => !j.linkedinPostedAt).length, color: '#6b7280' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border p-4 flex items-center gap-3"
              style={{ background: '#fff', borderColor: '#e2e5f0' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: `${s.color}12` }}>
                <s.icon className="w-4 h-4" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs mt-0.5" style={{ color: '#adb5cc' }}>{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Config panel */}
        <ConfigPanel cfg={cfg} />

        {/* Filters */}
        <Filters
          search={search} setSearch={setSearch}
          contract={contract} setContract={setContract}
          remote={remote} setRemote={setRemote}
          contracts={contracts} remotes={remotes}
        />

        {/* Section À publier */}
        <Section title="À publier" count={toPost.length} icon={Clock} color="#B8860B" defaultOpen={true}>
          {toPost.length === 0 ? (
            <div className="px-5 py-8 text-center" style={{ background: '#fafbfd' }}>
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: '#d0d4e8' }} />
              <p className="text-sm" style={{ color: '#adb5cc' }}>Toutes les offres ont été publiées</p>
            </div>
          ) : (
            <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto" style={{ background: '#fafbfd' }}>
              {toPost.map(job => (
                <JobCard key={job.$id} job={job} cfg={cfg} onPosted={onPosted} />
              ))}
            </div>
          )}
        </Section>

        {/* Section Publiés */}
        <Section title="Publiés sur LinkedIn" count={posted.length} icon={CheckCircle2} color="#16a34a" defaultOpen={false}>
          {posted.length === 0 ? (
            <div className="px-5 py-8 text-center" style={{ background: '#fafbfd' }}>
              <Clock className="w-8 h-8 mx-auto mb-2" style={{ color: '#d0d4e8' }} />
              <p className="text-sm" style={{ color: '#adb5cc' }}>Aucune offre publiée pour l'instant</p>
            </div>
          ) : (
            <div className="p-3 space-y-2 max-h-[480px] overflow-y-auto" style={{ background: '#fafbfd' }}>
              {posted.map(job => (
                <JobCard key={job.$id} job={job} cfg={cfg} onPosted={onPosted} />
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}
