import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readBoundedBody } from './read-bounded-body'

/** Requête dont le corps arrive en plusieurs morceaux, sans Content-Length (la taille annoncée n'est pas crue). */
function request(parts: string[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part))
      controller.close()
    },
  })
  return new Request('https://mbc.example.test/api/scraper/status', { method: 'POST', body, duplex: 'half' } as RequestInit)
}

describe('readBoundedBody', () => {
  it('rend le corps entier tant qu’il ne dépasse pas la limite, limite comprise', async () => {
    assert.equal(await readBoundedBody(request(['{"a":', '1}']), 7), '{"a":1}')
  })

  it('abandonne un corps qui dépasse la limite, même en morceaux', async () => {
    assert.equal(await readBoundedBody(request(['x'.repeat(5), 'x'.repeat(5)]), 9), null)
  })

  it('rend une chaîne vide sans corps', async () => {
    assert.equal(await readBoundedBody(new Request('https://mbc.example.test/', { method: 'POST' }), 10), '')
  })

  it('lit l’UTF-8 coupé entre deux morceaux', async () => {
    const bytes = new TextEncoder().encode('é')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1))
        controller.enqueue(bytes.slice(1))
        controller.close()
      },
    })
    const req = new Request('https://mbc.example.test/', { method: 'POST', body, duplex: 'half' } as RequestInit)
    assert.equal(await readBoundedBody(req, 10), 'é')
  })
})
