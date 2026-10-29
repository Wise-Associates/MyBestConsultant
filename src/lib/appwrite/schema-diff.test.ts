import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  configFor, describeChange, diffBuckets, diffSchema, isAddition, isBlocking, needsAttention, pushCopy,
  type SchemaBucket, type SchemaChange, type SchemaCollection, type SchemaConfig,
} from './schema-diff'

const DEV = { projectId: 'projet-dev', databaseId: 'base-dev' }
const PROD = { projectId: 'projet-prod', databaseId: 'base-prod' }

// Collection fictive telle que la rend `appwrite pull collection`.
function collection(overrides: Partial<SchemaCollection> = {}): SchemaCollection {
  return {
    $id: 'offres',
    $permissions: [],
    databaseId: DEV.databaseId,
    name: 'offres',
    enabled: true,
    documentSecurity: false,
    attributes: [
      { key: 'titre', type: 'string', required: true, array: false, size: 255, default: null, encrypt: false },
      { key: 'statut', type: 'string', required: false, array: false, size: 32, default: 'nouvelle', encrypt: false },
    ],
    indexes: [{ key: 'par_statut', type: 'key', status: 'available', attributes: ['statut'], orders: [] }],
    ...overrides,
  }
}

const kinds = (local: SchemaCollection[], remote: SchemaCollection[]) =>
  diffSchema(local, remote).map(change => `${change.kind} ${change.target}`)

