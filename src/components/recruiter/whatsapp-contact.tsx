'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { WHATSAPP_TEMPLATES, fillTemplate, formatWhatsApp, waLink } from '@/lib/whatsapp'
import { logWhatsAppContactAction } from '@/app/recruiter/pipeline/[jobId]/actions'
import { useRecruiterIdentity } from './identity-context'

/** Logo WhatsApp (Simple Icons, domaine public). */
export function WhatsAppIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

/**
 * Bouton « WhatsApp » + fenêtre de rédaction : le recruteur choisit un modèle, adapte le message, puis WhatsApp
 * s'ouvre sur la conversation avec le candidat (message pré-rempli). `hunter` : le numéro est celui du chasseur
 * qui propose ce profil — le contact passe par lui.
 */
export function WhatsAppContact({ name, number, jobTitle, company, recruiter, applicationId, hunter = false, unconfirmed = false, size = 'md' }: {
  name: string; number: string; jobTitle?: string; company?: string; recruiter?: string
  applicationId?: string; hunter?: boolean
  /** Numéro de téléphone du candidat, pas encore confirmé comme WhatsApp par lui. */
  unconfirmed?: boolean
  size?: 'chip' | 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [templateId, setTemplateId] = useState(applicationId ? 'interview' : 'first')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const me = useRecruiterIdentity()

  useEffect(() => setMounted(true), [])
  const firstName = name.split(' ')[0] ?? ''
  const vars = { prenom: firstName, poste: jobTitle, entreprise: company || me.company, recruteur: recruiter || me.name }

  function pick(id: string) {
    setTemplateId(id)
    setText(fillTemplate(WHATSAPP_TEMPLATES.find(t => t.id === id)?.text ?? '', vars))
  }
  function openModal() { pick(templateId); setOpen(true) }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function launch() {
    window.open(waLink(number, text.trim()), '_blank', 'noopener,noreferrer')
    if (applicationId) void logWhatsAppContactAction(applicationId).catch(() => { /* l'historique n'est jamais bloquant */ })
    setOpen(false)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* presse-papiers indisponible */ }
  }

  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); openModal() }} title={`Contacter ${name} sur WhatsApp`}
        className="mbc-wa-btn inline-flex items-center gap-1.5 font-bold rounded-full transition-all hover:-translate-y-px"
        style={{ padding: size === 'chip' ? '4px 9px' : size === 'sm' ? '4px 10px' : '8px 16px', fontSize: size === 'md' ? 13 : 11, color: 'white', background: 'linear-gradient(135deg,#25D366,#128C7E)', boxShadow: size === 'chip' ? '0 2px 8px rgba(37,211,102,0.3)' : '0 3px 12px rgba(37,211,102,0.35)' }}>
        <WhatsAppIcon className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />{hunter ? (size === 'chip' ? 'Chasseur' : 'Contacter le chasseur') : 'WhatsApp'}
      </button>

      {mounted && open && createPortal(
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 10000, background: 'rgba(8,12,24,0.6)', backdropFilter: 'blur(3px)' }} onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ background: 'var(--color-surface, #fff)', boxShadow: '0 30px 80px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-center gap-3.5" style={{ background: 'linear-gradient(135deg,#128C7E,#075E54)' }}>
              <span className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.16)', color: 'white' }}><WhatsAppIcon className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-white truncate" style={{ fontSize: '1.02rem' }}>{hunter ? `Contacter le chasseur — ${name}` : `Contacter ${name}`}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{formatWhatsApp(number)}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15" style={{ color: 'white' }}><X className="h-4 w-4" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text, #111)' }}>Modèle de message</p>
                <div className="flex flex-wrap gap-2">
                  {WHATSAPP_TEMPLATES.map(t => (
                    <button key={t.id} type="button" onClick={() => pick(t.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                      style={templateId === t.id ? { background: '#128C7E', color: 'white', border: '1px solid #128C7E' } : { background: 'transparent', color: 'var(--color-text-muted, #666)', border: '1px solid var(--color-border, #ddd)' }}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text, #111)' }}>Votre message <span className="font-normal" style={{ color: 'var(--color-text-muted, #666)' }}>(modifiable)</span></p>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={6} className="w-full px-3.5 py-3 rounded-xl text-sm outline-none resize-y"
                  style={{ background: 'var(--color-background, #f7f7f7)', border: '1px solid var(--color-border, #ddd)', color: 'var(--color-text, #111)' }} />
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-muted, #666)' }}>
                WhatsApp s&apos;ouvrira avec ce message pré-rempli dans <strong>votre</strong> conversation avec {hunter ? 'le chasseur' : firstName || 'le candidat'} : il n&apos;est envoyé que lorsque vous appuyez sur « Envoyer » dans WhatsApp.
                {!hunter && !unconfirmed && ' Ce candidat a choisi d’être contacté sur WhatsApp par les recruteurs.'}
                {unconfirmed && ' Numéro de téléphone du candidat : il n’a pas confirmé utiliser WhatsApp — si le message ne passe pas, essayez de l’appeler.'}
              </p>
              <div className="flex items-center justify-end gap-2.5 flex-wrap">
                <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ border: '1px solid var(--color-border, #ddd)', color: 'var(--color-text, #111)' }}>
                  {copied ? <Check className="h-4 w-4" style={{ color: '#128C7E' }} /> : <Copy className="h-4 w-4" />}{copied ? 'Copié' : 'Copier le message'}
                </button>
                <button type="button" onClick={launch} disabled={!text.trim()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)', boxShadow: '0 6px 18px rgba(37,211,102,0.35)' }}>
                  <WhatsAppIcon className="h-4 w-4" />Ouvrir WhatsApp<ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
