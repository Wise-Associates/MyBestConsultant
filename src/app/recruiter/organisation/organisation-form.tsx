'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUp, Loader2, Trash2 } from 'lucide-react'
import { uploadBrandImageAction } from '@/app/recruiter/marque-employeur/actions'
import { saveOrganisationAction } from './actions'

// Nom et logo de l'organisation, pour le propriétaire et les administrateurs (le serveur revérifie). Le logo est
// envoyé tout de suite dans le bucket des logos, puis enregistré avec le nom par « Enregistrer ».

const surface = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const

export function OrganisationForm({ initialName, initialLogoUrl }: { initialName: string; initialLogoUrl: string }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, startSave] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)
  const changed = name.trim() !== initialName || logoUrl !== initialLogoUrl

  async function upload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setNotice(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await uploadBrandImageAction(form)
      if (res.url) setLogoUrl(res.url)
      else setNotice({ ok: false, text: res.error ?? 'Envoi de l’image impossible.' })
    } catch {
      setNotice({ ok: false, text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    startSave(async () => {
      try {
        const res = await saveOrganisationAction({ name, logoUrl })
        if (res.error) { setNotice({ ok: false, text: res.error }); return }
        setNotice({ ok: true, text: 'Organisation enregistrée.' })
        router.refresh()
      } catch {
        setNotice({ ok: false, text: 'Le serveur ne répond pas : vérifiez votre connexion puis réessayez.' })
      }
    })
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label htmlFor="org-name" className="block text-[13px] font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Nom de l’organisation</label>
        <input id="org-name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120}
          className="w-full h-10 px-3 rounded-lg text-sm outline-none focus:border-[var(--color-brand-orange)]" style={{ ...surface, color: 'var(--color-text)' }} />
      </div>
      <div>
        <p className="text-[13px] font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Logo</p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden shrink-0" style={surface}>
            {logoUrl
              // Image du bucket des logos (adresse vérifiée par le serveur) : <img> simple, sans l'optimiseur de Next.
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logoUrl} alt="Logo actuel" className="w-full h-full object-contain" />
              : <span className="text-lg font-bold" style={{ color: 'var(--color-text-muted)' }}>{name.trim().charAt(0).toUpperCase() || '?'}</span>}
          </span>
          <input ref={fileInput} id="org-logo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => upload(e.target.files?.[0])} />
          <label htmlFor="org-logo" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold cursor-pointer" style={{ ...surface, color: 'var(--color-text)' }}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImageUp className="h-4 w-4" aria-hidden />} {logoUrl ? 'Changer le logo' : 'Ajouter un logo'}
          </label>
          {logoUrl && (
            <button type="button" onClick={() => setLogoUrl('')} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold" style={{ color: '#b91c1c' }}>
              <Trash2 className="h-4 w-4" aria-hidden /> Retirer
            </button>
          )}
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>JPG, PNG ou WebP, 2 Mo au plus</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" disabled={!changed || saving || uploading}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-bold disabled:opacity-40" style={{ background: 'var(--color-brand-orange)', color: 'white' }}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Enregistrer
        </button>
        {notice && <p role={notice.ok ? 'status' : 'alert'} className="text-sm" style={{ color: notice.ok ? '#047857' : '#b91c1c' }}>{notice.text}</p>}
      </div>
    </form>
  )
}
