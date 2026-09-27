'use client'

import { useRef, useTransition, useState } from 'react'
import { Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { saveCvFileId } from './actions'

export function CvUploadButton({ currentFileId }: { currentFileId?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)

  const isLoading = uploading || isPending

  async function handleFile(file: File) {
    setUploading(true)
    setDone(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? "Erreur lors de l'upload.")
        return
      }
      const { fileId } = await res.json()
      startTransition(async () => {
        await saveCvFileId(fileId)
        setDone(true)
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
        style={{
          background: done ? 'rgba(16,185,129,0.15)' : 'var(--color-primary)',
          color: done ? '#10b981' : 'white',
          opacity: isLoading ? 0.8 : 1,
        }}
      >
        {uploading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Upload en cours…</>
        ) : isPending ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement…</>
        ) : done ? (
          <><CheckCircle2 className="h-4 w-4" /> CV enregistré !</>
        ) : (
          <><Upload className="h-4 w-4" /> {currentFileId ? 'Changer le CV' : 'Uploader le CV'}</>
        )}
      </button>
    </>
  )
}
