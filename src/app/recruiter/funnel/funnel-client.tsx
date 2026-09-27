'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  AlertCircle, ArrowLeft, ArrowRight, GitBranch, Loader2, Pencil, Plus, Trash2, Users, X,
} from 'lucide-react'
import { STAGE_LIMITS, STAGE_TEMPLATES } from '@/lib/funnel-config'
import { PhasesEditor, toPhaseDraft, type PhaseDraft } from '@/components/recruiter/phases-editor'
import type { FunnelData } from './data'
import {
  assignJobsAction, createPipelineAction, deletePipelineAction, renamePipelineAction, savePipelineStagesAction, saveStatusesAction,
} from './actions'

export type FunnelTab = 'pipelines' | 'phases' | 'statuts'

const DEFAULT_ID = 'default'
const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }
const input = { background: 'var(--color-background, #fff)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
const btnDark = { background: '#1c1c1e', color: 'white' }
const btnSoft = { background: 'rgba(232,163,61,0.14)', color: '#b8862f' }

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(15,15,20,0.55)' }} onClick={onClose}>
      <div className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 sm:p-6`} style={{ background: 'var(--color-surface)', boxShadow: '0 30px 80px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.05rem' }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PhaseChip({ s }: { s: { label: string; color: string } }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}40` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  )
}

