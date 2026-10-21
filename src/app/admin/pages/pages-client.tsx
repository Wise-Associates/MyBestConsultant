'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, FileText, ExternalLink, Trash2, Globe, Lock, Loader2, Check, AlertCircle, Edit2, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createPage, deletePage, togglePublished, setHomepage } from './actions'
import type { Models } from 'node-appwrite'

const inputCls = "bg-white/[0.05] border-white/[0.1] text-white/80 placeholder:text-white/25 focus:border-white/30 focus:ring-0 rounded-lg"

interface Props { initialPages: Models.Document[] }

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function PagesClient({ initialPages }: Props) {
  const [pages, setPages] = useState(initialPages)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ title: '', slug: '', metaDescription: '' })
  const [slugEdited, setSlugEdited] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function handleTitleChange(v: string) {
    setForm(f => ({ ...f, title: v, slug: slugEdited ? f.slug : slugify(v) }))
  }

  function handleSlugChange(v: string) {
    setSlugEdited(true)
    setForm(f => ({ ...f, slug: v }))
  }

  function resetForm() {
    setForm({ title: '', slug: '', metaDescription: '' })
    setSlugEdited(false)
    setShowNew(false)
  }

  function handleCreate() {
    if (!form.title.trim() || !form.slug.trim()) { setError('Titre et slug requis'); return }
    setError('')
    startTransition(async () => {
      const r = await createPage(form)
      if (r && 'error' in r) setError(r.error)
    })
  }

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      const r = await deletePage(id)
      if ('ok' in r) setPages(p => p.filter(x => x.$id !== id))
      else setError(r.error)
      setDeletingId(null)
    })
  }

  function handleToggle(id: string, cur: boolean) {
    startTransition(async () => {
      const r = await togglePublished(id, !cur)
      if ('ok' in r) setPages(p => p.map(x => x.$id === id ? { ...x, isPublished: !cur } : x))
    })
  }

  function handleSetHomepage(id: string) {
    startTransition(async () => {
      const r = await setHomepage(id)
      if ('ok' in r) setPages(p => p.map(x => ({ ...x, isHomepage: x.$id === id })))
      else setError(r.error)
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white/90">Pages du site</h1>
          <p className="text-sm text-white/40 mt-0.5">{pages.length} page{pages.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => { setShowNew(!showNew); setSlugEdited(false) }}
          className="gap-2 bg-white text-black hover:bg-white/90 font-semibold">
          <Plus className="h-4 w-4" /> Nouvelle page
        </Button>
      </div>

      {/* Create form */}
      {showNew && (
        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/[0.1] space-y-4">
          <h2 className="text-sm font-semibold text-white/70">Créer une nouvelle page</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-white/35 uppercase tracking-widest">Titre *</Label>
              <Input value={form.title} onChange={e => handleTitleChange(e.target.value)}
                className={inputCls} placeholder="Ma page..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-white/35 uppercase tracking-widest">Slug (URL) *</Label>
              <div className="flex items-center">
                <span className="px-2 py-2 bg-white/[0.03] border border-r-0 border-white/[0.1] rounded-l-lg text-white/25 text-xs h-9 flex items-center">/</span>
                <Input value={form.slug} onChange={e => handleSlugChange(e.target.value)}
                  className={inputCls + ' rounded-l-none h-9'} placeholder="ma-page" />
              </div>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-[10px] text-white/35 uppercase tracking-widest">Meta description SEO</Label>
              <Input value={form.metaDescription} onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))}
                className={inputCls} placeholder="Description pour les moteurs de recherche..." />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleCreate} disabled={isPending} className="gap-2 bg-white text-black hover:bg-white/90 font-semibold text-sm h-9">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isPending ? 'Création...' : 'Créer et ouvrir'}
            </Button>
            <Button variant="ghost" onClick={resetForm}
              className="text-white/40 hover:text-white/70 text-sm h-9">Annuler</Button>
          </div>
        </div>
      )}

      {/* Pages list */}
      {pages.length === 0 ? (
        <div className="py-20 text-center">
          <FileText className="h-10 w-10 text-white/[0.08] mx-auto mb-3" />
          <p className="text-white/30 text-sm">Aucune page créée</p>
          <p className="text-white/15 text-xs mt-1">Cliquez sur « Nouvelle page » pour commencer</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map(page => (
            <div key={page.$id}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-white/[0.12] transition-colors group">
              <FileText className="h-4 w-4 text-white/25 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80 truncate">{page.title}</p>
                <p className="text-xs text-white/30 font-mono">/{page.slug}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {page.isHomepage && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    <Home className="h-2.5 w-2.5" /> Accueil
                  </span>
                )}
                {!page.isHomepage && page.isPublished && (
                  <button onClick={() => handleSetHomepage(page.$id)}
                    title="Définir comme page d'accueil"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white/20 border border-white/[0.06] hover:text-amber-400 hover:border-amber-500/20 transition-colors">
                    <Home className="h-2.5 w-2.5" /> Accueil
                  </button>
                )}
                <button onClick={() => handleToggle(page.$id, page.isPublished)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    page.isPublished ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.03] text-white/35 border-white/[0.08] hover:border-white/20'
                  }`}>
                  {page.isPublished ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {page.isPublished ? 'Publié' : 'Brouillon'}
                </button>
                {page.isPublished && (
                  <a href={`/${page.slug}`} target="_blank"
                    className="p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <Link href={page.isHomepage ? '/admin/homepage' : `/admin/pages/${page.$id}`}
                  className="p-1.5 rounded-lg text-white/20 hover:text-white/70 hover:bg-white/[0.06] transition-colors">
                  <Edit2 className="h-3.5 w-3.5" />
                </Link>
                <button onClick={() => handleDelete(page.$id)} disabled={deletingId === page.$id}
                  className="p-1.5 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors">
                  {deletingId === page.$id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
