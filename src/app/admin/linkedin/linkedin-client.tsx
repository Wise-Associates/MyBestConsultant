'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Network as Linkedin, Play, Settings, ToggleLeft, ToggleRight, Plus, X,
  Loader2, Check, CheckCircle2, XCircle, Globe, RefreshCw,
  Clock, Zap, ChevronDown, ChevronUp, ExternalLink, Search,
  Link2, Link2Off, Send, AlertCircle, Sparkles, Building2,
} from 'lucide-react'
import {
  saveLinkedInConfig, runScrape, checkScrapeRun, publishLinkedInJob, ignoreLinkedInJob,
  publishMultipleLinkedInJobs, getLinkedInJobs,
  getLinkedInConnectUrl, disconnectLinkedInAction, updateLinkedInPublishSettings,
  testLinkedInPostAction, fetchLinkedInOrgsAction,
  type LinkedInScrapeConfig, type LinkedInJob, type ScrapeRun, type LinkedInPublishConfig,
} from './actions'
import { JobDescriptionDark } from '@/components/shared/job-description'

// ── LinkedIn Connection Panel ────────────────────────────────────
function LinkedInConnectionPanel({ publishConfig, onUpdate }: {
  publishConfig: LinkedInPublishConfig | null
  onUpdate: (cfg: LinkedInPublishConfig | null) => void
}) {
  const [connecting, startConnect] = useTransition()
  const [disconnecting, startDisconnect] = useTransition()
  const [testing, startTest] = useTransition()
  const [testMsg, setTestMsg] = useState<{ ok?: boolean; text: string } | null>(null)
  const [autoPost, setAutoPost] = useState(publishConfig?.autoPostOnPublish ?? true)
  const [saving, startSave] = useTransition()
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string; urn: string }>>([])
  const [selectedAuthorUrn, setSelectedAuthorUrn] = useState(publishConfig?.authorUrn ?? '')
  const [orgsLoading, setOrgsLoading] = useState(false)

  useEffect(() => {
    setAutoPost(publishConfig?.autoPostOnPublish ?? true)
    setSelectedAuthorUrn(publishConfig?.authorUrn ?? '')
  }, [publishConfig])

  function connect() {
    startConnect(async () => {
      const url = await getLinkedInConnectUrl()
      window.location.href = url
    })
  }

  function disconnect() {
    startDisconnect(async () => {
      await disconnectLinkedInAction()
      onUpdate(null)
    })
  }

  function testPost() {
    setTestMsg(null)
    startTest(async () => {
      const res = await testLinkedInPostAction()
      setTestMsg(res.error ? { text: res.error } : { ok: true, text: 'Post test publié sur votre LinkedIn ✓' })
      setTimeout(() => setTestMsg(null), 6000)
    })
  }

  async function loadOrgs() {
    setOrgsLoading(true)
    const list = await fetchLinkedInOrgsAction()
    setOrgs(list)
    setOrgsLoading(false)
  }

  function saveSettings() {
    startSave(async () => {
      const fd = new FormData()
      const authorUrn = selectedAuthorUrn || publishConfig?.personUrn || ''
      const authorLabel = orgs.find(o => o.urn === authorUrn)?.name
        ?? (authorUrn === publishConfig?.personUrn ? 'Mon profil LinkedIn' : authorUrn)
      fd.set('authorUrn', authorUrn)
      fd.set('authorLabel', authorLabel)
      fd.set('autoPost', String(autoPost))
      await updateLinkedInPublishSettings(fd)
    })
  }

  if (!publishConfig) {
    return (
      <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(10,102,194,0.06)', border: '1px solid rgba(10,102,194,0.18)', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(10,102,194,0.12)', border: '1px solid rgba(10,102,194,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Link2Off style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.35)' }} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>Publication LinkedIn non connectée</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                Connectez votre compte pour publier automatiquement chaque offre sur LinkedIn
              </p>
            </div>
          </div>
          <button onClick={connect} disabled={connecting}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700, background: '#0a66c2', color: 'white', border: 'none', cursor: connecting ? 'default' : 'pointer', opacity: connecting ? 0.7 : 1, boxShadow: '0 4px 16px rgba(10,102,194,0.35)' }}>
            {connecting ? <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> : <Linkedin style={{ width: 15, height: 15 }} />}
            {connecting ? 'Redirection…' : 'Connecter LinkedIn'}
          </button>
        </div>

        {/* Setup guide */}
        <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>Configuration requise dans les variables d&apos;env</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'].map(key => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: '#60a5fa', fontFamily: 'monospace' }}>{key}</code>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>→ LinkedIn Developer App</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: '#60a5fa', fontFamily: 'monospace' }}>NEXT_PUBLIC_APP_URL</code>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>→ Redirect URI dans l&apos;app LinkedIn</span>
            </div>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>
              Redirect URI à configurer : <code style={{ color: '#60a5fa' }}>{'{NEXT_PUBLIC_APP_URL}'}/api/linkedin-oauth/callback</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const connectedDate = publishConfig.connectedAt
    ? new Date(publishConfig.connectedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  return (
    <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', marginBottom: '2rem' }}>

      {/* Connected header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Link2 style={{ width: 20, height: 20, color: '#10b981' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>LinkedIn connecté</p>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>ACTIF</span>
            </div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {publishConfig.authorLabel} · {connectedDate && `Connecté le ${connectedDate}`}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={testPost} disabled={testing}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', cursor: testing ? 'default' : 'pointer' }}>
            {testing ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 13, height: 13 }} />}
            Tester
          </button>
          <button onClick={disconnect} disabled={disconnecting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: disconnecting ? 'default' : 'pointer' }}>
            {disconnecting ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Link2Off style={{ width: 13, height: 13 }} />}
            Déconnecter
          </button>
        </div>
      </div>

      {/* Test feedback */}
      {testMsg && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 10, background: testMsg.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${testMsg.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`, fontSize: 12, color: testMsg.ok ? '#34d399' : '#f87171', display: 'flex', alignItems: 'center', gap: 8 }}>
          {testMsg.ok ? <CheckCircle2 style={{ width: 14, height: 14, flexShrink: 0 }} /> : <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />}
          {testMsg.text}
        </div>
      )}

      {/* Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

        {/* Auto-post toggle */}
        <div style={{ padding: '1rem', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles style={{ width: 13, height: 13, color: '#fbbf24' }} />
                Publication automatique
              </p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                Chaque offre publiée est posée automatiquement sur LinkedIn
              </p>
            </div>
            <button onClick={() => setAutoPost(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {autoPost
                ? <ToggleRight style={{ width: 30, height: 30, color: '#0a66c2' }} />
                : <ToggleLeft style={{ width: 30, height: 30, color: 'rgba(255,255,255,0.2)' }} />}
            </button>
          </div>
        </div>

        {/* Author selector */}
        <div style={{ padding: '1rem', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Building2 style={{ width: 13, height: 13, color: '#60a5fa' }} />
              Publier en tant que
            </p>
            <button onClick={loadOrgs} disabled={orgsLoading} style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              {orgsLoading ? '…' : 'Charger les pages'}
            </button>
          </div>
          <select value={selectedAuthorUrn} onChange={e => setSelectedAuthorUrn(e.target.value)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', outline: 'none' }}>
            <option value={publishConfig.personUrn}>Mon profil personnel</option>
            {orgs.map(org => (
              <option key={org.urn} value={org.urn}>{org.name}</option>
            ))}
          </select>
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 6 }}>
            Pages entreprise = nécessite <code style={{ color: '#60a5fa' }}>w_organization_social</code> (LinkedIn MDP)
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button onClick={saveSettings} disabled={saving}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'white', border: '1px solid rgba(255,255,255,0.12)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 13, height: 13 }} />}
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}

// ── Tag input ─────────────────────────────────────────────────────
function TagInput({ label, values, onChange, placeholder }: {
  label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const [input, setInput] = useState('')
  function add() {
    const v = input.trim()
    if (v && !values.includes(v)) { onChange([...values, v]); setInput('') }
  }
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 8 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {values.map(v => (
          <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(10,102,194,0.15)', color: '#60a5fa', border: '1px solid rgba(10,102,194,0.25)' }}>
            {v}
            <button onClick={() => onChange(values.filter(x => x !== v))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', lineHeight: 1 }}>
              <X style={{ width: 10, height: 10 }} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder ?? 'Ajouter…'}
          style={{ flex: 1, padding: '7px 12px', borderRadius: 10, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'white', outline: 'none' }} />
        <button onClick={add}
          style={{ padding: '7px 12px', borderRadius: 10, background: 'rgba(10,102,194,0.2)', color: '#60a5fa', border: '1px solid rgba(10,102,194,0.3)', cursor: 'pointer' }}>
          <Plus style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  )
}

const CONTRACT_LABEL: Record<string, string> = { full_time: 'CDI', contract: 'Mission', part_time: 'Temps partiel' }
const REMOTE_LABEL:   Record<string, string> = { onsite: 'Présentiel', hybrid: 'Hybride', remote: 'Full remote' }

// ── Job card ──────────────────────────────────────────────────────
function JobCard({
  job, selected, onSelect, onPublish, onIgnore,
}: {
  job: LinkedInJob
  selected: boolean
  onSelect: () => void
  onPublish: () => void
  onIgnore: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [actioning, startAction] = useTransition()

  const statusCfg = {
    new:       { label: 'Nouveau',  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    published: { label: 'Publié',   color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    ignored:   { label: 'Ignoré',   color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
  }[job.status]

  return (
    <div style={{
      borderRadius: 16,
      border: selected ? '1px solid rgba(10,102,194,0.5)' : '1px solid rgba(255,255,255,0.07)',
      background: selected ? 'rgba(10,102,194,0.06)' : 'rgba(255,255,255,0.02)',
      overflow: 'hidden',
      opacity: job.status === 'ignored' ? 0.45 : 1,
      transition: 'border-color 0.15s, background 0.15s, opacity 0.2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', padding: '1rem 1.25rem' }}>

        {/* Checkbox */}
        {job.status === 'new' && (
          <button onClick={onSelect}
            style={{
              width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 2,
              border: selected ? '2px solid #0a66c2' : '2px solid rgba(255,255,255,0.2)',
              background: selected ? '#0a66c2' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}>
            {selected && <Check style={{ width: 11, height: 11, color: 'white' }} />}
          </button>
        )}
        {job.status !== 'new' && <div style={{ width: 20, flexShrink: 0 }} />}

        {/* Company initial */}
        <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(10,102,194,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>
          {job.company.slice(0, 2).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>{job.title}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: statusCfg.bg, color: statusCfg.color }}>{statusCfg.label}</span>
            {job.jobType && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                {CONTRACT_LABEL[job.jobType] ?? job.jobType}
              </span>
            )}
            {job.remote && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                {REMOTE_LABEL[job.remote] ?? job.remote}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
            <strong style={{ color: 'rgba(255,255,255,0.65)' }}>{job.company}</strong>
            {job.location && <> · {job.location}</>}
          </p>
          {job.skills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {job.skills.map(s => (
                <span key={s} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {job.status === 'new' && (
            <>
              <button onClick={() => startAction(onPublish)} disabled={actioning}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: 'rgba(10,102,194,0.2)', color: '#60a5fa', border: '1px solid rgba(10,102,194,0.3)', cursor: actioning ? 'default' : 'pointer', opacity: actioning ? 0.6 : 1 }}>
                {actioning ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 12, height: 12 }} />}
                Publier
              </button>
              <button onClick={() => startAction(onIgnore)} disabled={actioning}
                style={{ padding: 6, borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.2)')}>
                <X style={{ width: 15, height: 15 }} />
              </button>
            </>
          )}
          {job.linkedinUrl && (
            <a href={job.linkedinUrl} target="_blank" rel="noreferrer"
              style={{ padding: 6, borderRadius: 8, color: 'rgba(255,255,255,0.2)', display: 'flex' }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#60a5fa')}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'rgba(255,255,255,0.2)')}>
              <ExternalLink style={{ width: 14, height: 14 }} />
            </a>
          )}
          <button onClick={() => setExpanded(v => !v)}
            style={{ padding: 6, borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)' }}>
            {expanded ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '1rem 1.25rem 1.25rem' }}>
          {/* Meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px,1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            {[
              { label: 'Entreprise',   val: job.company || '—' },
              { label: 'Localisation', val: job.location || '—' },
              { label: 'Contrat',      val: CONTRACT_LABEL[job.jobType] ?? job.jobType ?? '—' },
              { label: 'Télétravail',  val: REMOTE_LABEL[job.remote] ?? job.remote ?? '—' },
              { label: 'Posté le',     val: job.postedAt ? new Date(job.postedAt).toLocaleDateString('fr-FR') : '—' },
              { label: 'Scrapé le',    val: job.scrapedAt ? new Date(job.scrapedAt).toLocaleDateString('fr-FR') : '—' },
            ].map(({ label, val }) => (
              <div key={label} style={{ padding: '0.6rem 0.875rem', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginBottom: 4 }}>{label}</p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{val}</p>
              </div>
            ))}
          </div>

          {/* All skills */}
          {job.skills.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>Compétences</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {job.skills.map(s => (
                  <span key={s} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(10,102,194,0.12)', color: '#60a5fa', border: '1px solid rgba(10,102,194,0.2)' }}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Full description */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>Description du poste</p>
            <div style={{ padding: '1rem 1.125rem', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', maxHeight: 380, overflowY: 'auto' }}>
              <JobDescriptionDark description={job.description} />
            </div>
          </div>

          {/* LinkedIn link */}
          <div style={{ marginTop: '0.875rem' }}>
            {job.linkedinUrl ? (
              <a href={job.linkedinUrl} target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#60a5fa', textDecoration: 'none', padding: '6px 12px', borderRadius: 8, background: 'rgba(10,102,194,0.12)', border: '1px solid rgba(10,102,194,0.25)' }}>
                <ExternalLink style={{ width: 13, height: 13 }} />
                Voir l&apos;offre sur LinkedIn
              </a>
            ) : (
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>
                Lien LinkedIn non disponible — sera récupéré au prochain scraping.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Run status banner ─────────────────────────────────────────────
function RunBanner({ run, onCheck, checking }: { run: ScrapeRun; onCheck: () => void; checking: boolean }) {
  if (run.status === 'running') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', borderRadius: 14, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
      <Loader2 style={{ width: 18, height: 18, color: '#3b82f6', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>Scraping LinkedIn en cours…</p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Apify collecte les offres selon vos filtres. Cliquez &quot;Vérifier&quot; pour voir si c&apos;est terminé.</p>
      </div>
      <button onClick={onCheck} disabled={checking}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', cursor: checking ? 'default' : 'pointer' }}>
        {checking ? <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} /> : <RefreshCw style={{ width: 12, height: 12 }} />}
        Vérifier
      </button>
    </div>
  )

  if (run.status === 'completed') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.25rem', borderRadius: 14, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
      <CheckCircle2 style={{ width: 18, height: 18, color: '#10b981', flexShrink: 0 }} />
      <p style={{ fontSize: 13, color: '#34d399' }}>
        <strong>{run.jobsFound}</strong> nouvelles offres importées
        {run.jobsPublished > 0 && <> · <strong>{run.jobsPublished}</strong> publiées automatiquement</>}
        {run.completedAt && <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}> · {new Date(run.completedAt).toLocaleTimeString('fr-FR')}</span>}
      </p>
    </div>
  )

  if (run.status === 'failed') return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '1rem 1.25rem', borderRadius: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
      <XCircle style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>Échec du scraping</p>
        {run.errors.map((e, i) => <p key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{e}</p>)}
      </div>
    </div>
  )

  return null
}

// ── Main ──────────────────────────────────────────────────────────
export function LinkedInClient({
  initialConfig, initialJobs, initialPublishConfig,
}: {
  initialConfig: LinkedInScrapeConfig | null
  initialJobs: LinkedInJob[]
  initialPublishConfig: LinkedInPublishConfig | null
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [publishConfig, setPublishConfig] = useState<LinkedInPublishConfig | null>(initialPublishConfig)
  const [oauthMsg, setOauthMsg] = useState<{ ok?: boolean; text: string } | null>(() => {
    if (searchParams.get('linkedin_connected')) return { ok: true, text: 'LinkedIn connecté avec succès ! La publication automatique est activée.' }
    if (searchParams.get('linkedin_error')) return { text: decodeURIComponent(searchParams.get('linkedin_error') ?? 'Erreur de connexion') }
    return null
  })

  useEffect(() => {
    // Clean URL params after reading
    if (searchParams.get('linkedin_connected') || searchParams.get('linkedin_error')) {
      router.replace('/admin/linkedin')
    }
  }, [searchParams, router])

  const DEFAULT_CFG: LinkedInScrapeConfig = {
    keywords: [], locations: [], jobTypes: ['full_time', 'contract'],
    experienceLevels: ['mid', 'senior'], remoteFilter: 'any', industries: [],
    frequency: 'manual', maxResults: 25, autoPublish: false, isActive: true,
  }

  const [cfg, setCfg] = useState<LinkedInScrapeConfig>(initialConfig ?? DEFAULT_CFG)
  const [jobs, setJobs] = useState<LinkedInJob[]>(initialJobs)
  const [tab, setTab] = useState<'config' | 'jobs'>('config')
  const [run, setRun] = useState<ScrapeRun | null>(null)
  const [isPending, startTransition] = useTransition()
  const [checking, startChecking] = useTransition()
  const [bulkPending, startBulk] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'published' | 'ignored'>('new')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)

  function set<K extends keyof LinkedInScrapeConfig>(key: K, value: LinkedInScrapeConfig[K]) {
    setCfg(prev => ({ ...prev, [key]: value }))
  }

  function save() {
    startTransition(async () => {
      const { $id: _, ...data } = cfg
      const res = await saveLinkedInConfig(data)
      setSaveStatus(res.error ? 'error' : 'ok')
      setTimeout(() => setSaveStatus('idle'), 3000)
    })
  }

  function launchScrape() {
    setRun(null)
    startTransition(async () => {
      const result = await runScrape(cfg)
      setRun(result)
      if (result.status === 'completed' || result.status === 'running') {
        setTab('jobs')
      }
    })
  }

  const checkRun = useCallback(() => {
    if (!run?.apifyRunId) return
    startChecking(async () => {
      const result = await checkScrapeRun(run.apifyRunId!, cfg)
      setRun(result)
      if (result.status === 'completed') {
        const updated = await getLinkedInJobs()
        setJobs(updated)
      }
    })
  }, [run, cfg])

  // Auto-poll every 30s while running
  useEffect(() => {
    if (run?.status !== 'running' || !run.apifyRunId) return
    const t = setTimeout(checkRun, 30_000)
    return () => clearTimeout(t)
  }, [run, checkRun])

  const newCount = jobs.filter(j => j.status === 'new').length
  const filtered = jobs
    .filter(j => statusFilter === 'all' || j.status === statusFilter)
    .filter(j => !search || j.title.toLowerCase().includes(search.toLowerCase()) || j.company.toLowerCase().includes(search.toLowerCase()))

  const newInFiltered = filtered.filter(j => j.status === 'new')
  const allNewSelected = newInFiltered.length > 0 && newInFiltered.every(j => selected.has(j.$id!))

  function toggleSelect(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleSelectAll() {
    if (allNewSelected) setSelected(new Set())
    else setSelected(new Set(newInFiltered.map(j => j.$id!)))
  }

  function bulkPublish(ids: string[]) {
    if (ids.length === 0) return
    setBulkMsg(null)
    startBulk(async () => {
      const res = await publishMultipleLinkedInJobs(ids)
      setJobs(prev => prev.map(j => ids.includes(j.$id!) ? { ...j, status: 'published' } : j))
      setSelected(new Set())
      setBulkMsg(res.error ? `Erreur : ${res.error}` : `${res.published} offre${res.published > 1 ? 's' : ''} publiée${res.published > 1 ? 's' : ''} ✓`)
      setTimeout(() => setBulkMsg(null), 4000)
    })
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem', color: 'white' }}>

      {/* OAuth feedback banner */}
      {oauthMsg && (
        <div style={{ marginBottom: '1.5rem', padding: '0.875rem 1.25rem', borderRadius: 14, background: oauthMsg.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${oauthMsg.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          {oauthMsg.ok ? <CheckCircle2 style={{ width: 18, height: 18, color: '#10b981', flexShrink: 0 }} /> : <AlertCircle style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />}
          <p style={{ fontSize: 13, fontWeight: 600, color: oauthMsg.ok ? '#34d399' : '#f87171' }}>{oauthMsg.text}</p>
          <button onClick={() => setOauthMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)' }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
      )}

      {/* LinkedIn connection panel */}
      <LinkedInConnectionPanel publishConfig={publishConfig} onUpdate={setPublishConfig} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,102,194,0.15)', border: '1px solid rgba(10,102,194,0.25)' }}>
            <Linkedin style={{ width: 26, height: 26, color: '#0a66c2' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Scraping LinkedIn</h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Collecte automatique d&apos;offres via Apify</p>
          </div>
        </div>

        <button onClick={launchScrape} disabled={isPending || run?.status === 'running'}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700,
            background: isPending || run?.status === 'running' ? 'rgba(10,102,194,0.2)' : '#0a66c2',
            color: 'white', border: 'none', cursor: isPending || run?.status === 'running' ? 'default' : 'pointer',
            opacity: isPending || run?.status === 'running' ? 0.6 : 1,
            boxShadow: '0 4px 16px rgba(10,102,194,0.3)',
          }}>
          {isPending ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Play style={{ width: 16, height: 16 }} />}
          {isPending ? 'Démarrage…' : run?.status === 'running' ? 'En cours…' : 'Lancer le scraping'}
        </button>
      </div>

      {/* Run status */}
      {run && (
        <div style={{ marginBottom: '1.5rem' }}>
          <RunBanner run={run} onCheck={checkRun} checking={checking} />
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total scrapées', val: jobs.length, color: '#60a5fa' },
          { label: 'Nouvelles', val: newCount, color: '#f59e0b' },
          { label: 'Publiées', val: jobs.filter(j => j.status === 'published').length, color: '#10b981' },
          { label: 'Ignorées', val: jobs.filter(j => j.status === 'ignored').length, color: '#6b7280' },
        ].map(s => (
          <div key={s.label} style={{ padding: '0.875rem 1rem', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.val}</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', width: 'fit-content', marginBottom: '1.5rem' }}>
        {[
          { id: 'config' as const, label: 'Configuration', icon: Settings },
          { id: 'jobs'   as const, label: newCount > 0 ? `Offres (${newCount} nouvelles)` : 'Offres', icon: Zap },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 11, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: tab === t.id ? 'rgba(255,255,255,0.09)' : 'transparent',
              color: tab === t.id ? 'white' : 'rgba(255,255,255,0.35)',
            }}>
            <t.icon style={{ width: 13, height: 13 }} />{t.label}
          </button>
        ))}
      </div>

      {/* ── Config tab ── */}
      {tab === 'config' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Filtres */}
          <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '1.5rem' }}>Filtres de recherche</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <TagInput label="Mots-clés" values={cfg.keywords} onChange={v => set('keywords', v)} placeholder="React Developer, Chef de projet, DevOps…" />
              <TagInput label="Localisations" values={cfg.locations} onChange={v => set('locations', v)} placeholder="Paris, France, Lyon, Remote…" />
              <TagInput label="Industries" values={cfg.industries} onChange={v => set('industries', v)} placeholder="Information Technology, Finance…" />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>Types de contrat</p>
                  {[['full_time','CDI / Temps plein'],['contract','Mission / Contrat'],['part_time','Temps partiel']].map(([v,l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={cfg.jobTypes.includes(v)}
                        onChange={e => set('jobTypes', e.target.checked ? [...cfg.jobTypes, v] : cfg.jobTypes.filter(x => x !== v))}
                        style={{ accentColor: '#0a66c2' }} />
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{l}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>Niveaux d&apos;expérience</p>
                  {[['entry','Junior'],['mid','Confirmé'],['senior','Senior'],['director','Manager / Directeur']].map(([v,l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={cfg.experienceLevels.includes(v)}
                        onChange={e => set('experienceLevels', e.target.checked ? [...cfg.experienceLevels, v] : cfg.experienceLevels.filter(x => x !== v))}
                        style={{ accentColor: '#0a66c2' }} />
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{l}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 8 }}>Mode remote</label>
                  <select value={cfg.remoteFilter} onChange={e => set('remoteFilter', e.target.value as LinkedInScrapeConfig['remoteFilter'])}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', outline: 'none' }}>
                    <option value="any">Tous</option>
                    <option value="remote">Full remote</option>
                    <option value="hybrid">Hybride</option>
                    <option value="onsite">Présentiel</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 8 }}>
                    Max résultats : <span style={{ color: '#60a5fa' }}>{cfg.maxResults}</span>
                  </label>
                  <input type="range" min={5} max={100} value={cfg.maxResults}
                    onChange={e => set('maxResults', Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#0a66c2', marginTop: 10 }} />
                </div>
              </div>
            </div>
          </div>

          {/* Automatisation */}
          <div style={{ padding: '1.5rem', borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '1.25rem' }}>Automatisation</p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Publication automatique</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Publie directement les offres sans validation manuelle</p>
              </div>
              <button onClick={() => set('autoPublish', !cfg.autoPublish)}>
                {cfg.autoPublish
                  ? <ToggleRight style={{ width: 32, height: 32, color: '#0a66c2' }} />
                  : <ToggleLeft style={{ width: 32, height: 32, color: 'rgba(255,255,255,0.2)' }} />}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Fréquence</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Planification (manuel = bouton uniquement)</p>
              </div>
              <select value={cfg.frequency} onChange={e => set('frequency', e.target.value as LinkedInScrapeConfig['frequency'])}
                style={{ padding: '7px 12px', borderRadius: 10, fontSize: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', outline: 'none' }}>
                <option value="manual">Manuel</option>
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
              </select>
            </div>

            {cfg.lastRunAt && (
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Clock style={{ width: 12, height: 12 }} />
                Dernier run : {new Date(cfg.lastRunAt).toLocaleString('fr-FR')}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={save} disabled={isPending}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 700, background: saveStatus === 'ok' ? '#10b981' : 'rgba(255,255,255,0.08)', color: 'white', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
              {saveStatus === 'ok' ? <><Check style={{ width: 15, height: 15 }} />Enregistré</> : 'Enregistrer la configuration'}
            </button>
          </div>
        </div>
      )}

      {/* ── Jobs tab ── */}
      {tab === 'jobs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Search + filter bar */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <Search style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.25)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher titre, entreprise…"
                style={{ background: 'none', border: 'none', outline: 'none', color: 'white', fontSize: 13, flex: 1 }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all','new','published','ignored'] as const).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  style={{
                    padding: '8px 14px', borderRadius: 10, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: statusFilter === f ? 'rgba(10,102,194,0.25)' : 'rgba(255,255,255,0.05)',
                    color: statusFilter === f ? '#60a5fa' : 'rgba(255,255,255,0.35)',
                  }}>
                  {f === 'all' ? 'Tout' : f === 'new' ? 'Nouveaux' : f === 'published' ? 'Publiés' : 'Ignorés'}
                </button>
              ))}
            </div>
          </div>

          {/* Bulk action bar — visible only when 'new' jobs exist in view */}
          {newInFiltered.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' }}>
              {/* Select all toggle */}
              <button onClick={toggleSelectAll}
                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: allNewSelected ? '2px solid #0a66c2' : '2px solid rgba(255,255,255,0.2)',
                  background: allNewSelected ? '#0a66c2' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {allNewSelected && <Check style={{ width: 10, height: 10, color: 'white' }} />}
                </div>
                {allNewSelected ? 'Tout désélectionner' : `Tout sélectionner (${newInFiltered.length})`}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                {selected.size > 0 && (
                  <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600 }}>
                    {selected.size} offre{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Bulk publish selected */}
              {selected.size > 0 && (
                <button onClick={() => bulkPublish([...selected])} disabled={bulkPending}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: 'rgba(10,102,194,0.25)', color: '#60a5fa', border: '1px solid rgba(10,102,194,0.4)', cursor: bulkPending ? 'default' : 'pointer', opacity: bulkPending ? 0.6 : 1 }}>
                  {bulkPending ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Check style={{ width: 13, height: 13 }} />}
                  Publier la sélection ({selected.size})
                </button>
              )}

              {/* Publish all new */}
              <button onClick={() => bulkPublish(newInFiltered.map(j => j.$id!))} disabled={bulkPending}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: '#0a66c2', color: 'white', border: 'none', cursor: bulkPending ? 'default' : 'pointer', opacity: bulkPending ? 0.6 : 1, boxShadow: '0 2px 10px rgba(10,102,194,0.3)' }}>
                {bulkPending ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Zap style={{ width: 13, height: 13 }} />}
                Tout publier ({newInFiltered.length})
              </button>
            </div>
          )}

          {/* Bulk feedback */}
          {bulkMsg && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: 12, background: bulkMsg.startsWith('Erreur') ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', border: `1px solid ${bulkMsg.startsWith('Erreur') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, fontSize: 13, fontWeight: 600, color: bulkMsg.startsWith('Erreur') ? '#f87171' : '#34d399' }}>
              {bulkMsg}
            </div>
          )}

          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.2)' }}>
              <Globe style={{ width: 40, height: 40, margin: '0 auto 1rem', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>Aucune offre{search ? ' correspondante' : ''}.</p>
              {!search && <p style={{ fontSize: 12, marginTop: '0.5rem', opacity: 0.6 }}>Configurez vos filtres et lancez le scraping.</p>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filtered.map(job => (
                <JobCard key={job.$id} job={job}
                  selected={selected.has(job.$id!)}
                  onSelect={() => toggleSelect(job.$id!)}
                  onPublish={async () => {
                    await publishLinkedInJob(job.$id!)
                    setJobs(prev => prev.map(j => j.$id === job.$id ? { ...j, status: 'published' } : j))
                    setSelected(prev => { const s = new Set(prev); s.delete(job.$id!); return s })
                  }}
                  onIgnore={async () => {
                    await ignoreLinkedInJob(job.$id!)
                    setJobs(prev => prev.map(j => j.$id === job.$id ? { ...j, status: 'ignored' } : j))
                    setSelected(prev => { const s = new Set(prev); s.delete(job.$id!); return s })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
