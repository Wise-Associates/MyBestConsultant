'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Link as LinkIcon, X, Loader2, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props {
  value: string
  onChange: (url: string) => void
  label?: string
  className?: string
}

// Compress + resize image via canvas before upload (keeps files under Appwrite bucket limit)
async function compressImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx }
        else { width = Math.round(width * maxPx / height); height = maxPx }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return }
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

export function ImageUpload({ value, onChange, label = 'Image', className = '' }: Props) {
  const [mode, setMode] = useState<'url' | 'upload'>('url')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const inp = "bg-white/[0.06] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg text-sm h-9"

  async function uploadFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Fichier image requis (jpg, png, webp, gif, svg)'); return }
    setUploading(true); setError('')
    try {
      const compressed = await compressImage(file)
      const fd = new FormData()
      fd.append('file', compressed)
      fd.append('bucket', 'logos')
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload échoué')
      onChange(data.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur upload')
    } finally {
      setUploading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-white/35 uppercase tracking-widest">{label}</span>
        <div className="flex gap-0.5 p-0.5 bg-white/[0.04] rounded-md border border-white/[0.07]">
          <button onClick={() => setMode('url')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${mode === 'url' ? 'bg-white/[0.1] text-white/80' : 'text-white/30 hover:text-white/60'}`}>
            <LinkIcon className="h-3 w-3" />
          </button>
          <button onClick={() => setMode('upload')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${mode === 'upload' ? 'bg-white/[0.1] text-white/80' : 'text-white/30 hover:text-white/60'}`}>
            <Upload className="h-3 w-3" />
          </button>
        </div>
      </div>

      {mode === 'url' ? (
        <div className="flex gap-1.5">
          <Input value={value} onChange={e => onChange(e.target.value)}
            className={inp + ' flex-1'} placeholder="https://..." />
          {value && (
            <button onClick={() => onChange('')}
              className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/30 hover:text-white/60 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !uploading && inputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
            dragOver ? 'border-white/40 bg-white/[0.06]' : 'border-white/[0.12] hover:border-white/25 bg-white/[0.02]'
          }`}
        >
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
          {uploading
            ? <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
            : value
              ? <Check className="h-5 w-5 text-emerald-400" />
              : <Upload className="h-5 w-5 text-white/30" />
          }
          <span className="text-xs text-white/40 text-center">
            {uploading ? 'Compression + upload…' : value ? 'Cliquer pour changer' : 'Glisser ou cliquer pour uploader'}
          </span>
          <span className="text-[10px] text-white/20">Auto-compressé avant envoi</span>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {value && (
        <div className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.03]" style={{ height: 80 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="w-full h-full object-cover"
            onError={e => { (e.currentTarget.parentElement!).style.display = 'none' }} />
          <button onClick={() => onChange('')}
            className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white/70 hover:text-white transition-colors">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
