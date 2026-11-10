'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, Pencil } from 'lucide-react'
import { updateHunterContactAction } from '../actions'
import { WhatsAppIcon } from '@/components/recruiter/whatsapp-contact'

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2'

/**
 * Coordonnées du chasseur. Affichées en texte avec « Modifier » (revue du 2026-11-10 : un formulaire toujours ouvert
 * prenait la colonne) ; le formulaire s'ouvre d'emblée tant qu'aucun numéro WhatsApp n'est enregistré, les recruteurs ne
 * pouvant alors pas joindre le chasseur.
 */
export function ContactCard({ initialWhatsapp, initialPhone }: { initialWhatsapp: string; initialPhone: string }) {
  const [saved, setSaved] = useState({ whatsapp: initialWhatsapp, phone: initialPhone })
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp)
  const [phone, setPhone] = useState(initialPhone)
  const [editing, setEditing] = useState(!initialWhatsapp)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const changed = whatsapp.trim() !== saved.whatsapp || phone.trim() !== saved.phone
  const cls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]'
  const style = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  function save() {
    setMsg(null)
    startTransition(async () => {
      const res = await updateHunterContactAction({ whatsapp, phone })
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      // Tels qu'enregistrés : WhatsApp normalisé par le serveur, téléphone coupé à 30 caractères (updateHunterContactAction).
      const next = { whatsapp: res.whatsapp ?? '', phone: phone.trim().slice(0, 30) }
      setSaved(next)
      setWhatsapp(next.whatsapp)
      setPhone(next.phone)
      setEditing(!next.whatsapp)
      setMsg({ ok: true, text: 'Coordonnées enregistrées' })
      setTimeout(() => setMsg(null), 2500)
    })
  }

  function cancel() {
    setWhatsapp(saved.whatsapp)
    setPhone(saved.phone)
    setMsg(null)
    setEditing(false)
  }

  return (
    <section className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} aria-labelledby="hunter-contact-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="hunter-contact-title" className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>
          <span style={{ color: '#25D366' }}><WhatsAppIcon className="h-4 w-4" /></span>Mes coordonnées
        </h2>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
            className={`inline-flex items-center gap-1 text-xs font-semibold cursor-pointer rounded ${focusRing}`} style={{ color: 'var(--color-primary)' }}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />Modifier
          </button>
        )}
      </div>

      {!editing ? (
        <>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt style={{ color: 'var(--color-text-muted)' }}>WhatsApp</dt><dd className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{saved.whatsapp}</dd></div>
            {saved.phone && saved.phone !== saved.whatsapp && (
              <div className="flex justify-between gap-3"><dt style={{ color: 'var(--color-text-muted)' }}>Téléphone</dt><dd className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{saved.phone}</dd></div>
            )}
          </dl>
          <p className="text-xs mt-3" style={{ color: msg?.ok ? '#047857' : 'var(--color-text-muted)' }} aria-live="polite">
            {msg?.ok ? msg.text : 'Les recruteurs vous contactent sur WhatsApp à propos des profils que vous proposez.'}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>Les recruteurs vous contactent directement sur WhatsApp à propos des profils que vous proposez.</p>
          <div className="space-y-3">
            <label className="block"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Numéro WhatsApp</span>
              <input className={cls} style={style} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+33 6 12 34 56 78" inputMode="tel" autoComplete="tel" /></label>
            <label className="block"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Téléphone (facultatif, s’il diffère)</span>
              <input className={cls} style={style} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33 1 23 45 67 89" inputMode="tel" autoComplete="tel" /></label>
          </div>
          <p className="text-xs font-medium mt-3 min-h-4" style={{ color: msg?.ok ? '#047857' : '#b91c1c' }} aria-live="polite">{msg?.text}</p>
          <div className="flex items-center justify-end gap-2 mt-2">
            {saved.whatsapp && (
              <button type="button" onClick={cancel} disabled={pending}
                className={`px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer disabled:opacity-50 ${focusRing}`} style={{ color: 'var(--color-text-muted)' }}>
                Annuler
              </button>
            )}
            <button type="button" onClick={save} disabled={pending || !changed}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}Enregistrer
            </button>
          </div>
        </>
      )}
    </section>
  )
}
