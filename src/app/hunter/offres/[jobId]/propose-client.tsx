'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, CheckCircle2, ExternalLink, Loader2, MapPin, Send } from 'lucide-react'
import { proposeAction } from '../../actions'

export interface ProposeProfile {
  id: string; name: string; title: string; city: string; skills: string[]; rate: string; availability: string
  years: number | null; hasCv: boolean; alreadyProposed: boolean; score: number; matched: string[]
}

const scoreStyle = (s: number) => s >= 60 ? { bg: 'rgba(16,185,129,0.14)', fg: '#059669' } : s >= 30 ? { bg: 'rgba(232,163,61,0.16)', fg: '#b8862f' } : { bg: 'rgba(107,114,128,0.12)', fg: '#6b7280' }

export function ProposeClient({ job, profiles, hunterName }: {
  job: { id: string; title: string; company: string; location: string; skills: string[]; description: string }
  profiles: ProposeProfile[]; hunterName: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pitch, setPitch] = useState('')
  const [edited, setEdited] = useState(false)
  const [result, setResult] = useState<{ proposed: number; skipped: string[]; error?: string } | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const chosen = useMemo(() => profiles.filter(p => selected.has(p.id)), [profiles, selected])

  // Message d'accompagnement pré-rempli d'après les profils choisis — tant que le chasseur ne l'a pas modifié lui-même.
  function draft(list: ProposeProfile[]): string {
    if (list.length === 0) return ''
    const who = list.map(p => `• ${p.name}${p.title ? ` — ${p.title}` : ''}${p.years !== null ? ` (${p.years} ans d’expérience)` : ''}${p.matched.length ? `\n  Compétences en phase avec l’offre : ${p.matched.join(', ')}` : ''}${p.availability ? `\n  Disponibilité : ${p.availability}` : ''}${p.rate ? `\n  Prétentions : ${p.rate}` : ''}`).join('\n')
    return `Bonjour,\n\nJe vous propose ${list.length > 1 ? 'les profils suivants' : 'le profil suivant'} pour votre offre « ${job.title} » :\n\n${who}\n\nJe reste à votre disposition pour organiser un échange.\n\nCordialement,\n${hunterName}`
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
    if (!edited) setPitch(draft(profiles.filter(p => next.has(p.id))))
  }

  function submit() {
    setResult(null)
    startTransition(async () => {
      const res = await proposeAction(job.id, [...selected], pitch)
      setResult(res)
      if (res.proposed > 0) {
        setDone(d => new Set([...d, ...selected]))
        setSelected(new Set()); setPitch(''); setEdited(false)
      }
    })
  }

  const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' }

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
      <div className="min-w-0 space-y-5">
        <Link href="/hunter/offres" className="inline-flex items-center gap-1.5 text-xs font-semibold no-underline" style={{ color: 'var(--color-text-muted)' }}><ArrowLeft className="h-3.5 w-3.5" />Toutes les offres</Link>

        <section className="rounded-3xl p-5 sm:p-6" style={card}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div><p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>L’offre</p>
              <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}><MapPin className="h-3.5 w-3.5" />{job.location}</p></div>
            <Link href={`/jobs/${job.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Voir l’annonce complète<ExternalLink className="h-3 w-3" /></Link>
          </div>
          {job.skills.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{job.skills.map(s => <span key={s} className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: 'rgba(20,184,166,0.12)', color: '#0d9488' }}>{s}</span>)}</div>}
          {job.description && <p className="text-sm mt-3 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{job.description}{job.description.length >= 700 ? '…' : ''}</p>}
        </section>

        <section>
          <h2 className="font-bold mb-3" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>Choisissez le ou les profils à proposer</h2>
          {profiles.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={card}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Votre vivier est vide.</p>
              <Link href="/hunter/vivier" className="inline-block mt-2 text-sm font-bold no-underline" style={{ color: 'var(--color-primary)' }}>Importer des CV →</Link>
            </div>
          ) : (
            <div className="space-y-2.5">
              {profiles.map(p => {
                const off = p.alreadyProposed || done.has(p.id) || !p.hasCv
                const on = selected.has(p.id)
                const st = scoreStyle(p.score)
                return (
                  <button key={p.id} type="button" disabled={off} onClick={() => toggle(p.id)} className="w-full text-left flex items-center gap-3.5 rounded-2xl p-4 transition-all disabled:cursor-not-allowed"
                    style={{ background: on ? 'rgba(20,184,166,0.08)' : 'var(--color-surface)', border: `1.5px solid ${on ? '#14b8a6' : 'var(--color-border)'}`, opacity: off ? 0.6 : 1 }}>
                    <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: on ? '#14b8a6' : 'transparent', border: `1.5px solid ${on ? '#14b8a6' : 'var(--color-border)'}`, color: 'white' }}>{on && <Check className="h-4 w-4" />}</span>
                    <span className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 font-bold" style={{ background: st.bg, color: st.fg }}><span className="text-sm leading-none">{p.score}%</span></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{p.name}{p.title ? <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}> — {p.title}</span> : ''}</p>
                      <div className="flex flex-wrap items-center gap-x-3 mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {p.city && <span>{p.city}</span>}{p.availability && <span>Dispo : {p.availability}</span>}{p.rate && <span>{p.rate}</span>}
                      </div>
                      {p.matched.length > 0 && <p className="text-[11px] mt-1" style={{ color: '#0d9488' }}>✓ {p.matched.join(', ')}</p>}
                    </div>
                    {(p.alreadyProposed || done.has(p.id)) && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>Déjà proposé</span>}
                    {!p.hasCv && <span className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>CV manquant</span>}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="rounded-3xl p-5 space-y-4 lg:sticky lg:top-[84px]" style={{ ...card, boxShadow: '0 16px 40px -22px rgba(11,29,81,0.2)' }}>
        <div><p className="font-bold" style={{ color: 'var(--color-text)' }}>Votre proposition</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{chosen.length === 0 ? 'Sélectionnez au moins un profil.' : `${chosen.length} profil${chosen.length > 1 ? 's' : ''} sélectionné${chosen.length > 1 ? 's' : ''}`}</p></div>
        <label className="block"><span className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--color-text)' }}>Message au recruteur <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(modifiable)</span></span>
          <textarea value={pitch} onChange={e => { setPitch(e.target.value); setEdited(true) }} rows={11} maxLength={2800} placeholder="Sélectionnez un profil pour générer un message d’accompagnement…"
            className="w-full px-3.5 py-3 rounded-xl text-sm outline-none resize-y" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} /></label>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>Le recruteur reçoit le CV et ce message dans son pipeline. Les coordonnées du candidat restent privées : c’est vous qui restez l’interlocuteur.</p>
        <button type="button" onClick={submit} disabled={pending || chosen.length === 0} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold disabled:opacity-45" style={{ background: '#14b8a6', color: 'white' }}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{pending ? 'Envoi…' : `Proposer ${chosen.length > 1 ? `ces ${chosen.length} profils` : 'ce profil'}`}
        </button>
        {result && (
          <div className="rounded-xl p-3 text-sm space-y-1" style={{ background: result.proposed > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${result.proposed > 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, color: result.proposed > 0 ? '#047857' : '#b91c1c' }}>
            {result.proposed > 0 && <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4" />{result.proposed} profil{result.proposed > 1 ? 's' : ''} proposé{result.proposed > 1 ? 's' : ''} — <Link href="/hunter/propositions" style={{ textDecoration: 'underline' }}>suivre</Link></p>}
            {result.error && <p>{result.error}</p>}
            {result.skipped.map(s => <p key={s} className="text-xs" style={{ color: '#92400e' }}>• {s}</p>)}
          </div>
        )}
      </aside>
    </div>
  )
}
