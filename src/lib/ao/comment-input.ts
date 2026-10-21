// Commentaires internes sur une offre AO (src/lib/ao/comments.ts) : règles pures, testées.

export const MAX_COMMENT_LENGTH = 5000

/** Texte d'un commentaire : espaces autour retirés, 3 lignes vides ou plus ramenées à une. */
export function parseCommentBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Commentaire invalide.' }
  const body = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!body) return { ok: false, error: 'Écrivez un commentaire avant de l\'ajouter.' }
  if (body.length > MAX_COMMENT_LENGTH) return { ok: false, error: `Commentaire trop long : ${MAX_COMMENT_LENGTH} caractères au plus.` }
  return { ok: true, body }
}

/** Seul l'auteur d'un commentaire peut le supprimer. */
export function canDeleteComment(comment: { authorId: string }, userId: string): boolean {
  return !!comment.authorId && comment.authorId === userId
}
