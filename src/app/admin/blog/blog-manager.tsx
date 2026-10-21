'use client'

import { useState, useTransition } from 'react'
import { Plus, Edit2, Trash2, Loader2, Save, X, Eye, EyeOff, ImageIcon } from 'lucide-react'
import { ImageUpload } from '@/components/page-builder/image-upload'
import { createBlogPost, updateBlogPost, deleteBlogPost, type BlogPost } from './actions'

type PostForm = { title: string; excerpt: string; content: string; coverImageUrl: string; author: string; isPublished: boolean }
const EMPTY_FORM: PostForm = { title: '', excerpt: '', content: '', coverImageUrl: '', author: '', isPublished: false }

const FIELD_STYLE: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.85)', fontSize: 14, outline: 'none',
}
const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 6,
}

function PostEditor({ post, onClose, onSaved }: {
  post: BlogPost | null
  onClose: () => void
  onSaved: (post: BlogPost) => void
}) {
  const [form, setForm] = useState<PostForm>(post ? {
    title: post.title, excerpt: post.excerpt, content: post.content,
    coverImageUrl: post.coverImageUrl, author: post.author, isPublished: post.isPublished,
  } : EMPTY_FORM)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) => setForm(p => ({ ...p, [k]: v }))

  function save() {
    if (!form.title.trim()) { setError('Le titre est obligatoire'); return }
    setError('')
    startTransition(async () => {
      const res = post ? await updateBlogPost(post.$id, form) : await createBlogPost(form)
      if (res.error) { setError(res.error); return }
      onSaved(res.post!)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget && !pending) onClose() }}>
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 32px 80px rgba(0,0,0,0.5)', maxHeight: '90vh' }}>

        <div className="flex items-center justify-between px-7 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 2 }}>
              {post ? 'Modifier l\'article' : 'Nouvel article'}
            </p>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>{post?.title || 'Rédiger un article'}</h2>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => set('isPublished', !form.isPublished)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: form.isPublished ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
                color: form.isPublished ? '#34d399' : 'rgba(255,255,255,0.35)',
                border: `1px solid ${form.isPublished ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)'}`,
              }}>
              {form.isPublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {form.isPublished ? 'Publié' : 'Brouillon'}
            </button>
            <button onClick={() => !pending && onClose()} className="p-2 rounded-lg hover:opacity-60" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-7 py-6 space-y-5 flex-1">
          <div>
            <label style={LABEL_STYLE}>Titre</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} style={FIELD_STYLE} placeholder="Titre de l'article" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label style={LABEL_STYLE}>Auteur</label>
              <input value={form.author} onChange={e => set('author', e.target.value)} style={FIELD_STYLE} placeholder="MyBestConsultant" />
            </div>
            <div>
              <label style={LABEL_STYLE}>Image de couverture</label>
              <ImageUpload value={form.coverImageUrl} onChange={v => set('coverImageUrl', v)} />
            </div>
          </div>

          <div>
            <label style={LABEL_STYLE}>Extrait (affiché sur la carte)</label>
            <textarea value={form.excerpt} onChange={e => set('excerpt', e.target.value)} rows={2}
              style={{ ...FIELD_STYLE, resize: 'vertical' }} placeholder="Résumé court, 1-2 phrases…" />
          </div>

          <div>
            <label style={LABEL_STYLE}>Contenu de l&apos;article</label>
            <textarea value={form.content} onChange={e => set('content', e.target.value)} rows={12}
              style={{ ...FIELD_STYLE, resize: 'vertical', lineHeight: 1.7 }}
              placeholder="Texte complet — un paragraphe par ligne vide…" />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}
        </div>

        <div className="px-7 py-5 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button onClick={() => !pending && onClose()}
            className="px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-60"
            style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Annuler
          </button>
          <button onClick={save} disabled={pending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #B8860B, #DAA520)', color: 'white' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function BlogManager({ initialPosts }: { initialPosts: BlogPost[] }) {
  const [posts, setPosts] = useState<BlogPost[]>(initialPosts)
  const [editing, setEditing] = useState<BlogPost | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BlogPost | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSaved(post: BlogPost) {
    setPosts(prev => prev.some(p => p.$id === post.$id) ? prev.map(p => p.$id === post.$id ? post : p) : [post, ...prev])
    setEditing(null)
  }

  function handleDelete(post: BlogPost) {
    startTransition(async () => {
      const res = await deleteBlogPost(post.$id)
      if (!res.error) setPosts(prev => prev.filter(p => p.$id !== post.$id))
      setConfirmDelete(null)
    })
  }

  return (
    <div>
      <div className="px-6 py-4 flex justify-end" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #B8860B, #DAA520)', color: 'white' }}>
          <Plus className="h-4 w-4" />
          Nouvel article
        </button>
      </div>

      {posts.length === 0 ? (
        <div className="px-6 py-16 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Aucun article pour l&apos;instant.
        </div>
      ) : (
        <div>
          {posts.map((post, i) => (
            <div key={post.$id} className="flex items-center gap-4 px-6 py-4"
              style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                {post.coverImageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={post.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  : <ImageIcon className="h-5 w-5" style={{ color: 'rgba(255,255,255,0.2)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{post.title}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{post.excerpt || 'Pas d\'extrait'}</p>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                style={{
                  background: post.isPublished ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
                  color: post.isPublished ? '#34d399' : 'rgba(255,255,255,0.4)',
                }}>
                {post.isPublished ? 'Publié' : 'Brouillon'}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setEditing(post)} className="p-2 rounded-lg hover:bg-white/5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => setConfirmDelete(post)} className="p-2 rounded-lg hover:bg-red-500/10" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PostEditor post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.09)' }}>
            <p className="text-sm text-white mb-1 font-semibold">Supprimer cet article ?</p>
            <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.4)' }}>{confirmDelete.title} — action irréversible.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Annuler</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
                {isPending ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
