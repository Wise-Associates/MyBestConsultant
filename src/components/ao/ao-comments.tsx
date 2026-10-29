'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { MAX_COMMENT_LENGTH } from '@/lib/ao/comment-input'
import type { AoCommentView, AoDashboardActions } from '@/lib/ao/dashboard-types'
import { control, fieldLabel, secondaryButton } from '@/app/admin/candidats/labels'

// Discussion interne d'une offre AO (suivi, relances, contexte), affichée dans la fenêtre « Commentaires » du tableau :
// chargée à l'ouverture, du plus ancien au plus récent ; chacun peut supprimer les siens après confirmation.
// Ctrl+Entrée (⌘+Entrée) ajoute le commentaire. `onChanged` : le tableau met à jour son nombre de commentaires.

const commentDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })


type CommentActions = Pick<AoDashboardActions, 'listComments' | 'addComment' | 'deleteComment'>

export function AoComments({ offerId, actions, onChanged }: { offerId: string; actions: CommentActions; onChanged: () => void }) {
  const [comments, setComments] = useState<AoCommentView[] | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { listComments, addComment, deleteComment } = actions
  // L'action change d'identité à chaque relecture de la page (suivi des publications en cours : toutes les 15 s) : lue
  // par une ref, pour ne relire les commentaires qu'à l'ouverture de la fenêtre.
  const listRef = useRef(listComments)
  useEffect(() => { listRef.current = listComments })
  useEffect(() => {
    startTransition(async () => {
      const res = await listRef.current(offerId)
      if (res.comments) setComments(res.comments)
      else setError(res.error ?? 'Commentaires illisibles.')
    })
  }, [offerId])
  const add = () => startTransition(async () => {
    setError('')
    const res = await addComment(offerId, draft)
    if (!res.comment) return setError(res.error ?? 'Commentaire non enregistré.')
    const added = res.comment
    setComments(list => [...(list ?? []), added])
    setDraft('')
    onChanged()
  })
  const remove = (id: string) => startTransition(async () => {
    setError('')
    const res = await deleteComment(id)
    if (res.error) return setError(res.error)
    setComments(list => list?.filter(c => c.id !== id) ?? null)
    setConfirmId(null)
    onChanged()
  })

  return (
    <section>
      <p style={fieldLabel}>Commentaires{comments ? ` (${comments.length})` : ''}</p>
      {error && <p role="alert" className="text-sm mb-2" style={{ color: '#b91c1c' }}>{error}</p>}
      {comments === null && !error && <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>Chargement…</p>}
      {comments?.length === 0 && <p className="text-sm" style={{ color: 'var(--admin-fg-muted)' }}>Aucun commentaire pour l&apos;instant.</p>}
      {comments && comments.length > 0 && (
        <ul className="space-y-2 mb-3">
          {comments.map(c => (
            <li key={c.id} className="p-3 rounded-lg" style={{ background: 'var(--admin-panel-raised)' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>
                  <span className="font-semibold" style={{ color: 'var(--admin-fg)' }}>{c.authorName}</span> · {commentDate(c.createdAt)}
                </p>
                {c.mine && (confirmId === c.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => remove(c.id)} disabled={pending} className="font-semibold" style={{ color: '#b91c1c' }}>Confirmer la suppression</button>
                    <button type="button" onClick={() => setConfirmId(null)} disabled={pending} style={{ color: 'var(--admin-fg-muted)' }}>Annuler</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmId(c.id)} aria-label="Supprimer ce commentaire" title="Supprimer" style={{ color: 'var(--admin-fg-muted)' }}>
                    <Trash2 size={13} />
                  </button>
                ))}
              </div>
              <p className="text-sm mt-1 whitespace-pre-wrap break-words" style={{ color: 'var(--admin-fg)' }}>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={e => { e.preventDefault(); if (draft.trim()) add() }} className="space-y-2">
        <label htmlFor={`ao-comment-${offerId}`} className="sr-only">Nouveau commentaire</label>
        <textarea
          id={`ao-comment-${offerId}`}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) { e.preventDefault(); add() } }}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="Ajouter un commentaire (suivi, relance, contexte…)"
          style={{ ...control, width: '100%', resize: 'vertical' }}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--admin-fg-muted)' }}>{draft.length} / {MAX_COMMENT_LENGTH} · Ctrl+Entrée pour ajouter</span>
          <button type="submit" disabled={pending || !draft.trim()} style={{ ...secondaryButton, fontSize: 13, opacity: pending || !draft.trim() ? 0.6 : 1 }}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
            Ajouter
          </button>
        </div>
      </form>
    </section>
  )
}
