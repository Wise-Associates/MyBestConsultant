import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { inspectTemplate } from './inspect'
import { TemplateError, parseTemplateMap } from './template-check'
import { mapTemplate, mappingProblems, type AskModel } from './template-mapping'

// Modèle d'exemple du dépôt et sa cartographie (correcte) ; l'IA est simulée.
const DIR = path.join(process.cwd(), 'src/lib/cv-export/templates/example')
const TEMPLATE = new Uint8Array(readFileSync(path.join(DIR, 'template.docx')))
const MAP_JSON = readFileSync(path.join(DIR, 'template_map.json'), 'utf8')
const MAP = parseTemplateMap(MAP_JSON)
const EXAMPLE = { inspection: inspectTemplate(TEMPLATE), mapJson: MAP_JSON }

/** Modèle d'exemple dont le premier texte de l'en-tête reçoit `extra` (modèle hostile). */
function withHeaderText(extra: string): Uint8Array {
  const files = unzipSync(TEMPLATE)
  const name = Object.keys(files).find(n => /^word\/header\d*\.xml$/.test(n) && /<w:t[ >]/.test(strFromU8(files[n])))
  assert.ok(name, 'en-tête avec du texte dans le modèle d\'exemple')
  files[name] = strToU8(strFromU8(files[name]).replace('</w:t>', `${extra}</w:t>`))
  return zipSync(files)
}

/** Modèle Word minimal et fictif : un paragraphe par texte, sans aucun paragraphe vide. */
function minimalTemplate(texts: string[]): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const body = texts.map(t => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('')
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
  })
}

/** IA simulée : renvoie les réponses dans l'ordre et garde les messages reçus. */
function fakeModel(...answers: string[]) {
  const calls: { system: string; user: string }[] = []
  const ask: AskModel = async (system, user) => {
    calls.push({ system, user })
    return answers[Math.min(calls.length - 1, answers.length - 1)]
  }
  return { ask, calls }
}

