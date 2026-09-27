'use client'

import { useRef, useState } from 'react'
import { FileText, ImageIcon, Loader2, Paperclip, X, FileArchive, FileSpreadsheet } from 'lucide-react'
import {
  ATTACHMENT_ACCEPT, SUPPORT_LIMITS, formatSize, isImageAttachment,
  type Attachment,
} from '@/lib/support-shared'
import { uploadSupportFileAction } from '@/lib/support-actions'

/** État des pièces jointes en cours de rédaction : envoi immédiat de chaque fichier, puis ids transmis au message. */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function add(files: File[]) {
    setError(null)
    const room = SUPPORT_LIMITS.maxAttachments - items.length
    if (files.length > room) setError(`${SUPPORT_LIMITS.maxAttachments} pièces jointes maximum par message.`)
    for (const file of files.slice(0, Math.max(room, 0))) {
      if (file.size > SUPPORT_LIMITS.maxFileBytes) { setError(`« ${file.name} » dépasse ${formatSize(SUPPORT_LIMITS.maxFileBytes)}.`); continue }
      setUploading(n => n + 1)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await uploadSupportFileAction(fd)
        if (res.error || !res.attachment) setError(res.error ?? 'Échec de l’envoi du fichier.')
        else setItems(prev => [...prev, res.attachment!])
      } catch {
        setError('Échec de l’envoi du fichier.')
      } finally {
        setUploading(n => n - 1)
      }
    }
  }

  return {
    items, uploading, error, add,
    remove: (id: string) => setItems(prev => prev.filter(a => a.id !== id)),
    clear: () => { setItems([]); setError(null) },
    ids: items.map(a => a.id),
  }
}

function FileIcon({ a }: { a: Attachment }) {
  if (isImageAttachment(a)) return <ImageIcon className="h-4 w-4" />
  if (/\.(xlsx?|csv)$/i.test(a.name)) return <FileSpreadsheet className="h-4 w-4" />
  if (/\.zip$/i.test(a.name)) return <FileArchive className="h-4 w-4" />
  return <FileText className="h-4 w-4" />
}

/** Bouton « Joindre » + pastilles des fichiers ajoutés. `dark` = thème admin. */
export function AttachmentPicker({ state, dark = false }: { state: ReturnType<typeof useAttachments>; dark?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const muted = dark ? 'rgba(255,255,255,0.5)' : 'var(--color-text-muted)'
  const chip = dark ? { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' } : { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
  const full = state.items.length >= SUPPORT_LIMITS.maxAttachments

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => input.current?.click()} disabled={full || state.uploading > 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(11,29,81,0.06)', color: dark ? 'rgba(255,255,255,0.8)' : 'var(--color-text)' }}>
          {state.uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
          {state.uploading > 0 ? 'Envoi…' : 'Joindre un fichier'}
        </button>
        <span className="text-[11px]" style={{ color: muted }}>Images, PDF, Word, Excel, ZIP… · {formatSize(SUPPORT_LIMITS.maxFileBytes)} max · {SUPPORT_LIMITS.maxAttachments} fichiers</span>
        <input ref={input} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden"
          onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void state.add(f) }} />
      </div>
      {state.items.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2.5">
          {state.items.map(a => (
            <span key={a.id} className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg text-xs max-w-full" style={chip}>
              <span style={{ color: '#e8a33d' }}><FileIcon a={a} /></span>
              <span className="truncate max-w-[180px]">{a.name}</span>
              <span style={{ color: muted }}>{formatSize(a.size)}</span>
              <button type="button" onClick={() => state.remove(a.id)} aria-label={`Retirer ${a.name}`} className="w-5 h-5 rounded flex items-center justify-center hover:bg-black/10"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {state.error && <p className="text-xs mt-2 font-medium" style={{ color: '#ef4444' }}>{state.error}</p>}
    </div>
  )
}

/** Pièces jointes d'un message : miniatures pour les images, pastilles téléchargeables pour le reste. */
export function AttachmentList({ attachments, ticketId, dark = false }: { attachments: Attachment[]; ticketId: string; dark?: boolean }) {
  if (attachments.length === 0) return null
  const href = (a: Attachment) => `/api/support/files/${a.id}?t=${ticketId}`
  const images = attachments.filter(isImageAttachment)
  const others = attachments.filter(a => !isImageAttachment(a))
  return (
    <div className="mt-2.5 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(a => (
            <a key={a.id} href={href(a)} target="_blank" rel="noopener noreferrer" title={`${a.name} (${formatSize(a.size)})`}
              className="block rounded-xl overflow-hidden" style={{ border: dark ? '1px solid rgba(255,255,255,0.15)' : '1px solid var(--color-border)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={href(a)} alt={a.name} loading="lazy" className="block object-cover" style={{ width: 132, height: 100 }} />
            </a>
          ))}
        </div>
      )}
      {others.map(a => (
        <a key={a.id} href={href(a)} target="_blank" rel="noopener noreferrer" download
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs no-underline transition-opacity hover:opacity-80"
          style={dark ? { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' } : { background: 'var(--color-background)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <span style={{ color: '#e8a33d' }}><FileIcon a={a} /></span>
          <span className="truncate font-semibold">{a.name}</span>
          <span className="shrink-0" style={{ color: dark ? 'rgba(255,255,255,0.45)' : 'var(--color-text-muted)' }}>{formatSize(a.size)}</span>
        </a>
      ))}
    </div>
  )
}
