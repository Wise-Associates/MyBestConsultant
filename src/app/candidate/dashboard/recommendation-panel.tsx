'use client'

import { useState, useTransition } from 'react'
import { Star, MessageSquarePlus, Loader2, X, Clock, Sparkles, Check, Building2, CalendarRange, Briefcase } from 'lucide-react'
import { requestRecommendation, generateRecommendationMessage } from './recommendations-actions'
import { RELATIONSHIPS, RELATIONSHIP_LABEL } from '@/lib/recommendation-boost'
import type { Recommendation } from '@/types'

const MAX_EXPERTISES = 8

export function RecommendationPanel({ initialRecommendations, skills = [] }: { initialRecommendations: Recommendation[]; skills?: string[] }) {
  const [recommendations, setRecommendations] = useState(initialRecommendations)
  const [open, setOpen] = useState(false)
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [relationship, setRelationship] = useState('')
  const [recipientRole, setRecipientRole] = useState('')
  const [experience, setExperience] = useState('')
  const [period, setPeriod] = useState('')
  const [expertises, setExpertises] = useState<string[]>([])
  const [customExpertise, setCustomExpertise] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [aiError, setAiError] = useState('')
  const [isGenerating, startGenerating] = useTransition()

  const suggestions = [...new Set(skills.map(s => s.trim()).filter(Boolean))].slice(0, 16)
  const options = [...new Set([...suggestions, ...expertises])]
  const toggleExpertise = (e: string) => setExpertises(l => (l.includes(e) ? l.filter(x => x !== e) : l.length >= MAX_EXPERTISES ? l : [...l, e]))
  function addCustom() {
    const e = customExpertise.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (e && !expertises.some(x => x.toLowerCase() === e.toLowerCase()) && expertises.length < MAX_EXPERTISES) setExpertises(l => [...l, e])
    setCustomExpertise('')
  }

  function generateMessage() {
    setAiError('')
    if (!recipientName.trim()) { setAiError('Indiquez le nom du destinataire d\'abord'); return }
    startGenerating(async () => {
      const result = await generateRecommendationMessage({ recipientName, recipientCompany, experience, period })
      if (result.error) setAiError(result.error)
      else if (result.message) setMessage(result.message)
    })
  }

  function submit() {
    setError('')
    startTransition(async () => {
      const result = await requestRecommendation({ recipientName, recipientEmail, recipientCompany, recipientRole, relationship, experience, period, expertises, message })
      if (result.error) {
        setError(result.error)
      } else {
        setSent(true)
        setRecommendations(r => [
          {
            $id: `pending-${Date.now()}`,
            candidateId: '', candidateName: '',
            recipientName, recipientEmail: '', recipientCompany, recipientRole, relationship, experience, period,
            requestedExpertises: expertises, endorsedExpertises: [],
            status: 'pending', $createdAt: new Date().toISOString(),
          },
          ...r,
        ])
      }
    })
  }

  function close() {
    setOpen(false)
    setSent(false)
    setRecipientName(''); setRecipientEmail(''); setRecipientCompany(''); setRelationship(''); setRecipientRole('')
    setExperience(''); setPeriod(''); setExpertises([]); setCustomExpertise(''); setMessage(''); setError(''); setAiError('')
  }

  const inp = 'w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors'
  const inpStyle = { background: 'rgba(0,0,0,0.03)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
  const label = 'block text-xs font-semibold mb-1.5 uppercase tracking-widest'
  const labelStyle = { color: 'var(--color-text-muted)' }

  return (
    <div className="p-5 rounded-2xl space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(11,29,81,0.06)' }}>
      <div className="flex items-center gap-2">
        <MessageSquarePlus className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Recommandations</p>
      </div>

      {recommendations.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Demandez une recommandation à un ancien employeur ou client — elle sera visible par les recruteurs sur votre profil, et renforce votre score sur les expertises recommandées.
        </p>
      ) : (
        <div className="space-y-2">
          {recommendations.map(r => (
            <div key={r.$id} className="p-3 rounded-xl text-xs" style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{r.recipientName}</span>
                {r.status === 'submitted' ? (
                  <span className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map(n => (
                      <Star key={n} style={{ width: 12, height: 12 }} color="#E8A33D" fill={(r.rating ?? 0) >= n ? '#E8A33D' : 'none'} />
                    ))}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
                    <Clock style={{ width: 10, height: 10 }} /> En attente
                  </span>
                )}
              </div>
              {(r.recipientCompany || r.recipientRole || r.relationship) && (
                <p className="mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {[r.recipientRole, r.recipientCompany, r.relationship ? RELATIONSHIP_LABEL[r.relationship] : ''].filter(Boolean).join(' · ')}
                </p>
              )}
              {(r.experience || r.period) && <p className="mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{[r.experience, r.period].filter(Boolean).join(' — ')}</p>}
              {((r.status === 'submitted' ? r.endorsedExpertises : r.requestedExpertises) ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {((r.status === 'submitted' ? r.endorsedExpertises : r.requestedExpertises) ?? []).map(e => (
                    <span key={e} className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: r.status === 'submitted' ? 'rgba(232,163,61,0.14)' : 'rgba(0,0,0,0.05)', color: r.status === 'submitted' ? '#8a6a1f' : 'var(--color-text-muted)' }}>{e}</span>
                  ))}
                </div>
              )}
              {r.comment && (
                <p className="mt-1.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>&laquo; {r.comment} &raquo;</p>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ background: 'var(--color-primary)', color: 'white' }}>
        <MessageSquarePlus className="h-3.5 w-3.5" /> Demander une recommandation
      </button>

      {/* Pas de fermeture au clic sur le fond : un clic en dehors du champ de saisie ne doit jamais faire perdre
          la demande en cours de rédaction — seuls les boutons Fermer / Annuler ferment la fenêtre. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-xl rounded-2xl overflow-hidden flex flex-col max-h-[92vh]" style={{ background: 'var(--color-background)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--hero-bg)' }}>
              <h2 className="font-semibold text-white text-sm">Demander une recommandation</h2>
              <button onClick={close} className="text-white/40 hover:text-white transition-colors" aria-label="Fermer">
                <X className="h-5 w-5" />
              </button>
            </div>

            {sent ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-2xl">✅</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Demande envoyée !</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {recipientName} va recevoir un email avec le récapitulatif de votre collaboration et un lien pour laisser sa recommandation.
                </p>
                <button onClick={close}
                  className="mt-2 px-5 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-primary)', color: 'white' }}>
                  Fermer
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-5 overflow-y-auto">
                {/* Le recommandant */}
                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}><Building2 className="h-3.5 w-3.5" />Le client / responsable</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className={label} style={labelStyle}>Nom et prénom *</label>
                      <input value={recipientName} onChange={e => setRecipientName(e.target.value)} className={inp} style={inpStyle} placeholder="Jean Dupont" />
                    </div>
                    <div>
                      <label className={label} style={labelStyle}>Email *</label>
                      <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} className={inp} style={inpStyle} placeholder="jean.dupont@entreprise.com" />
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>Utilisé pour l’envoi uniquement, jamais affiché sur votre profil.</p>
                    </div>
                    <div>
                      <label className={label} style={labelStyle}>Entreprise *</label>
                      <input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)} className={inp} style={inpStyle} placeholder="Nom de l'entreprise" />
                    </div>
                    <div>
                      <label className={label} style={labelStyle}>Lien avec vous *</label>
                      <select value={relationship} onChange={e => setRelationship(e.target.value)} className={inp} style={inpStyle}>
                        <option value="">Choisir…</option>
                        {RELATIONSHIPS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={label} style={labelStyle}>Fonction (facultatif)</label>
                      <input value={recipientRole} onChange={e => setRecipientRole(e.target.value)} className={inp} style={inpStyle} placeholder="Directrice des systèmes d’information" />
                    </div>
                  </div>
                </div>

                {/* La collaboration */}
                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}><Briefcase className="h-3.5 w-3.5" />La collaboration</p>
                  <div>
                    <label className={label} style={labelStyle}>Expérience concernée *</label>
                    <input value={experience} onChange={e => setExperience(e.target.value)} maxLength={500} className={inp} style={inpStyle} placeholder="Mission de migration SAP S/4HANA chez Société X" />
                  </div>
                  <div>
                    <label className={`${label} flex items-center gap-1.5`} style={labelStyle}><CalendarRange className="h-3 w-3" />Période de collaboration *</label>
                    <input value={period} onChange={e => setPeriod(e.target.value)} maxLength={100} className={inp} style={inpStyle} placeholder="Mars 2022 – juin 2023" />
                  </div>
                  <div>
                    <label className={label} style={labelStyle}>Expertise(s) concernée(s) * <span className="normal-case tracking-normal font-medium">({expertises.length}/{MAX_EXPERTISES})</span></label>
                    <div className="flex flex-wrap gap-1.5">
                      {options.map(e => {
                        const on = expertises.includes(e)
                        return (
                          <button key={e} type="button" onClick={() => toggleExpertise(e)} aria-pressed={on} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
                            style={on ? { background: 'rgba(232,163,61,0.2)', color: '#8a6a1f', border: '1px solid rgba(232,163,61,0.6)' } : { background: 'transparent', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)' }}>
                            {on && <Check className="h-3 w-3" />}{e}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input value={customExpertise} onChange={e => setCustomExpertise(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} maxLength={60} className={inp} style={inpStyle} placeholder="Autre expertise (ex. Gestion de projet agile)" />
                      <button type="button" onClick={addCustom} disabled={!customExpertise.trim()} className="px-3 rounded-lg text-xs font-bold disabled:opacity-40 shrink-0" style={{ background: 'rgba(232,163,61,0.14)', color: '#b8862f' }}>Ajouter</button>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold uppercase tracking-widest" style={labelStyle}>Message personnalisé</label>
                    <button type="button" onClick={generateMessage} disabled={isGenerating}
                      className="flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-75 disabled:opacity-50"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }}>
                      {isGenerating
                        ? <><Loader2 className="h-3 w-3 animate-spin" /> Génération…</>
                        : <><Sparkles className="h-3 w-3" /> Générer avec l&apos;IA</>}
                    </button>
                  </div>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} className={inp} style={{ ...inpStyle, resize: 'vertical' }} placeholder="Un petit mot pour donner du contexte (facultatif)" />
                  {aiError && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{aiError}</p>}
                </div>

                {error && (
                  <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>{error}</p>
                )}

                <div className="flex gap-3 pt-1">
                  <button onClick={close}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                    Annuler
                  </button>
                  <button onClick={submit} disabled={isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-primary)', color: 'white' }}>
                    {isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Envoi…</> : 'Envoyer la demande'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
