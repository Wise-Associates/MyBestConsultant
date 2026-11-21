import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { constants, deflateSync } from 'node:zlib'
import { PdfRefusedError, assertPdfInflateBounded } from './pdf-inflate-guard'

// PDF réduit à ce que lit le contrôle : des objets avec leur dictionnaire et leur flux.
function pdf(...objects: { dict: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')]
  objects.forEach((o, i) => {
    parts.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.data.length} ${o.dict} >>\nstream\r\n`, 'latin1'), o.data, Buffer.from('\r\nendstream\nendobj\n', 'latin1'))
  })
  parts.push(Buffer.from('%%EOF\n'))
  return Buffer.concat(parts)
}

const LIMITS = { perStreamBytes: 1_000_000, totalBytes: 3_000_000, nesting: 4 }
const flate = (bytes: number) => deflateSync(Buffer.alloc(bytes, 0x20))

describe('PDF refusé avant pdf.js s\'il se décompresse trop (revue de sécurité du 2026-11-21)', () => {
  it('laisse passer un PDF ordinaire : textes compressés, image JPEG, flux non compressé', async () => {
    await assertPdfInflateBounded(pdf(
      { dict: '/Filter /FlateDecode', data: flate(200_000) },
      { dict: '/Type /XObject /Subtype /Image /Filter /DCTDecode', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
      { dict: '', data: Buffer.from('BT (Bonjour) Tj ET', 'latin1') },
    ), LIMITS)
  })

  it('refuse un flux qui se décompresse au-delà de la limite par flux', async () => {
    await assert.rejects(assertPdfInflateBounded(pdf({ dict: '/Filter /FlateDecode', data: flate(1_500_000) }), LIMITS), PdfRefusedError)
  })

  it('refuse des flux qui, ensemble, dépassent la limite totale', async () => {
    const many = Array.from({ length: 4 }, () => ({ dict: '/Filter /FlateDecode', data: flate(900_000) }))
    await assert.rejects(assertPdfInflateBounded(pdf(...many), LIMITS), PdfRefusedError)
  })

  it('compte un flux compressé plusieurs fois, et refuse trop de couches', async () => {
    const twice = deflateSync(flate(1_500_000))
    await assert.rejects(assertPdfInflateBounded(pdf({ dict: '/Filter [/FlateDecode /FlateDecode]', data: twice }), LIMITS), PdfRefusedError)
    let layered = Buffer.from('BT (x) Tj ET', 'latin1')
    for (let i = 0; i < 6; i++) layered = deflateSync(layered)
    await assert.rejects(assertPdfInflateBounded(pdf({ dict: '/Filter /FlateDecode', data: layered }), LIMITS), PdfRefusedError)
  })

  it('refuse les filtres dont la taille ne peut pas être mesurée', async () => {
    for (const dict of ['/Filter /LZWDecode', '/Filter /RunLengthDecode', '/Filter [/ASCII85Decode /FlateDecode]', '/Filter /AHx', '/Filter 7 0 R']) {
      await assert.rejects(assertPdfInflateBounded(pdf({ dict, data: Buffer.from('donnees') }), LIMITS), PdfRefusedError, dict)
    }
  })

  it('ne prend pas « endstream » pour le début d\'un flux', async () => {
    const buffer = Buffer.concat([pdf({ dict: '/Filter /FlateDecode', data: flate(10) }), Buffer.from('trailer endstream fin', 'latin1')])
    await assertPdfInflateBounded(buffer, LIMITS)
  })

  it('mesure aussi un flux à fenêtre de compression réduite', async () => {
    const small = deflateSync(Buffer.alloc(1_500_000, 0x20), { windowBits: 14, level: constants.Z_BEST_COMPRESSION })
    assert.notEqual(small[0], 0x78)
    await assert.rejects(assertPdfInflateBounded(pdf({ dict: '/Filter /FlateDecode', data: small }), LIMITS), PdfRefusedError)
  })

  it('refuse un PDF chiffré, dont les flux ne peuvent pas être mesurés', async () => {
    const encrypted = Buffer.concat([pdf({ dict: '/Filter /FlateDecode', data: Buffer.from('chiffre', 'latin1') }), Buffer.from('trailer << /Encrypt 9 0 R >>', 'latin1')])
    await assert.rejects(assertPdfInflateBounded(encrypted, LIMITS), PdfRefusedError)
  })
})

