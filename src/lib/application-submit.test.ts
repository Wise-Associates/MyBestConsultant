import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPLY_GENERIC_ERROR, APPLY_SESSION_EXPIRED, applyErrorMessage, applyRefusal, fileProblem, filesProblem, storageErrorMessage,
} from './application-submit'

const MB = 1024 * 1024
const pdf = (name = 'cv.pdf', size = 200_000) => ({ name, size })

describe('fichiers d\'une candidature', () => {
  it('accepte un CV PDF, DOC ou DOCX, extension en majuscules comprise', () => {
    for (const name of ['cv.pdf', 'CV.PDF', 'cv final.docx', 'cv.Doc']) assert.equal(fileProblem(pdf(name), 'Le CV'), null, name)
  })

  it('refuse une image ou un autre format, en le nommant', () => {
    assert.match(fileProblem(pdf('portfolio.png'), 'Le document') ?? '', /« portfolio\.png ».*PDF, DOC ou DOCX/)
    assert.match(fileProblem(pdf('cv.odt'), 'Le CV') ?? '', /pas au bon format/)
  })

  it('refuse un fichier sans extension (fréquent depuis un téléphone) et dit quoi faire', () => {
    assert.match(fileProblem(pdf('cv'), 'Le CV') ?? '', /n’a pas d’extension.*PDF, DOC ou DOCX/)
    assert.match(fileProblem(pdf('.pdf'), 'Le CV') ?? '', /n’a pas d’extension/)
  })

  it('refuse un fichier vide ou de plus de 10 Mo', () => {
    assert.match(fileProblem(pdf('cv.pdf', 0), 'Le CV') ?? '', /est vide/)
    assert.equal(fileProblem(pdf('cv.pdf', 10 * MB), 'Le CV'), null)
    assert.match(fileProblem(pdf('cv.pdf', 11 * MB), 'Le CV') ?? '', /pèse 11 Mo : 10 Mo au plus/)
  })

  it('refuse un envoi de plus de 11 Mo en tout, même si chaque fichier passe', () => {
    assert.equal(filesProblem(pdf('cv.pdf', 6 * MB), [pdf('lettre.pdf', 5 * MB)]), null)
    assert.match(filesProblem(pdf('cv.pdf', 6 * MB), [pdf('lettre.pdf', 6 * MB)]) ?? '', /pèsent 12 Mo ensemble : 11 Mo au plus/)
  })

  it('refuse plus de 5 pièces jointes et signale le premier fichier refusé', () => {
    assert.match(filesProblem(null, Array.from({ length: 6 }, (_, i) => pdf(`doc${i}.pdf`))) ?? '', /5 documents/)
    assert.match(filesProblem(pdf('cv.pdf'), [pdf('a.pdf'), pdf('photo.jpg')]) ?? '', /photo\.jpg/)
    assert.equal(filesProblem(null, []), null, 'CV du profil, sans pièce jointe')
  })
})

describe('offre qui reçoit les candidatures', () => {
  const now = new Date('2026-11-20T10:00:00Z')

  it('accepte une offre active et non expirée, quelle que soit son organisation', () => {
    assert.equal(applyRefusal({ isActive: true }, now), null)
    assert.equal(applyRefusal({ isActive: true, expiresAt: '2026-12-01T00:00:00Z' }, now), null)
  })

  it('refuse une offre introuvable, désactivée ou expirée', () => {
    assert.equal(applyRefusal(null, now), 'introuvable')
    assert.equal(applyRefusal({ isActive: false }, now), 'fermee')
    assert.equal(applyRefusal({ isActive: true, expiresAt: '2026-11-20T10:00:00Z' }, now), 'fermee')
  })
})

describe('message affiché après un échec', () => {
  it('traduit les erreurs de stockage d\'Appwrite, jamais en anglais', () => {
    assert.match(storageErrorMessage('storage_file_type_unsupported') ?? '', /PDF, DOC ou DOCX/)
    assert.match(storageErrorMessage('storage_invalid_file_size') ?? '', /10 Mo/)
    assert.equal(storageErrorMessage('general_unknown'), null)
  })

  it('reprend le message du serveur quand la réponse est du JSON', () => {
    assert.equal(applyErrorMessage(400, '{"error":"Cette offre n’accepte plus de candidatures."}'), 'Cette offre n’accepte plus de candidatures.')
  })

  it('dit que la session a expiré pour un 401', () => {
    assert.equal(applyErrorMessage(401, '{"error":"Non authentifié"}'), APPLY_SESSION_EXPIRED)
  })

  it('gère une réponse sans JSON (envoi coupé par le proxy, page d\'erreur)', () => {
    assert.match(applyErrorMessage(413, ''), /trop lourds/)
    assert.equal(applyErrorMessage(502, '<html>Bad Gateway</html>'), APPLY_GENERIC_ERROR)
    assert.equal(applyErrorMessage(500, '{"error":""}'), APPLY_GENERIC_ERROR)
    assert.equal(applyErrorMessage(500, 'null'), APPLY_GENERIC_ERROR)
  })
})
