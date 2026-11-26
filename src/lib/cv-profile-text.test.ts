import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { strToU8, zipSync } from 'fflate'
import { CV_PROFILE_MAX_CHARS, cvProfileTextFromBuffer } from './cv-profile-text'

// Le PDF n'est essayé que sur un fichier abîmé : pdf.js 1.10 rend parfois, sous charge, un texte vide sur un vrai PDF.

/** DOCX minimal : un paragraphe par élément. */
function docx(paragraphs: string[]): Buffer {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`),
  }))
}

describe('cvProfileTextFromBuffer', () => {
  it('texte brut : caractères hors ASCII imprimable et latin étendu remplacés, blancs répétés réduits, borné', async () => {
    const text = await cvProfileTextFromBuffer(Buffer.from('Jeanne Exemple\u0007 😀     Développeuse Java senior\t' + 'mission fictive '.repeat(600)))
    assert.ok(text.startsWith('Jeanne Exemple\nDéveloppeuse Java senior\tmission fictive'))
    assert.equal(text.length, CV_PROFILE_MAX_CHARS)
  })

  it('texte brut de 50 caractères ou moins : vide', async () => {
    assert.equal(await cvProfileTextFromBuffer(Buffer.from('Jeanne Exemple — Développeuse')), '')
  })

  it('DOCX lu par ses premiers octets, texte de mammoth borné puis sans blancs aux bords', async () => {
    const text = await cvProfileTextFromBuffer(docx(['Jeanne Exemple', 'Développeuse Java senior', ...Array.from({ length: 300 }, (_, i) => `Mission ${i} chez un client fictif.`)]))
    assert.ok(text.startsWith('Jeanne Exemple\n\nDéveloppeuse Java senior\n\nMission 0 chez un client fictif.'))
    assert.ok(text.length <= CV_PROFILE_MAX_CHARS)
    // Un DOCX court n'est pas vidé ici : extractCvProfile l'écarte (CV_PROFILE_MIN_TEXT).
    assert.equal(await cvProfileTextFromBuffer(docx(['  CV  '])), 'CV')
  })

  it('lève sur un PDF ou un DOCX illisible', async () => {
    await assert.rejects(cvProfileTextFromBuffer(Buffer.from('%PDF-1.4 pas un vrai pdf')))
    await assert.rejects(cvProfileTextFromBuffer(Buffer.from('PK\u0003\u0004 pas une archive')))
  })
})
