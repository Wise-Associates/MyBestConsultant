import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { MAX_MAP_LENGTH, MAX_TEMPLATE_BYTES, TEMPLATE_TOO_LARGE } from './limits'
import { TemplateError, checkTemplate, parseTemplateMap, templateUploadFiles } from './template-check'

const DIR = path.join(process.cwd(), 'src/lib/cv-export/templates/wise-associates')
const TEMPLATE = new Uint8Array(readFileSync(path.join(DIR, 'template.docx')))
const MAP_JSON = readFileSync(path.join(DIR, 'template_map.json'), 'utf8')

describe('parseTemplateMap', () => {
  it('lit la cartographie produite par la skill', () => {
    assert.equal(parseTemplateMap(MAP_JSON).esn, 'Wise Associates')
  })

  it('refuse un JSON illisible ou une clé absente / au mauvais format, en la citant', () => {
    assert.throws(() => parseTemplateMap('{pas du json'), TemplateError)
    const map = JSON.parse(MAP_JSON)
    const invalid = (changed: object, key: string) => assert.throws(() => parseTemplateMap(JSON.stringify({ ...map, ...changed })),
      (err: Error) => err instanceof TemplateError && err.message.includes(`« ${key}`))
    invalid({ labels: { fr: map.labels.fr } }, 'labels.en')
    invalid({ protos: { ...map.protos, exp_header: -1 } }, 'protos.exp_header')
    invalid({ esn: '' }, 'esn')
  })
})

describe('templateUploadFiles', () => {
  const file = (size: number, name: string) => new File([new Uint8Array(size)], name)

  it('accepte un .docx et sa cartographie aux tailles permises', () => {
    const docx = file(1000, 'modele.docx')
    const map = file(500, 'template_map.json')
    assert.deepEqual(templateUploadFiles(docx, map), { docx, map })
  })

  it('exige les deux fichiers, non vides (champ absent, texte à la place d\'un fichier)', () => {
    const missing = { error: 'Joignez le modèle Word (.docx) et son template_map.json.' }
    assert.deepEqual(templateUploadFiles(null, file(500, 'template_map.json')), missing)
    assert.deepEqual(templateUploadFiles(file(1000, 'modele.docx'), 'template_map.json'), missing)
    assert.deepEqual(templateUploadFiles(file(0, 'modele.docx'), file(500, 'template_map.json')), missing)
  })

  it('refuse un modèle au-delà de 2 Mo et une cartographie trop longue, avant toute lecture', () => {
    assert.deepEqual(templateUploadFiles(file(MAX_TEMPLATE_BYTES + 1, 'modele.docx'), file(500, 'm.json')), { error: TEMPLATE_TOO_LARGE })
    assert.match((templateUploadFiles(file(1000, 'modele.docx'), file(MAX_MAP_LENGTH * 4 + 1, 'm.json')) as { error: string }).error, /trop longue/)
  })
})

describe('modèle d\'exemple (templates/example)', () => {
  const EXAMPLE_DIR = path.join(process.cwd(), 'src/lib/cv-export/templates/example')
  const example = new Uint8Array(readFileSync(path.join(EXAMPLE_DIR, 'template.docx')))
  const exampleMap = readFileSync(path.join(EXAMPLE_DIR, 'template_map.json'), 'utf8')

  it('se rend avec sa cartographie dans les deux langues', () => {
    assert.equal(parseTemplateMap(exampleMap).esn, 'Votre ESN')
    const { fr, en } = checkTemplate(example, parseTemplateMap(exampleMap))
    assert.ok(fr.length > 0 && en.length > 0)
  })

  it('ne porte ni le nom, ni le logo, ni le contact commercial de Wise Associates (envoyé à toutes les organisations)', () => {
    const parts = unzipSync(example)
    for (const [name, bytes] of Object.entries(parts)) {
      if (!/\.(xml|rels)$/.test(name)) continue
      const xml = strFromU8(bytes)
      // Texte tel que Word l'affiche : un mot peut être coupé entre plusieurs fragments (w:t) d'un paragraphe.
      const paragraphs = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(p => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''))
      for (const text of [xml, ...paragraphs]) assert.doesNotMatch(text, /wise|bathaei|317154|06 07|kpot|capteo|attachedTemplate|file:\/\/\//i, name)
    }
    const wiseLogo = unzipSync(TEMPLATE)['word/media/image1.png']
    assert.ok(Object.values(parts).every(bytes => !Buffer.from(bytes).equals(Buffer.from(wiseLogo))), 'logo Wise Associates encore présent')
  })
})

describe('checkTemplate', () => {
  it('rend le candidat fictif dans les deux langues avec le modèle Wise Associates', () => {
    const samples = checkTemplate(TEMPLATE, parseTemplateMap(MAP_JSON))
    assert.match(strFromU8(unzipSync(samples.fr)['word/document.xml']), /Banque Exemple/)
    assert.match(strFromU8(unzipSync(samples.en)['word/document.xml']), /PROFESSIONAL EXPERIENCE/)
  })

  it('refuse un fichier qui n\'est pas un .docx', () => {
    assert.throws(() => checkTemplate(new TextEncoder().encode('%PDF-1.7'), parseTemplateMap(MAP_JSON)), /pas un document Word/)
  })

  it('refuse une cartographie qui ne correspond pas au fichier', () => {
    const map = parseTemplateMap(MAP_JSON)
    assert.throws(() => checkTemplate(TEMPLATE, { ...map, protos: { ...map.protos, exp_header: 999 } }),
      (err: Error) => err instanceof TemplateError && /exp_header/.test(err.message))
  })
})
