'use client'

import { useState, useTransition } from 'react'
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Check, ExternalLink, Loader2, Megaphone, RefreshCw, Send, Share2, Clock, ImageIcon,
} from 'lucide-react'
import { NETWORKS, NETWORK_LABEL, type Network, type SocialConfig } from '@/lib/social-content'
import type { SocialPost, SocialStatus } from '@/lib/social'
import { publishJobAction, refreshPostsAction, retryPostAction, saveSocialConfigAction, sendTestAction } from './actions'

const NET_COLOR: Record<Network, string> = { linkedin: '#0a66c2', instagram: '#e1306c', facebook: '#1877f2', x: '#e5e7eb' }
const STATUS: Record<SocialStatus, { label: string; color: string }> = {
  queued: { label: 'En file', color: '#9ca3af' }, sent: { label: 'Création du visuel', color: '#1d4ed8' }, images_ready: { label: 'Visuels prêts', color: '#6d28d9' },
  published: { label: 'Publié', color: '#047857' }, partial: { label: 'Partiel', color: '#b45309' }, failed: { label: 'Échec', color: '#b91c1c' },
}
const card = { background: 'var(--admin-panel)', border: '1px solid var(--admin-line)' }
const field = { background: 'var(--admin-panel-raised)', border: '1px solid var(--admin-line)', color: 'var(--admin-fg)' }

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="relative w-11 h-6 rounded-full shrink-0 transition-colors" style={{ background: on ? '#B8860B' : 'var(--admin-hover)' }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
    </button>
  )
}


const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

