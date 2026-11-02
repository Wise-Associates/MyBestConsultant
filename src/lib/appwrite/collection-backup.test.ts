import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AppwriteException, type Models } from 'node-appwrite'
import { backupCollection, backupCollectionId, backupData, BackupStop, isBackupCollectionId } from './collection-backup'

type Attribute = Models.AttributeList['attributes'][number]
interface FakeCollection { attributes: Record<string, unknown>[]; docs: Map<string, Models.Document> }

/** Base Appwrite en mémoire : attributs disponibles dès leur création, listes sans pagination (moins de 500 documents). */
function fakeDatabase(collections: Record<string, FakeCollection>) {
  const calls: string[] = []
  const get = (id: string) => {
    const collection = collections[id]
    if (!collection) throw new AppwriteException('Collection not found', 404)
    return collection
  }
  const attribute = (type: string, extra: Record<string, unknown> = {}) =>
    async (_db: string, collectionId: string, key: string, required: boolean, ...rest: unknown[]) => {
      calls.push(`${collectionId}.${key}:${type}:${required ? 'obligatoire' : 'facultatif'}`)
      // `array` est le dernier paramètre de chaque méthode de création.
      get(collectionId).attributes.push({ key, type, status: 'available', required, array: rest.at(-1) ?? false, ...extra, rest })
      return {} as never
    }
  const db = {
    async getCollection(_db: string, id: string) { get(id); return {} as never },
    async createCollection(_db: string, id: string, _name: string, permissions: string[], documentSecurity: boolean) {
      calls.push(`collection ${id} permissions=${JSON.stringify(permissions)} sécurité-document=${documentSecurity}`)
      collections[id] = { attributes: [], docs: new Map() }
      return {} as never
    },
    async listAttributes(_db: string, id: string) {
      const { attributes } = get(id)
      return { total: attributes.length, attributes: attributes as unknown as Attribute[] }
    },
    async listDocuments(_db: string, id: string) {
      const documents = [...get(id).docs.values()]
      return { total: documents.length, documents }
    },
    async createDocument(_db: string, id: string, docId: string, data: Record<string, unknown>, permissions?: string[]) {
      const { docs } = get(id)
      if (docs.has(docId)) throw new AppwriteException('Document already exists', 409)
      const doc = { ...data, $id: docId, $permissions: permissions ?? [], $createdAt: 'maintenant', $updatedAt: 'maintenant' } as unknown as Models.Document
      docs.set(docId, doc)
      return doc
    },
    createStringAttribute: async (dbId: string, collectionId: string, key: string, size: number, required: boolean, ...rest: unknown[]) =>
      attribute('string', { size })(dbId, collectionId, key, required, ...rest),
    createEmailAttribute: attribute('string', { format: 'email' }),
    createUrlAttribute: attribute('string', { format: 'url' }),
    createIpAttribute: attribute('string', { format: 'ip' }),
    createEnumAttribute: async (dbId: string, collectionId: string, key: string, elements: string[], required: boolean, ...rest: unknown[]) =>
      attribute('string', { format: 'enum', elements })(dbId, collectionId, key, required, ...rest),
    createIntegerAttribute: attribute('integer'),
    createFloatAttribute: attribute('double'),
    createBooleanAttribute: attribute('boolean'),
    createDatetimeAttribute: attribute('datetime'),
  }
  // Méthodes génériques du SDK (listDocuments<T>…) : le faux n'en reproduit que la forme utilisée.
  return { db: db as unknown as Parameters<typeof backupCollection>[0], calls }
}

const job = (id: string, data: Record<string, unknown>) => ({
  $id: id, $createdAt: `créé-${id}`, $updatedAt: `modifié-${id}`, $permissions: ['read("team:x")'],
  $databaseId: 'base', $collectionId: 'jobs', ...data,
}) as unknown as Models.Document

const jobsCollection = (): FakeCollection => ({
  attributes: [
    { key: 'tenantId', type: 'string', size: 36, required: true, array: false, status: 'available' },
    { key: 'skills', type: 'string', size: 100, required: true, array: true, status: 'available' },
    { key: 'salary', type: 'integer', required: false, array: false, min: -9223372036854776000, max: 9223372036854776000, status: 'available' },
    { key: 'isActive', type: 'boolean', required: false, array: false, status: 'available' },
    { key: 'expiresAt', type: 'datetime', required: false, array: false, status: 'available' },
  ],
  docs: new Map([
    ['j1', job('j1', { tenantId: 'org1', skills: ['Java'], salary: 50000, isActive: true, expiresAt: null })],
    ['j2', job('j2', { tenantId: 'org2', skills: [], salary: null, isActive: false, expiresAt: null })],
  ]),
})

