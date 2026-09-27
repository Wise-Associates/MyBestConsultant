'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { updateHunterContactAction } from '../actions'
import { WhatsAppIcon } from '@/components/recruiter/whatsapp-contact'

export function ContactCard({ initialWhatsapp, initialPhone }: { initialWhatsapp: string; initialPhone: string }) {
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp)
  const [phone, setPhone] = useState(initialPhone)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const cls = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none'
  const style = { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }

  function save() {
    setMsg(null)
    startTransition(async () => {
      const res = await updateHunterContactAction({ whatsapp, phone })
      if (res.error) setMsg({ ok: false, text: res.error })
      else { setWhatsapp(res.whatsapp ?? ''); setMsg({ ok: true, text: 'Coordonnées enregistrées' }); setTimeout(() => setMsg(null), 2500) }
    })
  }

  return (
    <section className="rounded-3xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 16px 40px -22px rgba(11,29,81,0.18)' }}>
      <h2 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)', fontSize: '1rem' }}>
        <span style={{ color: '#25D366' }}><WhatsAppIcon className="h-4 w-4" /></span>Mes coordonnées
      </h2>
      <p className="text-xs mt-1 mb-4" style={{ color: 'var(--color-text-muted)' }}>Les recruteurs vous contactent directement sur WhatsApp à propos des profils que vous proposez.</p>
      <div className="space-y-3">
        <label className="block"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Numéro WhatsApp</span>
          <input className={cls} style={style} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="+33 6 12 34 56 78" inputMode="tel" /></label>
        <label className="block"><span className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text)' }}>Téléphone (facultatif)</span>
          <input className={cls} style={style} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33 1 23 45 67 89" inputMode="tel" /></label>
      </div>
      <div className="flex items-center justify-between gap-3 mt-4">
        <p className="text-xs font-medium" style={{ color: msg?.ok ? '#059669' : '#dc2626' }}>{msg?.text}</p>
        <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'white' }}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Enregistrer
        </button>
      </div>
    </section>
  )
}