describe('structure Appwrite : comparaison du fichier et du projet', () => {
  it('ne voit rien entre deux structures identiques, valeurs vides comprises (null, absente, chaîne blanche, tableau vide)', () => {
    const remote = collection()
    const local = collection({
      attributes: [
        { key: 'titre', type: 'string', required: true, array: false, size: 255, encrypt: false },
        { key: 'statut', type: 'string', required: false, array: false, size: 32, default: 'nouvelle', encrypt: false },
      ],
      indexes: [{ key: 'par_statut', type: 'key', attributes: ['statut'], orders: null }],
    })
    assert.deepEqual(diffSchema([local], [remote]), [])
  })

  it('ignore les collections du projet absentes du fichier : la CLI n\'y touche pas', () => {
    assert.deepEqual(diffSchema([collection()], [collection(), collection({ $id: 'ancienne' })]), [])
  })

  it('applique les ajouts : collection (permissions affichées), attribut facultatif, index', () => {
    const remote = collection()
    const local = collection({
      attributes: [...remote.attributes, { key: 'ville', type: 'string', required: false, array: false, size: 128 }],
      indexes: [...remote.indexes, { key: 'par_ville', type: 'key', attributes: ['ville'], orders: [] }],
    })
    const changes = diffSchema([local, collection({ $id: 'nouvelle', $permissions: ['read("any")'] })], [remote])
    assert.deepEqual(changes.map(change => `${change.kind} ${change.target}`), ['add-attribute offres.ville', 'add-index offres.par_ville', 'create-collection nouvelle'])
    assert.ok(changes.every(isAddition))
    assert.equal(changes[2].detail, '$permissions : ["read(\\"any\\")"], documentSecurity : false')
  })

  it('garde ce que seul le projet a, sans bloquer les ajouts : sa suppression attend le déploiement du code', () => {
    const remote = collection()
    const local = collection({
      attributes: [remote.attributes[0], { key: 'ville', type: 'string', required: false, array: false, size: 128 }],
      indexes: [],
    })
    const changes = diffSchema([local], [remote])
    assert.deepEqual(changes.map(change => `${change.kind} ${change.target}`), ['add-attribute offres.ville', 'kept-attribute offres.statut', 'kept-index offres.par_statut'])
    assert.ok(!changes.some(isBlocking))
    assert.match(describeChange(changes[1]), /^· offres\.statut : absent du fichier, gardé/)
  })

  it('refuse un attribut obligatoire ajouté à une collection existante : ses documents n\'auraient pas de valeur', () => {
    const remote = collection()
    const local = collection({ attributes: [...remote.attributes, { key: 'client', type: 'string', required: true, array: false, size: 128 }] })
    const [change] = diffSchema([local], [remote])
    assert.equal(change.kind, 'add-required-attribute')
    assert.ok(isBlocking(change))
  })

  it('refuse un index unique ajouté à une collection existante, que ses données peuvent contredire', () => {
    const remote = collection()
    const local = collection({ indexes: [...remote.indexes, { key: 'titre_unique', type: 'unique', attributes: ['titre'], orders: [] }] })
    const [change] = diffSchema([local], [remote])
    assert.equal(change.kind, 'add-unique-index')
    assert.ok(isBlocking(change))
    assert.deepEqual(kinds([collection({ $id: 'nouvelle', indexes: local.indexes })], []), ['create-collection nouvelle'], 'collection nouvelle, donc vide : son index unique est créé avec elle')
  })

  it('refuse une modification sur place (obligatoire, valeur par défaut), que la CLI 8.3.0 affiche sans l\'appliquer', () => {
    const remote = collection()
    const local = collection({
      attributes: [remote.attributes[0], { ...remote.attributes[1], required: true, default: null }],
    })
    const [change] = diffSchema([local], [remote])
    assert.deepEqual(change, { kind: 'update-attribute', target: 'offres.statut', detail: 'required : false → true, default : "nouvelle" → null' })
    assert.ok(isBlocking(change))
  })

  it('refuse ce que la CLI supprimerait puis recréerait (données perdues), même mêlé à un réglage modifiable', () => {
    const remote = collection()
    const local = collection({ attributes: [remote.attributes[0], { ...remote.attributes[1], size: 64, required: true }] })
    const [change] = diffSchema([local], [remote])
    assert.deepEqual(change, { kind: 'recreate-attribute', target: 'offres.statut', detail: 'size : 32 → 64' })
    assert.ok(isBlocking(change))

    const recreatedIndex = collection({ indexes: [{ key: 'par_statut', type: 'unique', attributes: ['statut'], orders: [] }] })
    assert.deepEqual(kinds([recreatedIndex], [remote]), ['recreate-index offres.par_statut'])
  })

  it('refuse un index du projet resté « failed » ou en cours de création : sa contrainte ne s\'applique pas', () => {
    const remote = collection({ indexes: [{ key: 'par_statut', type: 'key', status: 'failed', attributes: ['statut'], orders: [] }] })
    const [change] = diffSchema([collection()], [remote])
    assert.deepEqual(change, { kind: 'unavailable-index', target: 'offres.par_statut', detail: 'status : "failed"' })
    assert.ok(isBlocking(change))
  })

  it('refuse une borne 64 bits arrondie par un outil qui a réécrit le fichier', () => {
    // Bornes lues au chiffre près, comme par le script (JSON.rawJSON, Node.js 22, absent des types TypeScript).
    const { rawJSON } = JSON as unknown as { rawJSON: (text: string) => unknown }
    const exact = { key: 'score', type: 'integer', required: false, array: false, min: rawJSON('-9223372036854775808'), max: rawJSON('9223372036854775807') }
    const remote = collection({ attributes: [exact] })
    assert.deepEqual(diffSchema([collection({ attributes: [{ ...exact }] })], [remote]), [])

    const [change] = diffSchema([collection({ attributes: [{ ...exact, max: 9223372036854775807 }] })], [remote])
    assert.deepEqual(change, { kind: 'rounded-bound', target: 'offres.score', detail: 'max : 9223372036854775807 → 9223372036854776000' })
    assert.ok(isBlocking(change))

    const [narrowed] = diffSchema([collection({ attributes: [{ ...exact, max: 100 }] })], [remote])
    assert.equal(narrowed.kind, 'update-attribute', 'une vraie nouvelle borne est une modification, pas un arrondi')
  })

  it('refuse les réglages de collection, que la CLI affiche sans les appliquer (permissions, sécurité par document)', () => {
    const local = collection({ $permissions: ['read("any")'], documentSecurity: true })
    const [change] = diffSchema([local], [collection()])
    assert.equal(change.kind, 'collection-settings')
    assert.equal(change.detail, '$permissions : [] → ["read(\\"any\\")"], documentSecurity : false → true')
    assert.ok(isBlocking(change))
  })

  it('décrit chaque changement sur une ligne : + ajouté, · gardé, ✗ refusé', () => {
    assert.equal(describeChange({ kind: 'add-index', target: 'offres.par_ville' }), '+ offres.par_ville : index ajouté')
    assert.match(describeChange({ kind: 'recreate-attribute', target: 'offres.statut' }), /^✗ offres\.statut : la CLI supprimerait/)
  })
})

describe('structure Appwrite : copie poussée par schema:push', () => {
  const file: SchemaConfig = {
    projectId: DEV.projectId,
    databases: [{ $id: DEV.databaseId, name: 'Base DEV', enabled: true }],
    collections: [collection()],
  }
  const prodDatabase = { $id: PROD.databaseId, name: 'base de production', enabled: true }

  it('vise le projet et la base de la production, avec la base telle qu\'elle est sur la production', () => {
    const copy = configFor(file, DEV, PROD, prodDatabase)
    assert.equal(copy.projectId, PROD.projectId)
    assert.deepEqual(copy.databases, [prodDatabase])
    assert.deepEqual(copy.collections?.map(c => c.databaseId), [PROD.databaseId])
    assert.equal(file.collections?.[0].databaseId, DEV.databaseId, 'le fichier lui-même n\'est pas modifié')
  })

  it('refuse un fichier qui ne vient pas du projet DEV', () => {
    assert.throws(() => configFor({ ...file, projectId: PROD.projectId }, DEV, PROD, prodDatabase), /vise le projet projet-prod/)
  })

  it('refuse un fichier qui contient une autre base', () => {
    const twoDatabases = { ...file, collections: [collection(), collection({ $id: 'autre', databaseId: 'base-copie' })] }
    assert.throws(() => configFor(twoDatabases, DEV, PROD, prodDatabase), /contient la base base-copie/)
  })

  it('refuse une base lue sur le projet visé qui n\'est pas la sienne', () => {
    assert.throws(() => configFor(file, DEV, PROD, { ...prodDatabase, $id: 'base-copie' }), /base-copie lue sur projet-prod/)
  })

  it('reprend ce que seul le projet a : la CLI ne voit plus que des ajouts, jamais une suppression', () => {
    const remote = collection({ attributes: [...collection().attributes, { key: 'ancien', type: 'string', required: false, array: false, size: 64 }] })
    const local = collection({
      attributes: [collection().attributes[0], { key: 'ville', type: 'string', required: false, array: false, size: 128 }],
      indexes: [],
    })
    const copy = pushCopy({ ...file, collections: [local, collection({ $id: 'nouvelle' })] }, [remote], [])
    assert.deepEqual(kinds(copy.collections ?? [], [remote]), ['add-attribute offres.ville', 'create-collection nouvelle'])
  })
})