describe('sauvegarde d’une collection', () => {
  it('nomme la sauvegarde d’après le jour à Paris', () => {
    assert.equal(backupCollectionId('jobs', new Date('2026-11-02T10:00:00Z')), 'jobs_backup_02112026')
    assert.equal(backupCollectionId('jobs', new Date('2026-11-01T23:30:00Z')), 'jobs_backup_02112026', 'minuit passé à Paris')
    assert.throws(() => backupCollectionId('x'.repeat(30), new Date()), BackupStop)
  })

  it('reconnaît une sauvegarde, à écarter du fichier de structure', () => {
    assert.equal(isBackupCollectionId('jobs_backup_02112026'), true)
    assert.equal(isBackupCollectionId('jobs'), false)
    assert.equal(isBackupCollectionId('jobs_backup'), false)
  })

  it('recopie les attributs d’un document et ses dates d’origine, pas les champs Appwrite', () => {
    assert.deepEqual(backupData(job('j1', { tenantId: 'org1' })), { tenantId: 'org1', originalCreatedAt: 'créé-j1', originalUpdatedAt: 'modifié-j1' })
  })

  it('crée une collection fermée aux attributs facultatifs et y recopie les documents', async () => {
    const collections: Record<string, FakeCollection> = { jobs: jobsCollection() }
    const { db, calls } = fakeDatabase(collections)
    const report = await backupCollection(db, 'base', 'jobs', 'jobs_backup_02112026', true)

    assert.deepEqual({ ...report, savedIds: [...report.savedIds].sort() }, { existed: false, copied: 2, kept: 0, savedIds: ['j1', 'j2'] })
    assert.equal(calls[0], 'collection jobs_backup_02112026 permissions=[] sécurité-document=false')
    assert.ok(calls.slice(1).every(call => call.endsWith(':facultatif')), calls.join('\n'))
    const backup = collections.jobs_backup_02112026
    const salary = backup.attributes.find(a => a.key === 'salary')
    assert.deepEqual(salary?.rest, [undefined, undefined, undefined, false], 'bornes 64 bits arrondies par le SDK laissées par défaut')
    assert.deepEqual(backup.attributes.find(a => a.key === 'skills')?.rest, [undefined, true], 'tableau gardé')
    const copy = backup.docs.get('j1') as unknown as Record<string, unknown>
    assert.equal(copy.tenantId, 'org1')
    assert.equal(copy.originalCreatedAt, 'créé-j1')
    assert.deepEqual(copy.$permissions, ['read("team:x")'])
  })

  it('garde les documents déjà sauvegardés (état d’avant le premier passage)', async () => {
    const collections: Record<string, FakeCollection> = { jobs: jobsCollection() }
    const { db } = fakeDatabase(collections)
    await backupCollection(db, 'base', 'jobs', 'jobs_backup_02112026', true)
    ;(collections.jobs.docs.get('j1') as unknown as Record<string, unknown>).tenantId = 'org3'
    collections.jobs.docs.set('j3', job('j3', { tenantId: 'org1', skills: [] }))

    const report = await backupCollection(db, 'base', 'jobs', 'jobs_backup_02112026', true)
    assert.equal(report.existed, true)
    assert.equal(report.copied, 1)
    assert.equal(report.kept, 2)
    assert.equal((collections.jobs_backup_02112026.docs.get('j1') as unknown as Record<string, unknown>).tenantId, 'org1')
  })

  it('n’écrit rien en simulation', async () => {
    const collections: Record<string, FakeCollection> = { jobs: jobsCollection() }
    const { db, calls } = fakeDatabase(collections)
    const report = await backupCollection(db, 'base', 'jobs', 'jobs_backup_02112026', false)
    assert.equal(report.copied, 2)
    assert.deepEqual(calls, [])
    assert.equal(collections.jobs_backup_02112026, undefined)
  })

  it('s’arrête avant d’écrire sur une relation ou une collection de même nom qui n’est pas une sauvegarde', async () => {
    const withRelation = jobsCollection()
    withRelation.attributes.push({ key: 'owner', type: 'relationship', required: false, status: 'available' })
    const first = fakeDatabase({ jobs: withRelation })
    await assert.rejects(backupCollection(first.db, 'base', 'jobs', 'jobs_backup_02112026', true), BackupStop)
    assert.deepEqual(first.calls, [])

    const other: FakeCollection = { attributes: [{ key: 'tenantId', type: 'integer', required: false, status: 'available' }], docs: new Map() }
    const second = fakeDatabase({ jobs: jobsCollection(), jobs_backup_02112026: other })
    await assert.rejects(backupCollection(second.db, 'base', 'jobs', 'jobs_backup_02112026', true), BackupStop)
    assert.equal(other.docs.size, 0)
  })
})
