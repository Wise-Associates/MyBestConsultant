import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COMMENT_LENGTH, canDeleteComment, parseCommentBody } from './comment-input'

describe('commentaires sur une offre AO', () => {
  it('garde le texte saisi, sans les espaces superflus autour ni les lignes vides en excès', () => {
    assert.deepEqual(parseCommentBody('  Client relancé le 22/10.\n\n\n\nAttente retour.  '), { ok: true, body: 'Client relancé le 22/10.\n\nAttente retour.' })
  })

  it('refuse un commentaire vide, trop long ou qui n\'est pas du texte', () => {
    for (const bad of ['', '   \n ', 'x'.repeat(MAX_COMMENT_LENGTH + 1), 42, null, undefined]) {
      const r = parseCommentBody(bad)
      assert.equal(r.ok, false, String(bad).slice(0, 20))
      assert.ok(!r.ok && r.error.length > 5)
    }
    assert.equal(parseCommentBody('x'.repeat(MAX_COMMENT_LENGTH)).ok, true)
  })

  it('ne laisse supprimer un commentaire que par son auteur', () => {
    assert.equal(canDeleteComment({ authorId: 'u1' }, 'u1'), true)
    assert.equal(canDeleteComment({ authorId: 'u1' }, 'u2'), false)
    assert.equal(canDeleteComment({ authorId: '' }, ''), false, 'auteur inconnu : personne')
  })
})