export function SocialClient({ initialConfig, initialPosts, jobs, env, devPanel }: {
  initialConfig: SocialConfig; initialPosts: SocialPost[]; jobs: { id: string; title: string; company: string }[]
  env: { configured: boolean }; devPanel?: React.ReactNode
}) {
  const [cfg, setCfg] = useState(initialConfig)
  const [posts, setPosts] = useState(initialPosts)
  const [saved, setSaved] = useState(false)
  const [hashtags, setHashtags] = useState(initialConfig.hashtags.join(' '))
  const [jobId, setJobId] = useState('')
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)

  const set = <K extends keyof SocialConfig>(k: K, v: SocialConfig[K]) => { setCfg(c => ({ ...c, [k]: v })); setSaved(false) }

  function save() {
    startTransition(async () => {
      const res = await saveSocialConfigAction({ ...cfg, hashtags: hashtags.split(/[\s,]+/).filter(Boolean) })
      if (res.config) { setCfg(res.config); setHashtags(res.config.hashtags.join(' ')); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    })
  }

  async function reload() { setPosts(await refreshPostsAction()) }

  async function publish(force: boolean) {
    if (!jobId) return
    setBusy('publish'); setPublishMsg(null)
    const r = await publishJobAction(jobId, force)
    setPublishMsg(r.message); setBusy(null)
    await reload()
  }

  async function retry(id: string) {
    setBusy(id)
    await retryPostAction(id)
    await reload(); setBusy(null)
  }

  return (
    <div className="min-h-full p-6 sm:p-8 max-w-5xl mx-auto space-y-6" style={{ color: 'var(--admin-fg)' }}>
      <div>
        <p className="text-[11px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: 'var(--admin-fg-muted)' }}>SITE</p>
        <h1 className="text-admin-fg flex items-center gap-3" style={{ fontSize: '1.75rem', fontWeight: 700 }}><Share2 className="h-6 w-6" style={{ color: '#e8a33d' }} />Publication multi-réseaux</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--admin-fg-muted)' }}>Chaque offre publiée par un recruteur est diffusée sur LinkedIn, Instagram, Facebook et X avec une image générée par IA, le lien de l’offre et le Calendly de My Best Consultant.</p>
      </div>

      <StatusBanner configured={env.configured} />
      {devPanel}

      {/* ── Réglages ── */}
      <section className="rounded-2xl p-5 space-y-5" style={card}>
        <h2 style={{ fontSize: "1rem" }} className="font-semibold text-admin-fg">Réglages</h2>
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-admin-fg">Publication automatique</p><p className="text-xs mt-0.5" style={{ color: 'var(--admin-fg-muted)' }}>Chaque nouvelle offre créée par un recruteur est publiée sans action de sa part. Désactivée tant que vous ne l’activez pas.</p></div>
          <Toggle on={cfg.autoPublish} onChange={v => set('autoPublish', v)} label="Publication automatique" />
        </div>
        <div>
          <p className="text-sm font-semibold text-admin-fg mb-2">Réseaux</p>
          <div className="flex flex-wrap gap-2">
            {NETWORKS.map(n => (
              <button key={n} type="button" onClick={() => set('networks', { ...cfg.networks, [n]: !cfg.networks[n] })} className="px-3.5 py-2 rounded-xl text-xs font-bold transition-all"
                style={cfg.networks[n] ? { background: `${NET_COLOR[n]}26`, color: NET_COLOR[n], border: `1px solid ${NET_COLOR[n]}80` } : { background: 'var(--admin-panel)', color: 'var(--admin-fg-muted)', border: '1px solid var(--admin-line)' }}>
                {cfg.networks[n] ? '✓ ' : ''}{NETWORK_LABEL[n]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5"><p className="text-sm font-semibold text-admin-fg">Calendly de My Best Consultant</p><Toggle on={cfg.includeCalendly} onChange={v => set('includeCalendly', v)} label="Inclure Calendly" /></div>
            <input value={cfg.calendlyUrl} onChange={e => set('calendlyUrl', e.target.value)} placeholder="https://calendly.com/mybestconsultant/… (défaut : lien du site)" disabled={!cfg.includeCalendly} className="w-full px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-40" style={field} />
            <p className="text-[11px] mt-1" style={{ color: 'var(--admin-fg-muted)' }}>Ajouté au texte de chaque publication (« Réserver un échange »). C’est toujours le vôtre, jamais celui d’un recruteur.</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-admin-fg mb-1.5">Visuel</p>
            <p className="text-xs leading-relaxed rounded-lg px-3 py-2.5" style={{ background: 'var(--admin-panel)', color: 'var(--admin-fg-muted)' }}>Une affiche portrait (1080 × 1350) générée par IA, avec le logo My Best Consultant et une scène propre à chaque poste, identique sur tous les réseaux. YouTube Shorts (vidéo) viendra dans une seconde étape.</p>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-admin-fg mb-1.5">Hashtags par défaut</p>
          <input value={hashtags} onChange={e => { setHashtags(e.target.value); setSaved(false) }} placeholder="recrutement emploi IT consulting" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={field} />
        </div>
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Enregistré</span>}
          <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: '#B8860B', color: 'white' }}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</button>
        </div>
      </section>

      {/* ── Publication manuelle ── */}
      <section className="rounded-2xl p-5" style={card}>
        <h2 style={{ fontSize: "1rem" }} className="font-semibold text-admin-fg mb-3 flex items-center gap-2"><Megaphone className="h-4 w-4" style={{ color: '#e8a33d' }} />Publier une offre maintenant</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={jobId} onChange={e => { setJobId(e.target.value); setPublishMsg(null) }} className="flex-1 min-w-[220px] px-3 py-2.5 rounded-lg text-sm outline-none" style={field}>
            <option value="" style={{ color: '#000' }}>Choisir une offre active…</option>
            {jobs.map(j => <option key={j.id} value={j.id} style={{ color: '#000' }}>{j.title}{j.company ? ` — ${j.company}` : ''}</option>)}
          </select>
          <button type="button" onClick={() => publish(false)} disabled={!jobId || !env.configured || busy === 'publish'} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: '#B8860B', color: 'white' }}>{busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publier</button>
          <button type="button" onClick={() => publish(true)} disabled={!jobId || !env.configured || busy === 'publish'} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg)' }}>Republier</button>
        </div>
        {publishMsg && <p className="text-xs mt-2" style={{ color: 'var(--admin-fg-muted)' }}>{publishMsg}</p>}
      </section>

      {/* ── Historique ── */}
      <section className="rounded-2xl overflow-hidden" style={card}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--admin-line)' }}>
          <h2 style={{ fontSize: "1rem" }} className="font-semibold text-admin-fg">Historique des publications</h2>
          <button type="button" onClick={reload} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--admin-fg-muted)' }}><RefreshCw className="h-3.5 w-3.5" />Actualiser</button>
        </div>
        {posts.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: 'var(--admin-fg-muted)' }}>Aucune publication pour le moment.</p>
        ) : posts.map(p => {
          const st = p.stale ? { label: 'Sans confirmation', color: '#b45309' } : STATUS[p.status] ?? STATUS.queued
          const isOpen = open === p.id
          return (
            <div key={p.id} style={{ borderTop: '1px solid var(--admin-line)' }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="w-full text-left px-5 py-3.5 flex items-center gap-3 flex-wrap hover:bg-admin-panel">
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${st.color}22`, color: st.color }}>{st.label}</span>
                <span className="flex-1 min-w-[180px] text-sm font-semibold truncate text-admin-fg">{p.jobTitle || 'Offre'}</span>
                <span className="text-[11px]" style={{ color: 'var(--admin-fg-muted)' }}>{p.trigger === 'auto' ? 'Auto' : `Manuel · ${p.requestedBy}`}</span>
                <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--admin-fg-muted)' }}><Clock className="h-3 w-3" />{fmt(p.createdAt)}</span>
                {isOpen ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--admin-fg-muted)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--admin-fg-muted)' }} />}
              </button>
              {isOpen && (
                <div className="px-5 pb-5 space-y-3">
                  {p.error && <p className="text-xs flex items-start gap-1.5 text-red-700"><AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{p.error}</p>}
                  {p.results.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {p.results.map(r => (
                        <span key={r.network} className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: r.status === 'failed' ? 'rgba(248,113,113,0.14)' : 'rgba(52,211,153,0.14)', color: r.status === 'failed' ? '#b91c1c' : '#047857' }} title={r.error}>
                          {NETWORK_LABEL[r.network]} · {r.status === 'published' ? 'publié' : r.status === 'scheduled' ? 'programmé' : r.status === 'skipped' ? 'ignoré' : 'échec'}
                          {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Voir sur ${NETWORK_LABEL[r.network]}`}><ExternalLink className="h-3 w-3" /></a>}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {p.images.map(u => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--admin-panel-raised)', color: 'var(--admin-fg)' }}><ImageIcon className="h-3 w-3" />Slide</a>)}
                    </div>
                  )}
                  {p.caption && <pre className="text-[11px] leading-relaxed whitespace-pre-wrap rounded-xl p-3 max-h-48 overflow-auto" style={{ background: 'rgba(0,0,0,0.25)', color: 'var(--admin-fg-muted)', fontFamily: 'inherit' }}>{p.caption}</pre>}
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => retry(p.id)} disabled={busy === p.id || !env.configured} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--admin-hover)', color: 'var(--admin-fg)' }}>
                      {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Relancer la publication
                    </button>
                    <span className="text-[11px]" style={{ color: 'var(--admin-fg-muted)' }}>{p.attempts} envoi{p.attempts > 1 ? 's' : ''}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

// Ce que voit le client : un simple état, sans détail technique.
function StatusBanner({ configured }: { configured: boolean }) {
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function test() {
    setTesting(true); setMsg(null)
    const r = await sendTestAction()
    setMsg({ ok: r.ok, text: r.message }); setTesting(false)
  }
  return (
    <div className="rounded-2xl px-5 py-4 flex items-start gap-3" style={{ background: configured ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.08)', border: `1px solid ${configured ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}` }}>
      {configured ? <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-700" /> : <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-700" />}
      <div>
        <p className="text-sm font-semibold text-admin-fg">{configured ? 'La diffusion sur les réseaux est active' : 'La diffusion sur les réseaux n’est pas encore activée'}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--admin-fg-muted)' }}>{configured ? 'Vous pouvez régler ci-dessous ce qui est publié et où, et lancer une publication à la main.' : 'Les réglages ci-dessous sont enregistrés dès maintenant. Contactez l’équipe technique pour finaliser l’activation.'}</p>
        {configured && (
          <div className="flex items-center gap-3 flex-wrap mt-3">
            <button type="button" onClick={test} disabled={testing} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--admin-hover)', color: 'var(--admin-fg)' }}>
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Envoyer un test
            </button>
            {msg && <span className="text-xs inline-flex items-center gap-1.5" style={{ color: msg.ok ? '#047857' : '#b91c1c' }}>{msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}{msg.text}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