describe('cartographie d\'un modèle par l\'IA', () => {
  it('retient la cartographie quand le candidat fictif s\'y place entièrement, au nom de l\'organisation', async () => {
    const model = fakeModel(`Voici la cartographie :\n\`\`\`json\n${MAP_JSON}\n\`\`\``)
    const { map, mapJson } = await mapTemplate({ bytes: TEMPLATE, esn: 'Organisation Fictive', example: EXAMPLE, ask: model.ask })
    assert.equal(model.calls.length, 1)
    assert.equal(map.esn, 'Organisation Fictive')
    assert.equal(parseTemplateMap(mapJson).esn, 'Organisation Fictive')
    assert.match(model.calls[0].user, /Nom de l'ESN : Organisation Fictive/)
    assert.match(model.calls[0].user, /\[Mois AAAA\] – \[Mois AAAA\] \| ⇥ \| \[Client\]/)
    assert.ok(model.calls[0].system.includes(MAP_JSON), 'exemple de cartographie dans les consignes')
  })

  it('redemande une fois, avec la réponse précédente et ses problèmes', async () => {
    const model = fakeModel('{pas du json', MAP_JSON)
    await mapTemplate({ bytes: TEMPLATE, esn: 'Organisation Fictive', example: EXAMPLE, ask: model.ask })
    assert.equal(model.calls.length, 2)
    assert.match(model.calls[1].user, /Ta cartographie précédente :\n\{pas du json/)
    assert.match(model.calls[1].user, /- Cartographie illisible/)
  })

  it('refuse après deux tentatives, en nommant ce qui manque', async () => {
    const withoutExperiences = JSON.stringify({ ...MAP, sections: (MAP.sections ?? []).filter(s => s !== 'experiences') })
    const model = fakeModel(withoutExperiences)
    await assert.rejects(mapTemplate({ bytes: TEMPLATE, esn: 'Organisation Fictive', example: EXAMPLE, ask: model.ask }),
      (err: Error) => err instanceof TemplateError && /n'a pas pu être analysé automatiquement : .*client d'une expérience/.test(err.message))
    assert.equal(model.calls.length, 2)
  })

  it('refuse un fichier qui n\'est pas un modèle Word sans appeler l\'IA', async () => {
    const model = fakeModel(MAP_JSON)
    await assert.rejects(mapTemplate({ bytes: new TextEncoder().encode('%PDF-1.7'), esn: 'Organisation Fictive', example: EXAMPLE, ask: model.ask }),
      /pas un document Word/)
    assert.equal(model.calls.length, 0)
  })

  it('refuse un modèle au texte démesuré sans appeler l\'IA', async () => {
    const model = fakeModel(MAP_JSON)
    await assert.rejects(mapTemplate({ bytes: withHeaderText('x'.repeat(120_000)), esn: 'Organisation Fictive', example: EXAMPLE, ask: model.ask }),
      (err: Error) => err instanceof TemplateError && /trop long/.test(err.message))
    assert.equal(model.calls.length, 0)
  })

  it('laisse passer une erreur de l\'IA elle-même (service indisponible)', async () => {
    const ask: AskModel = async () => { throw new Error('Modèle IA injoignable (délai dépassé)') }
    await assert.rejects(mapTemplate({ bytes: TEMPLATE, esn: 'Organisation Fictive', example: EXAMPLE, ask }), (err: Error) => !(err instanceof TemplateError))
  })
})

describe('problèmes d\'une cartographie, constatés sur le rendu', () => {
  it('aucun pour une cartographie correcte', () => {
    assert.deepEqual(mappingProblems(TEMPLATE, MAP), [])
  })

  it('un texte d\'exemple du modèle resté (corps reconstruit trop loin)', () => {
    const problems = mappingProblems(TEMPLATE, { ...MAP, body_start: 5 })
    assert.ok(problems.some(p => p.includes('« [Positionnement, réalisations marquantes.] » du modèle est resté')), problems.join('\n'))
  })

  it('des milliers de textes d\'exemple : 20 problèmes au plus, constatés en une lecture', () => {
    const flood = withHeaderText(Array.from({ length: 5_000 }, (_, i) => ` [exemple ${i}]`).join(''))
    const started = Date.now()
    const problems = mappingProblems(flood, MAP)
    assert.equal(problems.length, 20)
    assert.ok(Date.now() - started < 5_000, `${Date.now() - started} ms`)
  })

  it('un libellé français resté dans la version anglaise (écrit en dur au lieu de {lbl_…})', () => {
    const problems = mappingProblems(TEMPLATE, { ...MAP, fields: { ...MAP.fields, lang_line: ['Langues : ', '{langues_joined}'] } })
    assert.ok(problems.includes('le libellé français « Langues : » est resté dans la version anglaise'), problems.join('\n'))
  })

  it('un paragraphe vide ajouté sous un titre de section qui n\'en a pas dans le modèle', () => {
    const problems = mappingProblems(TEMPLATE, { ...MAP, layouts: { ...MAP.layouts, skills_head: ['spacer'] } })
    assert.ok(problems.some(p => p.includes('paragraphe vide ajouté sous le titre « COMPETENCES FONCTIONNELLES ET TECHNIQUES »')), problems.join('\n'))
  })

  it('des paragraphes vides ajoutés à un modèle qui n\'en a aucun (espacement par les paragraphes eux-mêmes)', () => {
    const template = minimalTemplate(['PROFIL', '[Résumé]', 'COMPÉTENCES', '[Catégorie] : [détail]', 'EXPÉRIENCES', '[Client]', '[Mission]'])
    const labels = { summary: 'PROFIL', skills: 'COMPÉTENCES', experiences: 'EXPÉRIENCES' }
    const map = {
      esn: 'Organisation Fictive', body_start: 0,
      protos: { section: 0, summary: 1, skill_item: 3, exp_header: 5, exp_bullet: 6 },
      fields: { skill_item: ['{categorie} : {contenu}'], exp_header: ['{client}'] },
      sections: ['summary', 'skills', 'experiences'],
      layouts: { summary_item: ['summary'], skills_item: ['skill_item'], experiences_item: ['exp_header', 'exp_bullet*'] },
      labels: { fr: labels, en: { summary: 'PROFILE', skills: 'SKILLS', experiences: 'EXPERIENCE' } },
    }
    // Sans <section>_head, le moteur met un paragraphe vide sous chaque titre de section (hors résumé).
    assert.ok(mappingProblems(template, map).some(p => p.startsWith('2 paragraphe(s) vide(s) ajouté(s)')))
    const tight = { ...map, layouts: { ...map.layouts, skills_head: [], experiences_head: [] } }
    assert.ok(!mappingProblems(template, tight).some(p => p.includes('paragraphe(s) vide(s)')))
  })

  it('un titre de section absent (prototype de titre manquant)', () => {
    const protos = Object.fromEntries(Object.entries(MAP.protos).filter(([name]) => name !== 'section_skills'))
    const problems = mappingProblems(TEMPLATE, { ...MAP, protos })
    assert.ok(problems.some(p => p.includes('« COMPETENCES FONCTIONNELLES ET TECHNIQUES » (fr)')), problems.join('\n'))
  })
})
