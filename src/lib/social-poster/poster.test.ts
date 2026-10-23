import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SOCIAL_CONFIG, SAMPLE_JOB, buildContent, fallbackCopy } from '../social-content'
import { renderPoster } from './poster'
import { POSTER_HEIGHT, POSTER_WIDTH } from './rules'

// Rendu réel de l'affiche (polices et logo du dépôt) : on vérifie que c'est bien un PNG au format publié.
const pngSize = (png: Uint8Array) => {
  const b = Buffer.from(png)
  assert.equal(b.subarray(1, 4).toString(), 'PNG')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const image = buildContent(SAMPLE_JOB, fallbackCopy(SAMPLE_JOB), DEFAULT_SOCIAL_CONFIG, { baseUrl: 'https://exemple.test', calendlyUrl: '' }).image

describe('renderPoster', () => {
  it('dessine l\'affiche sans scène photo (repli quand OpenAI ne répond pas)', async () => {
    assert.deepEqual(pngSize(await renderPoster(image, null)), { width: POSTER_WIDTH, height: POSTER_HEIGHT })
  })

  it('dessine l\'affiche avec une scène photo', async () => {
    const scene = { bytes: new Uint8Array(readFileSync(path.join(process.cwd(), 'public', 'logo.png'))), mime: 'image/png' as const }
    assert.deepEqual(pngSize(await renderPoster(image, scene)), { width: POSTER_WIDTH, height: POSTER_HEIGHT })
  })

  it('tient avec un intitulé très long et des textes accentués', async () => {
    const long = { ...image, title: 'Consultant fonctionnel SAP S/4HANA Finance, contrôle de gestion et trésorerie — Île-de-France', tagline: 'Évoluez au cœur d’une équipe experte, à la hauteur de vos ambitions' }
    assert.deepEqual(pngSize(await renderPoster(long, null)), { width: POSTER_WIDTH, height: POSTER_HEIGHT })
  })
})
