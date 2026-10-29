import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANDIDATE_ID, NOTES_MAX_LENGTH, initialChoice, parseStoredExport, serializeNotes, storedFor, ownsVivierCv, versionView, vivierExportKey, type CvExportVersion,
} from './stored'

const DOC = {
  $id: 'doc1',
  tenantId: 'admin',
  candidateId: 'cand1',
  mode: 'standard',
  lang: 'fr',
  fileId: 'file1',
  fileName: 'CV_Wise-Associates_J.D_Developpeur-Java_FR.docx',
  sourceCvFileId: 'cv1',
  notes: JSON.stringify(['2 champs « [À COMPLÉTER] » : information absente du CV, à saisir dans Word.']),
  generatedAt: '2026-10-23T10:00:00.000Z',
}

const version = (mode: CvExportVersion['mode'], lang: CvExportVersion['lang'], generatedAt: string): CvExportVersion =>
  ({ mode, lang, generatedAt, stale: null })

describe('parseStoredExport', () => {
  it('lit un document complet', () => {
    const stored = parseStoredExport(DOC)
    assert.equal(stored?.id, 'doc1')
    assert.equal(stored?.mode, 'standard')
    assert.equal(stored?.lang, 'fr')
    assert.deepEqual(stored?.notes, ['2 champs « [À COMPLÉTER] » : information absente du CV, à saisir dans Word.'])
  })

  it('écarte un document incomplet ou aux valeurs inconnues', () => {
    assert.equal(parseStoredExport({ ...DOC, mode: 'autre' }), null)
    assert.equal(parseStoredExport({ ...DOC, lang: 'de' }), null)
    assert.equal(parseStoredExport({ ...DOC, fileId: '' }), null)
    assert.equal(parseStoredExport({ ...DOC, tenantId: undefined }), null) // à reprendre par npm run cv-export:setup
    assert.equal(parseStoredExport({ ...DOC, generatedAt: undefined }), null)
  })

  it('garde la version quand le compte rendu est illisible', () => {
    assert.deepEqual(parseStoredExport({ ...DOC, notes: '{pas du json' })?.notes, [])
    assert.deepEqual(parseStoredExport({ ...DOC, notes: JSON.stringify(['ok', 3]) })?.notes, ['ok'])
  })
})

describe('serializeNotes', () => {
  it('garde toutes les remarques qui tiennent dans l\'attribut', () => {
    assert.deepEqual(JSON.parse(serializeNotes(['a', 'b'])), ['a', 'b'])
  })

  it('abandonne les dernières remarques au-delà de la taille de l\'attribut', () => {
    const long = 'x'.repeat(NOTES_MAX_LENGTH / 2)
    const serialized = serializeNotes(['courte', long, long])
    assert.ok(serialized.length <= NOTES_MAX_LENGTH)
    assert.deepEqual(JSON.parse(serialized), ['courte', long])
  })
})

describe('storedFor', () => {
  const versions = [
    version('standard', 'en', '2026-10-23T10:00:00.000Z'),
    version('standard', 'fr', '2026-10-22T10:00:00.000Z'),
    version('renforcee', 'fr', '2026-10-21T10:00:00.000Z'),
  ]

  it('renvoie les versions demandées dans l\'ordre des langues', () => {
    assert.deepEqual(storedFor(versions, 'standard', ['fr', 'en'])?.map(v => v.lang), ['fr', 'en'])
  })

  it('renvoie null s\'il manque une langue pour cette anonymisation', () => {
    assert.equal(storedFor(versions, 'renforcee', ['fr', 'en']), null)
    assert.equal(storedFor(versions, 'renforcee', ['en']), null)
    assert.equal(storedFor([], 'standard', ['fr']), null)
  })
})

describe('versionView', () => {
  it('signale une version tirée d\'un CV remplacé depuis', () => {
    const stored = parseStoredExport(DOC)
    assert.ok(stored)
    assert.equal(versionView(stored, 'cv1').stale, null)
    assert.equal(versionView(stored, 'cv2').stale, 'cv')
  })

  it('signale une version antérieure au modèle actuel de l\'organisation', () => {
    const stored = parseStoredExport(DOC)
    assert.ok(stored)
    assert.equal(versionView(stored, 'cv1', '2026-10-23T11:00:00.000+00:00').stale, 'template')
    assert.equal(versionView(stored, 'cv1', '2026-10-23T09:00:00.000+00:00').stale, null)
    assert.equal(versionView(stored, 'cv2', '2026-10-23T11:00:00.000+00:00').stale, 'cv') // le CV d'abord
  })

  it('ne transmet ni fichier ni identifiant à la fenêtre', () => {
    const stored = parseStoredExport(DOC)
    assert.ok(stored)
    assert.deepEqual(Object.keys(versionView(stored, 'cv1')).sort(), ['generatedAt', 'lang', 'mode', 'stale'])
  })
})

describe('initialChoice', () => {
  it('propose français + anglais standard sans version enregistrée', () => {
    assert.deepEqual(initialChoice([]), { langs: 'both', mode: 'standard' })
  })

  it('reprend l\'anonymisation et la langue de la version la plus récente', () => {
    const versions = [version('standard', 'fr', '2026-10-20T10:00:00.000Z'), version('renforcee', 'en', '2026-10-23T10:00:00.000Z')]
    assert.deepEqual(initialChoice(versions), { langs: 'en', mode: 'renforcee' })
  })

  it('propose les deux langues quand elles sont enregistrées pour cette anonymisation', () => {
    const versions = [version('renforcee', 'fr', '2026-10-22T10:00:00.000Z'), version('renforcee', 'en', '2026-10-23T10:00:00.000Z')]
    assert.deepEqual(initialChoice(versions), { langs: 'both', mode: 'renforcee' })
  })
})

describe('vivierExportKey', () => {
  it('clé d’un CV du vivier : tient dans l’attribut et n’est jamais acceptée par les routes des candidats', () => {
    const key = vivierExportKey('6a1b2c3d4e5f60718293')
    assert.equal(key, 'vivier:6a1b2c3d4e5f60718293')
    assert.ok(key && key.length <= 36)
    assert.equal(CANDIDATE_ID.test(key ?? ''), false)
  })

  it('identifiant invalide ou trop long : refusé', () => {
    assert.equal(vivierExportKey('../6a1b2c3d4e5f6'), null)
    assert.equal(vivierExportKey(''), null)
    assert.equal(vivierExportKey('a'.repeat(30)), null)
  })
})

describe('ownsVivierCv', () => {
  const owner = { tenantId: 'org1', userId: 'rec1' }

  it('le recruteur qui a importé le CV, dans son organisation : oui', () => {
    assert.equal(ownsVivierCv({ tenantId: 'org1', recruiterId: 'rec1' }, owner), true)
  })

  it('un autre recruteur de la même organisation, ou une autre organisation : non', () => {
    assert.equal(ownsVivierCv({ tenantId: 'org1', recruiterId: 'rec2' }, owner), false)
    assert.equal(ownsVivierCv({ tenantId: 'org2', recruiterId: 'rec1' }, owner), false)
  })

  it('document sans organisation ni recruteur, ou session incomplète : non', () => {
    assert.equal(ownsVivierCv({}, owner), false)
    assert.equal(ownsVivierCv({ tenantId: '', recruiterId: '' }, { tenantId: '', userId: '' }), false)
  })
})
