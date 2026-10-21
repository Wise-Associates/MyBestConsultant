'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plus, FileText, ExternalLink, Trash2, Globe, Lock, Loader2, Check, AlertCircle, Edit2, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createPage, deletePage, togglePublished, setHomepage } from './actions'
import type { Models } from 'node-appwrite'

const inputCls = "bg-admin-panel-raised border-admin-line text-admin-fg placeholder:text-admin-fg-subtle focus:border-admin-line-strong focus:ring-0 rounded-lg"

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
          <h1 className="text-xl font-semibold text-admin-fg">Pages du site</h1>
          <p className="text-sm text-admin-fg-muted mt-0.5">{pages.length} page{pages.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => { setShowNew(!showNew); setSlugEdited(false) }}
          className="gap-2 bg-admin-fg text-white hover:bg-admin-fg/90 font-semibold">
          <Plus className="h-4 w-4" /> Nouvelle page
        </Button>
      </div>

      {/* Create form */}
      {showNew && (
        <div className="p-5 rounded-2xl bg-admin-panel border border-admin-line space-y-4">
          <h2 className="text-sm font-semibold text-admin-fg">Créer une nouvelle page</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] text-admin-fg-muted uppercase tracking-widest">Titre *</Label>
              <Input value={form.title} onChange={e => handleTitleChange(e.target.value)}
                className={inputCls} placeholder="Ma page..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-admin-fg-muted uppercase tracking-widest">Slug (URL) *</Label>
              <div className="flex items-center">
                <span className="px-2 py-2 bg-admin-panel border border-r-0 border-admin-line rounded-l-lg text-admin-fg-muted text-xs h-9 flex items-center">/</span>
                <Input value={form.slug} onChange={e => handleSlugChange(e.target.value)}
                  className={inputCls + ' rounded-l-none h-9'} placeholder="ma-page" />
              </div>
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-[10px] text-admin-fg-muted uppercase tracking-widest">Meta description SEO</Label>
              <Input value={form.metaDescription} onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))}
                className={inputCls} placeholder="Description pour les moteurs de recherche..." />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleCreate} disabled={isPending} className="gap-2 bg-admin-fg text-white hover:bg-admin-fg/90 font-semibold text-sm h-9">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isPending ? 'Création...' : 'Créer et ouvrir'}
            </Button>
            <Button variant="ghost" onClick={resetForm}
              className="text-admin-fg-muted hover:text-admin-fg text-sm h-9">Annuler</Button>
          </div>
        </div>
      )}

      {/* Pages list */}
      {pages.length === 0 ? (
        <div className="py-20 text-center">
          <FileText className="h-10 w-10 text-admin-fg-muted mx-auto mb-3" />
          <p className="text-admin-fg-muted text-sm">Aucune page créée</p>
          <p className="text-admin-fg-muted text-xs mt-1">Cliquez sur « Nouvelle page » pour commencer</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map(page => (
            <div key={page.$id}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-admin-panel border border-admin-line hover:border-admin-line-strong transition-colors group">
              <FileText className="h-4 w-4 text-admin-fg-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-admin-fg truncate">{page.title}</p>
                <p className="text-xs text-admin-fg-muted font-mono">/{page.slug}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {page.isHomepage && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 border border-amber-500/20">
                    <Home className="h-2.5 w-2.5" /> Accueil
                  </span>
                )}
                {!page.isHomepage && page.isPublished && (
                  <button onClick={() => handleSetHomepage(page.$id)}
                    title="Définir comme page d'accueil"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-admin-fg-muted border border-admin-line hover:text-amber-700 hover:border-amber-500/20 transition-colors">
                    <Home className="h-2.5 w-2.5" /> Accueil
                  </button>
                )}
                <button onClick={() => handleToggle(page.$id, page.isPublished)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    page.isPublished ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' : 'bg-admin-panel text-admin-fg-muted border-admin-line hover:border-admin-line-strong'
                  }`}>
                  {page.isPublished ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {page.isPublished ? 'Publié' : 'Brouillon'}
                </button>
                {page.isPublished && (
                  <a href={`/${page.slug}`} target="_blank"
                    className="p-1.5 rounded-lg text-admin-fg-muted hover:text-admin-fg-muted hover:bg-admin-panel-raised transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <Link href={page.isHomepage ? '/admin/homepage' : `/admin/pages/${page.$id}`}
                  className="p-1.5 rounded-lg text-admin-fg-muted hover:text-admin-fg hover:bg-admin-panel-raised transition-colors">
                  <Edit2 className="h-3.5 w-3.5" />
                </Link>
                <button onClick={() => handleDelete(page.$id)} disabled={deletingId === page.$id}
                  className="p-1.5 rounded-lg text-admin-fg-muted hover:text-red-700 hover:bg-red-500/[0.08] transition-colors">
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