describe('structure Appwrite : buckets (ADR 0017)', () => {
  const bucket = (patch: Partial<SchemaBucket> = {}): SchemaBucket => ({
    $id: 'social_scenes', $permissions: [], fileSecurity: true, name: 'Social scenes', enabled: true, maximumFileSize: 10_485_760,
    allowedFileExtensions: ['jpg', 'png'], compression: 'none', encryption: false, antivirus: false, ...patch,
  })
  const summary = (changes: SchemaChange[]) => changes.map(change => `${change.kind} ${change.target}`)

  it('crée un bucket absent du projet, permissions affichées avant la confirmation', () => {
    const changes = diffBuckets([bucket()], [])
    assert.deepEqual(summary(changes), ['create-bucket bucket social_scenes'])
    assert.equal(isAddition(changes[0]), true)
    assert.match(changes[0].detail ?? '', /\$permissions : \[\], fileSecurity : true/)
    assert.match(describeChange(changes[0]), /^\+ bucket social_scenes : bucket créé/)
  })

  it('ne voit rien entre deux buckets identiques, et ignore les buckets du projet absents du fichier', () => {
    assert.deepEqual(diffBuckets([bucket()], [bucket(), bucket({ $id: 'autre' })]), [])
  })

  it('signale un bucket existant qui diffère, sans le modifier ni bloquer les ajouts', () => {
    const changes = diffBuckets([bucket()], [bucket({ $permissions: ['read("any")'], maximumFileSize: 5_242_880 })])
    assert.deepEqual(summary(changes), ['bucket-settings bucket social_scenes'])
    assert.equal(isAddition(changes[0]), false)
    assert.equal(isBlocking(changes[0]), false)
    assert.equal(needsAttention(changes[0]), true, 'à corriger dans la console : schema:push répond 1')
    assert.match(changes[0].detail ?? '', /\$permissions : \["read\(\\"any\\"\)"\] → \[\]/)
    assert.match(describeChange(changes[0]), /^! bucket social_scenes : réglage différent sur le projet, à corriger dans la console/)
  })

  it('copie poussée : seulement les buckets à créer, jamais un bucket existant (la CLI réécrirait ses réglages)', () => {
    const config: SchemaConfig = { projectId: DEV.projectId, collections: [], buckets: [bucket(), bucket({ $id: 'nouveau' })] }
    const copy = pushCopy(config, [], [bucket({ maximumFileSize: 1 })])
    assert.deepEqual(copy.buckets?.map(b => b.$id), ['nouveau'])
  })

  it('détail de la création : permissions, sécurité des fichiers, chiffrement, antivirus, taille, extensions', () => {
    assert.match(diffBuckets([bucket({ encryption: true })], [])[0].detail ?? '', /enabled : true, encryption : true, antivirus : false, 10485760 o max/)
  })

  it('refuse un fichier qui décrit deux fois le même bucket : la CLI le réécrirait sans le montrer', () => {
    const file: SchemaConfig = { projectId: DEV.projectId, databases: [{ $id: DEV.databaseId, name: 'Base DEV', enabled: true }], collections: [], buckets: [bucket(), bucket({ name: 'copie' })] }
    assert.throws(() => configFor(file, DEV, PROD, { $id: PROD.databaseId, name: 'base de production', enabled: true }), /deux fois le bucket social_scenes/)
  })

  it('les buckets du fichier suivent la copie vers un autre projet : ils appartiennent au projet, pas à la base', () => {
    const file: SchemaConfig = { projectId: DEV.projectId, databases: [{ $id: DEV.databaseId, name: 'Base DEV', enabled: true }], collections: [], buckets: [bucket()] }
    const copy = configFor(file, DEV, PROD, { $id: PROD.databaseId, name: 'base de production', enabled: true })
    assert.deepEqual(copy.buckets, [bucket()])
  })
})