export function FunnelClient({ initial, initialTab, initialPipeline }: { initial: FunnelData; initialTab: FunnelTab; initialPipeline: string }) {
  const [data, setData] = useState(initial)
  const [tab, setTab] = useState<FunnelTab>(initialTab)
  const [selected, setSelected] = useState(initialPipeline)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [template, setTemplate] = useState<string>('interviews')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [assigning, setAssigning] = useState<{ id: string; ids: string[] } | null>(null)

  // Phases (brouillon local du pipeline sélectionné)
  const stagesOf = (id: string) => (id === DEFAULT_ID ? data.defaultStages : data.pipelines.find(p => p.id === id)?.stages ?? [])
  const [rows, setRows] = useState<PhaseDraft[]>(() => stagesOf(initialPipeline).map(toPhaseDraft))
  const [dirty, setDirty] = useState(false)

  // Statuts (brouillon local)
  const [statuses, setStatuses] = useState(data.statuses)
  const [statusInput, setStatusInput] = useState('')
  const statusesDirty = JSON.stringify(statuses) !== JSON.stringify(data.statuses)

  function apply(res: { data?: FunnelData; error?: string }, after?: (d: FunnelData) => void) {
    if (res.error || !res.data) { setError(res.error ?? 'Une erreur est survenue.'); return false }
    setError(null); setData(res.data); after?.(res.data)
    return true
  }

  function selectPipeline(id: string, d: FunnelData = data) {
    setSelected(id)
    const stages = id === DEFAULT_ID ? d.defaultStages : d.pipelines.find(p => p.id === id)?.stages ?? []
    setRows(stages.map(toPhaseDraft)); setDirty(false)
  }

  const pipelineName = (id: string) => (id === DEFAULT_ID ? 'Pipeline par défaut' : data.pipelines.find(p => p.id === id)?.name ?? 'Pipeline')
  const jobsOf = (id: string) => data.jobs.filter(j => (id === DEFAULT_ID ? j.pipelineId === null : j.pipelineId === id))

  // ── Actions ──
  const create = () => start(async () => {
    const before = new Set(data.pipelines.map(p => p.id))
    const res = await createPipelineAction(newName, template)
    if (apply(res, d => { const made = d.pipelines.find(p => !before.has(p.id)); if (made) { setSelected(made.id); setRows(made.stages.map(toPhaseDraft)); setDirty(false) } })) {
      setCreateOpen(false); setNewName(''); setTab('phases')
    }
  })
  const rename = () => start(async () => { if (renaming && apply(await renamePipelineAction(renaming.id, renaming.name))) setRenaming(null) })
  const remove = () => start(async () => {
    if (!deleting) return
    if (apply(await deletePipelineAction(deleting.id), d => { if (selected === deleting.id) selectPipeline(DEFAULT_ID, d) })) setDeleting(null)
  })
  const assign = () => start(async () => { if (assigning && apply(await assignJobsAction(assigning.id, assigning.ids))) setAssigning(null) })
  const savePhases = () => start(async () => {
    const res = await savePipelineStagesAction(selected === DEFAULT_ID ? null : selected, rows.map(r => ({ ...r, autoAction: r.autoAction || undefined })))
    apply(res, d => selectPipeline(selected, d))
  })
  const saveStatuses = () => start(async () => { apply(await saveStatusesAction(statuses), d => setStatuses(d.statuses)) })

  const TABS: { id: FunnelTab; label: string }[] = [{ id: 'pipelines', label: 'Flux par poste' }, { id: 'phases', label: 'Phases' }, { id: 'statuts', label: 'Statuts' }]
  const rowsWithPipeline = [{ id: DEFAULT_ID, name: 'Pipeline par défaut', stages: data.defaultStages }, ...data.pipelines.map(p => ({ id: p.id, name: p.name, stages: p.stages }))]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)' }}>
      <div style={{ background: 'var(--hero-bg)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
          <Link href="/recruiter/dashboard" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 no-underline transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.55)' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;espace recruteur
          </Link>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(232,163,61,0.15)' }}><GitBranch className="h-6 w-6" style={{ color: '#E8A33D' }} /></div>
            <div>
              <h1 style={{ color: 'white', fontWeight: 300, fontSize: '1.75rem' }}>Processus de recrutement</h1>
              <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Vos pipelines, leurs phases et les statuts des candidatures</p>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="px-4 py-2.5 text-sm font-semibold whitespace-nowrap rounded-t-xl transition-colors"
                style={tab === t.id ? { background: 'var(--page-bg)', color: 'var(--color-text)' } : { color: 'rgba(255,255,255,0.6)' }}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        {error && (
          <div className="rounded-2xl px-4 py-3 text-sm flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c' }}>
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Fermer"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* ═══ Flux par poste (multipipeline) ═══ */}
        {tab === 'pipelines' && (
          <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="max-w-xl">
                <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.15rem' }}>Flux par poste</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>Chaque offre suit un pipeline. Créez des pipelines différents selon les postes (par exemple « Directeurs ») et affectez-leur les offres concernées. Les autres offres suivent le pipeline par défaut.</p>
              </div>
              <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold" style={btnDark}><Plus className="h-4 w-4" />Ajouter un processus de recrutement</button>
            </div>

            <div className="space-y-3">
              {rowsWithPipeline.map(p => {
                const jobs = jobsOf(p.id)
                return (
                  <div key={p.id} className="rounded-3xl p-5" style={surface}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-bold" style={{ color: 'var(--color-text)' }}>{p.name}{p.id === DEFAULT_ID && <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full align-middle" style={btnSoft}>PAR DÉFAUT</span>}</p>
                        <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          <Users className="h-3.5 w-3.5" />
                          {p.id === DEFAULT_ID ? `${jobs.length} offre${jobs.length > 1 ? 's' : ''} non affectée${jobs.length > 1 ? 's' : ''} à un autre pipeline` : jobs.length ? `${jobs.length} offre${jobs.length > 1 ? 's' : ''} : ${jobs.slice(0, 3).map(j => j.title).join(', ')}${jobs.length > 3 ? ` +${jobs.length - 3}` : ''}` : 'Aucune offre affectée'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={() => { selectPipeline(p.id); setTab('phases') }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={btnSoft}><Pencil className="h-3.5 w-3.5" />Phases</button>
                        {p.id !== DEFAULT_ID && (
                          <>
                            <button type="button" onClick={() => setAssigning({ id: p.id, ids: jobsOf(p.id).map(j => j.id) })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={btnSoft}><Users className="h-3.5 w-3.5" />Offres</button>
                            <button type="button" onClick={() => setRenaming({ id: p.id, name: p.name })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Renommer</button>
                            <button type="button" onClick={() => setDeleting({ id: p.id, name: p.name })} aria-label="Supprimer le pipeline" className="p-2 rounded-lg" style={{ color: '#dc2626', border: '1px solid rgba(220,38,38,0.25)' }}><Trash2 className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-4">
                      {p.stages.map((s, i) => (
                        <span key={s.slug} className="inline-flex items-center gap-1.5">
                          <PhaseChip s={s} />{i < p.stages.length - 1 && <ArrowRight className="h-3 w-3" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ═══ Phases ═══ */}
        {tab === 'phases' && (
          <>
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.15rem' }}>Phases du pipeline</h2>
                <p className="text-sm mt-1 max-w-xl" style={{ color: 'var(--color-text-muted)' }}>Les phases sont les étapes du processus de recrutement : elles forment les colonnes du pipeline de chaque offre. Glissez-les pour changer l&apos;ordre.</p>
              </div>
              <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                Pipeline
                <select value={selected} onChange={e => selectPipeline(e.target.value)} className="block mt-1 px-3 py-2 rounded-xl text-sm font-semibold outline-none" style={input}>
                  {rowsWithPipeline.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <PhasesEditor rows={rows} onChange={r => { setRows(r); setDirty(true) }} statusLibrary={data.statuses} onError={setError} />

            {dirty && (
              <div className="sticky bottom-4 z-10 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: '#1c1c1e', color: 'white', boxShadow: '0 20px 50px rgba(0,0,0,0.35)' }}>
                <span className="text-sm">Modifications non enregistrées</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => selectPipeline(selected)} className="px-3.5 py-2 rounded-xl text-sm font-semibold" style={{ background: 'rgba(255,255,255,0.12)' }}>Annuler</button>
                  <button type="button" onClick={savePhases} disabled={pending} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: '#E8A33D', color: '#1c1c1e' }}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ Statuts ═══ */}
        {tab === 'statuts' && (
          <>
            <div>
              <h2 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '1.15rem' }}>Statuts des candidatures</h2>
              <p className="text-sm mt-1 max-w-xl" style={{ color: 'var(--color-text-muted)' }}>Un statut précise où en est un candidat à l&apos;intérieur d&apos;une phase (par exemple « Planifié » ou « À recontacter »). Cette liste est proposée quand vous créez ou modifiez une phase.</p>
            </div>
            <div className="rounded-3xl p-5" style={surface}>
              <div className="flex flex-wrap gap-2">
                {statuses.map(s => (
                  <span key={s} className="inline-flex items-center gap-1.5 text-sm font-semibold pl-3 pr-1.5 py-1.5 rounded-full" style={{ background: 'rgba(232,163,61,0.14)', color: '#8a6a1f' }}>
                    {s}<button type="button" onClick={() => setStatuses(l => l.filter(x => x !== s))} aria-label={`Retirer ${s}`} className="p-0.5 rounded-full hover:bg-black/10"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
                {statuses.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Aucun statut : ajoutez-en un ci-dessous.</p>}
              </div>
              <div className="flex gap-2 mt-4 max-w-md">
                <input value={statusInput} onChange={e => setStatusInput(e.target.value)} maxLength={STAGE_LIMITS.status} placeholder="Nouveau statut…" className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none" style={input}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const s = statusInput.replace(/\s+/g, ' ').trim(); if (s && !statuses.some(x => x.toLowerCase() === s.toLowerCase())) setStatuses(l => [...l, s]); setStatusInput('') } }} />
                <button type="button" disabled={!statusInput.trim()} onClick={() => { const s = statusInput.replace(/\s+/g, ' ').trim(); if (s && !statuses.some(x => x.toLowerCase() === s.toLowerCase())) setStatuses(l => [...l, s]); setStatusInput('') }} className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40" style={btnDark}>Ajouter</button>
              </div>
              {statusesDirty && (
                <div className="flex gap-2 mt-5">
                  <button type="button" onClick={saveStatuses} disabled={pending} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: '#E8A33D', color: '#1c1c1e' }}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</button>
                  <button type="button" onClick={() => setStatuses(data.statuses)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Créer un pipeline ── */}
      {createOpen && (
        <Modal title="Ajouter un processus de recrutement" onClose={() => setCreateOpen(false)} wide>
          <label className="text-xs font-semibold" style={{ color: 'var(--color-text-muted)' }}>Nom du pipeline *</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={STAGE_LIMITS.pipelineName} placeholder="ex. Directeurs" autoFocus className="w-full mt-1 px-3 py-2.5 rounded-xl text-sm outline-none" style={input} />
          <p className="text-xs font-semibold mt-4 mb-2" style={{ color: 'var(--color-text-muted)' }}>Point de départ</p>
          <div className="grid gap-2">
            {STAGE_TEMPLATES.map(t => (
              <button key={t.id} type="button" onClick={() => setTemplate(t.id)} className="text-left rounded-2xl p-3.5 transition-colors" style={{ border: `1.5px solid ${template === t.id ? '#E8A33D' : 'var(--color-border)'}`, background: template === t.id ? 'rgba(232,163,61,0.08)' : 'transparent' }}>
                <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{t.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t.description}</p>
                {t.stages && <div className="flex flex-wrap gap-1 mt-2">{t.stages.map(s => <PhaseChip key={s.slug} s={s} />)}</div>}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
            <button type="button" onClick={create} disabled={pending || !newName.trim()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={btnDark}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Créer le pipeline</button>
          </div>
        </Modal>
      )}

      {renaming && (
        <Modal title="Renommer le pipeline" onClose={() => setRenaming(null)}>
          <input value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} maxLength={STAGE_LIMITS.pipelineName} autoFocus className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={input} />
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setRenaming(null)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
            <button type="button" onClick={rename} disabled={pending || !renaming.name.trim()} className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={btnDark}>Enregistrer</button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title="Supprimer ce pipeline ?" onClose={() => setDeleting(null)}>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>« {deleting.name} » sera supprimé. Ses offres reviendront au pipeline par défaut ; les candidatures ne sont pas supprimées.</p>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setDeleting(null)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
            <button type="button" onClick={remove} disabled={pending} className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: '#dc2626' }}>Supprimer</button>
          </div>
        </Modal>
      )}

      {assigning && (
        <Modal title={`Offres du pipeline « ${pipelineName(assigning.id)} »`} onClose={() => setAssigning(null)}>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Cochez les offres qui suivent ce pipeline. Une offre ne suit qu&apos;un seul pipeline.</p>
          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
            {data.jobs.map(j => {
              const on = assigning.ids.includes(j.id)
              const other = j.pipelineId && j.pipelineId !== assigning.id ? pipelineName(j.pipelineId) : null
              return (
                <label key={j.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer" style={{ border: '1px solid var(--color-border)', background: on ? 'rgba(232,163,61,0.08)' : 'transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => setAssigning(a => a && ({ ...a, ids: on ? a.ids.filter(x => x !== j.id) : [...a.ids, j.id] }))} />
                  <span className="min-w-0 flex-1 text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{j.title}{!j.isActive && <span className="ml-2 text-[10px] font-bold" style={{ color: 'var(--color-text-muted)' }}>ARCHIVÉE</span>}</span>
                  {other && <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{other}</span>}
                </label>
              )
            })}
            {data.jobs.length === 0 && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Vous n&apos;avez pas encore d&apos;offre.</p>}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setAssigning(null)} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>Annuler</button>
            <button type="button" onClick={assign} disabled={pending} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={btnDark}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
