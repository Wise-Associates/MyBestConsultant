import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cvFileHeaders } from './cv-file-headers'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('en-têtes d\'un CV servi par /api/cv et /api/vivier-cv', () => {
  it('ouvre un vrai PDF dans le navigateur', () => {
    const h = cvFileHeaders(bytes('%PDF-1.7 …'), 'CV Jean Fictif.pdf')
    assert.equal(h['Content-Type'], 'application/pdf')
    assert.match(h['Content-Disposition'], /^inline;/)
    assert.equal(h['X-Content-Type-Options'], 'nosniff')
  })

  it('télécharge un document Word (.docx, .doc) au lieu de l\'afficher', () => {
    const docx = cvFileHeaders(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'cv.docx')
    assert.equal(docx['Content-Type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert.match(docx['Content-Disposition'], /^attachment;/)
    const doc = cvFileHeaders(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), 'cv.doc')
    assert.equal(doc['Content-Type'], 'application/msword')
    assert.match(doc['Content-Disposition'], /^attachment;/)
  })

  it('n\'affiche jamais une page HTML renommée « cv.pdf » : téléchargée, sans exécution possible', () => {
    const h = cvFileHeaders(bytes('<html><script>alert(1)</script></html>'), 'cv.pdf')
    assert.equal(h['Content-Type'], 'application/octet-stream')
    assert.match(h['Content-Disposition'], /^attachment;/)
    assert.equal(h['Content-Security-Policy'], 'sandbox')
    assert.equal(h['X-Content-Type-Options'], 'nosniff')
  })

  it('écrit un nom de fichier sans guillemet ni retour à la ligne, accents gardés en UTF-8', () => {
    const h = cvFileHeaders(bytes('%PDF'), 'CV "Éloïse"\r\nX-Injecte: 1.pdf')
    assert.doesNotMatch(h['Content-Disposition'], /[\r\n]/)
    assert.match(h['Content-Disposition'], /filename="CV___lo_se___X-Injecte__1.pdf"/)
    assert.match(h['Content-Disposition'], /filename\*=UTF-8''CV%20%22%C3%89lo%C3%AFse%22%0D%0AX-Injecte%3A%201.pdf/)
  })
})
