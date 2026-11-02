import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Query, type Databases } from 'node-appwrite'
import { listAllDocuments } from './list-all'

/** Faux Appwrite : applique `limit` et `cursorAfter` à `count` documents, et compte les appels. */
function fakeDatabases(count: number) {
  const docs = Array.from({ length: count }, (_, i) => ({ $id: `doc${i}` }))
  const calls: string[][] = []
  const databases = {
    async listDocuments(_db: string, _collection: string, queries: string[] = []) {
      calls.push(queries)
      const parsed = queries.map(q => JSON.parse(q) as { method: string; values?: unknown[] })
      const limit = Number(parsed.find(q => q.method === 'limit')?.values?.[0] ?? 25)
      const after = parsed.find(q => q.method === 'cursorAfter')?.values?.[0]
      const start = after ? docs.findIndex(d => d.$id === after) + 1 : 0
      return { total: count, documents: docs.slice(start, start + limit) }
    },
  } as unknown as Pick<Databases, 'listDocuments'>
  return { databases, calls }
}

describe('lecture de tous les documents (listAllDocuments)', () => {
  it('lit au-delà d\'une page : 1 234 offres donnent 1 234, pas 100 ni 500', async () => {
    const { databases, calls } = fakeDatabases(1234)
    const all = await listAllDocuments(databases, 'db', 'jobs', [Query.equal('tenantId', 'org-fictive')])
    assert.equal(all.length, 1234)
    assert.equal(new Set(all.map(d => d.$id)).size, 1234)
    assert.equal(calls.length, 3)
    assert.ok(calls.every(q => q[0] === Query.equal('tenantId', 'org-fictive')), 'les filtres sont repris à chaque page')
  })

  it('s\'arrête après une page pleine suivie d\'une page vide', async () => {
    const { databases, calls } = fakeDatabases(500)
    assert.equal((await listAllDocuments(databases, 'db', 'jobs', [])).length, 500)
    assert.equal(calls.length, 2)
  })

  it('fait une seule requête quand tout tient dans une page', async () => {
    const { databases, calls } = fakeDatabases(0)
    assert.deepEqual(await listAllDocuments(databases, 'db', 'jobs', []), [])
    assert.equal(calls.length, 1)
  })
})
