'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  BadgeCheck, Bot, Brain, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, GitBranch, GripVertical, Loader2, Lock,
  Minus, Phone, Plus, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2, Users, Video, X, Scale, ArrowRight,
} from 'lucide-react'
import type { FunnelStage } from '@/types'
import {
  FUNNEL_LIMITS, STEP_ORDER, STEP_TYPES, addStep, countOf, currentIndex, defaultFunnel, progress, removeLastOfType, renumber,
  type FunnelStep, type StepResult, type StepStatus, type StepType,
} from '@/lib/candidate-funnel'
import { generateStepReportAction, saveCandidateFunnelAction, saveStepProgressAction, validateStepAction } from './actions'
import type { PipelineCandidate } from './pipeline-client'

const ICON: Record<StepType, React.ElementType> = { screening: Brain, ai_interview: Bot, phone: Phone, video: Video, onsite: Users, other: ClipboardList, hired: BadgeCheck }
const STATUS_LABEL: Record<StepStatus, string> = { todo: 'À faire', scheduled: 'Planifié', done: 'Réalisé', validated: 'Validé', skipped: 'Passée' }
const RESULT: Record<StepResult, { label: string; color: string; Icon: React.ElementType }> = {
  positive: { label: 'Favorable', color: '#10b981', Icon: ThumbsUp },
  neutral: { label: 'Réservé', color: '#f59e0b', Icon: Scale },
  negative: { label: 'Défavorable', color: '#ef4444', Icon: ThumbsDown },
}
const input = { background: 'var(--color-background, #fff)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

function StepBadge({ type, size = 36, done }: { type: StepType; size?: number; done?: boolean }) {
  const Icon = ICON[type]
  const c = STEP_TYPES[type].color
  return (
    <span className="shrink-0 rounded-xl flex items-center justify-center" style={{ width: size, height: size, background: done ? c : `${c}1c`, color: done ? '#fff' : c }}>
      {done ? <Check style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={3} /> : <Icon style={{ width: size * 0.5, height: size * 0.5 }} />}
    </span>
  )
}

/**
 * Funnel de recrutement d'un candidat, ouvert depuis sa carte : le parcours étape par étape (statut, résultat, compte rendu,
 * validation humaine) et sa personnalisation — étapes dans l'ordre et en nombre libres (ex. 3 entretiens IA). Une fois validé,
 * le funnel est enregistré et le pipeline se met à jour.
 */
export function FunnelModal({ jobId, candidate, stages, pipelineName, onClose, onFunnelChange, onMoveTo }: {
  jobId: string
  candidate: PipelineCandidate
  stages: FunnelStage[]
  pipelineName: string
  onClose: () => void
  onFunnelChange: (appId: string, steps: FunnelStep[], stages?: FunnelStage[]) => void
  onMoveTo: (column: string, autoAction?: string) => void
}) {
  const initial = candidate.funnel ?? defaultFunnel()
  const [steps, setSteps] = useState<FunnelStep[]>(initial)
  const [mode, setMode] = useState<'track' | 'edit'>('track')
  const [draft, setDraft] = useState<FunnelStep[]>([])
  const [openId, setOpenId] = useState<string | null>(() => initial[Math.max(0, currentIndex(initial))]?.id ?? null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, start] = useTransition()
  const [generating, setGenerating] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  // brouillon de l'étape ouverte (statut / résultat / compte rendu)
  const [form, setForm] = useState<{ status?: StepStatus; result?: StepResult; report: string; reportBy?: 'ai' | 'manual' }>(() => {
    const s = initial[Math.max(0, currentIndex(initial))]
    return { status: s?.status, result: s?.result, report: s?.report ?? '', reportBy: s?.reportBy }
  })

  const name = candidate.candidateName || candidate.candidateEmail
  const cur = currentIndex(steps)
  const prog = progress(steps)

  function openStep(s: FunnelStep) {
    setOpenId(s.id); setError(''); setNotice('')
    setForm({ status: s.status, result: s.result, report: s.report ?? '', reportBy: s.reportBy })
  }

  function apply(next: FunnelStep[], nextStages?: FunnelStage[]) {
    setSteps(next); onFunnelChange(candidate.appId, next, nextStages)
  }

  function saveProgress() {
    const s = steps.find(x => x.id === openId); if (!s) return
    setError(''); setNotice('')
    start(async () => {
      const res = await saveStepProgressAction(candidate.appId, jobId, s.id, form)
      if (res.error || !res.funnel) { setError(res.error ?? 'Enregistrement impossible.'); return }
      apply(res.funnel, res.stages); setNotice('Étape enregistrée.')
    })
  }

  function validate() {
    const s = steps.find(x => x.id === openId); if (!s) return
    setError(''); setNotice('')
    start(async () => {
      const res = await validateStepAction(candidate.appId, jobId, s.id, form)
      if (res.error || !res.funnel) { setError(res.error ?? 'Validation impossible.'); return }
      apply(res.funnel, res.stages)
      const next = res.next
      if (next) {
        // La candidature suit son funnel : elle passe dans la colonne de l'étape suivante (screening / entretien IA : la fenêtre correspondante s'ouvre).
        onMoveTo(next.column, next.autoAction)
        if (next.autoAction) { onClose(); return }
        const ns = res.funnel.find(x => x.id === next.id)
        if (ns) openStep(ns)
        setNotice(`Étape validée — prochaine étape : ${next.label}.`)
      } else {
        setOpenId(null); setNotice('Parcours terminé : toutes les étapes sont validées.')
      }
    })
  }

  function generate() {
    const s = steps.find(x => x.id === openId); if (!s) return
    setGenerating(true); setError(''); setNotice('')
    generateStepReportAction(candidate.appId, jobId, s.id, { result: form.result, notes: form.report }).then(res => {
      if (res.error || !res.report) setError(res.error ?? 'Génération impossible.')
      else { setForm(f => ({ ...f, report: res.report!, reportBy: 'ai' })); setNotice('Compte rendu proposé par l’IA : relisez-le et corrigez-le avant de valider.') }
    }).finally(() => setGenerating(false))
  }

  // ── Personnalisation ──
  function startEdit() { setDraft(steps.map(s => ({ ...s }))); setError(''); setNotice(''); setMode('edit') }
  const locked = (s: FunnelStep) => s.status === 'validated'
  function move(from: number, to: number) {
    if (to < 0 || to >= draft.length || from === to || locked(draft[from]) || locked(draft[to])) return
    const n = [...draft]; const [it] = n.splice(from, 1); n.splice(to, 0, it); setDraft(renumber(n))
  }
  function saveFunnel() {
    setError('')
    start(async () => {
      const res = await saveCandidateFunnelAction(candidate.appId, jobId, draft)
      if (res.error || !res.funnel) { setError(res.error ?? 'Enregistrement impossible.'); return }
      apply(res.funnel, res.stages)
      const first = res.funnel[Math.max(0, currentIndex(res.funnel))]
      if (first) openStep(first)
      setMode('track'); setNotice('Funnel enregistré : le pipeline est à jour.')
    })
  }

  const body = (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,15,20,0.62)' }} onClick={onClose}>
      <div className={`w-full ${mode === 'edit' ? 'sm:max-w-3xl' : 'sm:max-w-2xl'} max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden transition-[max-width] duration-200`}
        style={{ background: 'var(--page-bg, var(--color-background))', boxShadow: '0 30px 90px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>

        {/* En-tête */}
        <div className="px-5 sm:px-6 pt-5 pb-4 shrink-0" style={{ background: 'var(--hero-bg)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.16)' }}><GitBranch className="h-5 w-5" style={{ color: '#E8A33D' }} /></div>
              <div className="min-w-0">
                <h3 className="font-bold text-white truncate" style={{ fontSize: '1.05rem' }}>Funnel de recrutement</h3>
                <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>{name} · {pipelineName}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg" style={{ color: 'rgba(255,255,255,0.6)' }}><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span>{prog.current ? `Étape en cours : ${prog.current.label}` : 'Parcours terminé'}</span><span>{prog.done} / {steps.length} étapes</span>
            </div>
            <div className="flex gap-1">
              {(mode === 'edit' ? draft : steps).map((s, i) => {
                const done = s.status === 'validated' || s.status === 'skipped'
                const isCur = mode === 'track' && i === cur
                return <span key={s.id} className="h-1.5 flex-1 rounded-full transition-colors" style={{ background: done ? STEP_TYPES[s.type].color : isCur ? `${STEP_TYPES[s.type].color}99` : 'rgba(255,255,255,0.14)' }} title={s.label} />
              })}
            </div>
          </div>
          <div className="flex gap-1 mt-4 -mb-4">
            {([['track', 'Suivi'], ['edit', 'Personnaliser le funnel']] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => (id === 'edit' ? startEdit() : setMode('track'))} className="px-4 py-2.5 text-sm font-semibold rounded-t-xl transition-colors"
                style={mode === id ? { background: 'var(--page-bg, var(--color-background))', color: 'var(--color-text)' } : { color: 'rgba(255,255,255,0.6)' }}>{label}</button>
            ))}
          </div>
        </div>

        <div className="overflow-y-auto p-5 sm:p-6 flex-1">
          {(error || notice) && (
            <div className="rounded-xl px-3.5 py-2.5 text-sm mb-4" style={error ? { background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.25)' } : { background: 'rgba(16,185,129,0.08)', color: '#047857', border: '1px solid rgba(16,185,129,0.25)' }}>{error || notice}</div>
          )}

          {mode === 'track' ? (
            <ol className="relative">
              {steps.map((s, i) => {
                const meta = STEP_TYPES[s.type]
                const isCur = i === cur
                const isDone = s.status === 'validated'
                const open = openId === s.id
                const editable = isCur
                return (
                  <li key={s.id} className="relative pl-14 pb-4 last:pb-0">
                    {i < steps.length - 1 && <span className="absolute left-[17px] top-10 bottom-0 w-0.5" style={{ background: isDone || s.status === 'skipped' ? meta.color : 'var(--color-border)' }} />}
                    <span className="absolute left-0 top-0"><StepBadge type={s.type} done={isDone} /></span>
                    <div className="rounded-2xl transition-shadow" style={{ background: 'var(--color-surface)', border: `1px solid ${isCur ? meta.color : 'var(--color-border)'}`, boxShadow: isCur ? `0 12px 30px -16px ${meta.color}` : 'none', opacity: !isCur && !isDone && s.status !== 'skipped' ? 0.85 : 1 }}>
                      <button type="button" onClick={() => (open ? setOpenId(null) : openStep(s))} className="w-full flex items-center gap-2 px-4 py-3 text-left">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm truncate" style={{ color: isCur ? meta.color : 'var(--color-text)' }}>{s.label}</p>
                          <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{meta.description}</p>
                        </div>
                        {s.result && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: `${RESULT[s.result].color}1c`, color: RESULT[s.result].color }}>{RESULT[s.result].label}</span>}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={isDone ? { background: `${meta.color}1c`, color: meta.color } : isCur ? { background: `${meta.color}1c`, color: meta.color } : { background: 'rgba(0,0,0,0.05)', color: 'var(--color-text-muted)' }}>{isCur ? (s.status === 'todo' ? 'EN COURS' : STATUS_LABEL[s.status]) : STATUS_LABEL[s.status]}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : undefined }} />
                      </button>

                      {open && (
                        <div className="px-4 pb-4 pt-1 space-y-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                          {editable ? (
                            <>
                              <div className="pt-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Statut de l’étape</p>
                                <div className="flex flex-wrap gap-2">
                                  {(['todo', 'scheduled', 'done'] as StepStatus[]).map(st => (
                                    <button key={st} type="button" onClick={() => setForm(f => ({ ...f, status: st }))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                                      style={form.status === st ? { background: `${meta.color}1f`, color: meta.color, border: `1px solid ${meta.color}` } : { border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                      {st === 'scheduled' && <CalendarClock className="h-3.5 w-3.5" />}{st === 'done' && <CheckCircle2 className="h-3.5 w-3.5" />}{STATUS_LABEL[st]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Résultat</p>
                                <div className="grid grid-cols-3 gap-2">
                                  {(Object.keys(RESULT) as StepResult[]).map(r => {
                                    const R = RESULT[r]
                                    const on = form.result === r
                                    return (
                                      <button key={r} type="button" onClick={() => setForm(f => ({ ...f, result: on ? undefined : r }))} className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                                        style={on ? { background: `${R.color}1c`, color: R.color, border: `1.5px solid ${R.color}` } : { border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                                        <R.Icon className="h-4 w-4" />{R.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Compte rendu</p>
                                  <button type="button" onClick={generate} disabled={generating} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60 transition-opacity hover:opacity-90" style={{ background: 'linear-gradient(135deg, #7c3aed, #6366f1)', color: 'white' }}>
                                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{generating ? 'Rédaction…' : 'Générer avec l’IA'}
                                  </button>
                                </div>
                                <textarea value={form.report} onChange={e => setForm(f => ({ ...f, report: e.target.value, reportBy: 'manual' }))} rows={5} maxLength={FUNNEL_LIMITS.report}
                                  placeholder="Synthèse de l’échange, points forts, points de vigilance… (ou laissez l’IA le rédiger à partir de ce que l’on sait du candidat)"
                                  className="w-full rounded-xl px-3.5 py-2.5 text-sm leading-relaxed outline-none resize-y" style={input} />
                                <div className="flex items-center justify-between text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                  <span>{form.reportBy === 'ai' && form.report ? '✨ Rédigé par l’IA — à relire avant validation' : ''}</span><span>{form.report.length}/{FUNNEL_LIMITS.report}</span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                                <button type="button" onClick={saveProgress} disabled={pending} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Enregistrer</button>
                                <button type="button" onClick={validate} disabled={pending || !form.result} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-opacity hover:opacity-90" style={{ background: '#1c1c1e', color: 'white' }}
                                  title={form.result ? '' : 'Choisissez un résultat pour valider'}>
                                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  {steps[i + 1] ? <>Valider · passer à « {steps[i + 1].label} » <ArrowRight className="h-4 w-4" /></> : 'Valider et clôturer le parcours'}
                                </button>
                              </div>
                              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>La validation est obligatoire pour passer à l’étape suivante : elle reste une décision du recruteur.</p>
                            </>
                          ) : (
                            <div className="pt-3 space-y-2">
                              {s.report ? <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--color-text)' }}>{s.report}</p> : <p className="text-sm italic" style={{ color: 'var(--color-text-muted)' }}>{isDone || s.status === 'skipped' ? 'Aucun compte rendu.' : 'Cette étape sera disponible une fois la précédente validée.'}</p>}
                              {s.reportBy === 'ai' && s.report && <p className="text-[11px]" style={{ color: '#7c3aed' }}>✨ Compte rendu rédigé par l’IA et relu par le recruteur</p>}
                              {isDone && s.validatedAt && <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Validée le {new Date(s.validatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}{s.validatedBy ? ` par ${s.validatedBy}` : ''}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
              <li className="pl-14 pt-1"><Link href="/recruiter/funnel" className="text-xs font-semibold no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>Gérer les colonnes du pipeline →</Link></li>
            </ol>
          ) : (
            <div className="space-y-6">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Composez le parcours de <strong style={{ color: 'var(--color-text)' }}>{name}</strong> : choisissez le nombre d’étapes de chaque type puis réordonnez-les. À la validation, le pipeline se met à jour automatiquement.</p>

              {/* Nombre d'étapes par type */}
              <div className="grid sm:grid-cols-2 gap-2.5">
                {STEP_ORDER.map(t => {
                  const meta = STEP_TYPES[t]; const n = countOf(draft, t); const Icon = ICON[t]
                  const max = meta.repeatable ? FUNNEL_LIMITS.perType : 1
                  const removable = draft.some(s => s.type === t && s.status !== 'validated')
                  return (
                    <div key={t} className="rounded-2xl p-3 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: `1px solid ${n > 0 ? `${meta.color}80` : 'var(--color-border)'}` }}>
                      <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${meta.color}1c`, color: meta.color }}><Icon className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{meta.label}</p>
                        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{meta.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button type="button" onClick={() => setDraft(d => removeLastOfType(d, t))} disabled={!removable} aria-label={`Retirer ${meta.label}`} className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}><Minus className="h-3.5 w-3.5" /></button>
                        <span className="w-5 text-center text-sm font-bold" style={{ color: n > 0 ? meta.color : 'var(--color-text-muted)' }}>{n}</span>
                        <button type="button" onClick={() => setDraft(d => addStep(d, t))} disabled={n >= max || draft.length >= FUNNEL_LIMITS.steps} aria-label={`Ajouter ${meta.label}`} className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30" style={{ background: meta.color, color: 'white' }}><Plus className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Ordre du parcours */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-text-muted)' }}>Ordre du parcours · {draft.length} étape{draft.length > 1 ? 's' : ''}</p>
                <div className="space-y-2">
                  {draft.map((s, i) => {
                    const meta = STEP_TYPES[s.type]
                    const lock = locked(s)
                    return (
                      <div key={s.id} draggable={!lock} onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null) }} onDragEnd={() => setDragFrom(null)}
                        className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: dragFrom === i ? 0.5 : 1 }}>
                        {lock ? <Lock className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-label="Étape validée" /> : <GripVertical className="h-4 w-4 shrink-0 cursor-grab" style={{ color: 'var(--color-text-muted)' }} aria-hidden />}
                        <span className="text-[11px] font-bold w-5 text-center shrink-0" style={{ color: 'var(--color-text-muted)' }}>{i + 1}</span>
                        <StepBadge type={s.type} size={30} />
                        <input value={s.label} onChange={e => setDraft(d => d.map(x => (x.id === s.id ? { ...x, label: e.target.value, custom: true } : x)))} maxLength={FUNNEL_LIMITS.label} disabled={lock}
                          className="flex-1 min-w-0 bg-transparent outline-none text-sm font-semibold disabled:opacity-70" style={{ color: 'var(--color-text)' }} aria-label="Nom de l’étape" />
                        <button type="button" onClick={() => move(i, i - 1)} disabled={lock || i === 0 || locked(draft[i - 1])} aria-label="Monter" className="p-1 rounded-lg disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" onClick={() => move(i, i + 1)} disabled={lock || i === draft.length - 1} aria-label="Descendre" className="p-1 rounded-lg disabled:opacity-30" style={{ color: 'var(--color-text-muted)' }}><ChevronDown className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setDraft(d => renumber(d.filter(x => x.id !== s.id)))} disabled={lock || draft.length <= 1} aria-label="Supprimer l’étape" className="p-1 rounded-lg disabled:opacity-30" style={{ color: '#dc2626' }}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Aperçu du parcours */}
              <div className="rounded-2xl p-3.5" style={{ background: 'rgba(232,163,61,0.07)', border: '1px solid rgba(232,163,61,0.25)' }}>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: '#8a6a1f' }}>Aperçu</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {draft.map((s, i) => (
                    <span key={s.id} className="inline-flex items-center gap-1.5">
                      <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${STEP_TYPES[s.type].color}1c`, color: STEP_TYPES[s.type].color, border: `1px solid ${STEP_TYPES[s.type].color}40` }}>{s.label}</span>
                      {i < draft.length - 1 && <ArrowRight className="h-3 w-3" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button type="button" onClick={() => setDraft(d => { const kept = d.filter(s => s.status === 'validated'); return renumber([...kept, ...defaultFunnel().filter(s => !kept.some(k => k.type === s.type))]) })} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}><RotateCcw className="h-3.5 w-3.5" />Funnel par défaut</button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMode('track')} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
                  <button type="button" onClick={saveFunnel} disabled={pending || draft.length === 0} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: '#E8A33D', color: '#1c1c1e' }}>
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}Valider le funnel
                  </button>
                </div>
              </div>
              <p className="text-[11px] -mt-2" style={{ color: 'var(--color-text-muted)' }}>Les étapes déjà validées sont verrouillées. Le pipeline crée automatiquement les colonnes qui lui manquent.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(body, document.body)
}
