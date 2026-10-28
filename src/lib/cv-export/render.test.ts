import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DOMParser, type Element } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { TemplateStructureError, fmt, renderCv } from './render'
import wiseMap from './templates/wise-associates/template_map.json'
import type { CvData, TemplateMap } from './types'

// Rendu dans le vrai template Wise Associates, avec un candidat fictif. Le portage a aussi été comparé à
// render_cv.py (skill) sur ces données : document.xml identique en FR.

const TEMPLATE = new Uint8Array(readFileSync(path.join(process.cwd(), 'src/lib/cv-export/templates/wise-associates/template.docx')))
const MAP: TemplateMap = wiseMap
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const DATA: CvData = {
  identifiant: 'C.F.',
  titre: 'Architecte Data & Cloud',
  experience: '12 ans d\'expérience',
  resume: ['Architecte Data avec 12 ans d\'expérience en banque.', 'A piloté une migration vers le cloud.'],
  experiences: [
    {
      dates: 'Janv 2021 – Aujourd\'hui', client: 'Banque Exemple', role_lignes: ['Programme Data — Architecte Data'],
      contexte: 'Refonte de la plateforme de données.', realisations: ['Conception de l\'architecture cible.', 'Encadrement de 6 data engineers.'],
      environnement: 'Azure, Spark, Kafka',
    },
    { dates: 'Sept 2016 – Déc 2020', client: 'Assureur Fictif', role_lignes: ['Lead développeur'], contexte: '', realisations: ['Tableaux de bord R&D <interne>.'], environnement: '' },
  ],
  formations: [{ annees: '2012', intitule: 'Diplôme d\'ingénieur', etablissement: 'École Exemple', details: ['Systèmes d\'information'] }],
  certifications: [],
  langues: [{ langue: 'Anglais', niveau: 'courant' }, { langue: 'Espagnol', niveau: 'intermédiaire' }],
  competences: [{ categorie: 'Cloud', contenu: 'Azure, AWS' }],
}

function part(docx: Uint8Array, name: string): string | undefined {
  const file = unzipSync(docx)[name]
  return file && strFromU8(file)
}

/** Paragraphes du corps : texte (tabulations comprises) et présence de « solidaire du suivant ». */
function paragraphs(docx: Uint8Array): { text: string; keepNext: boolean; el: Element }[] {
  const doc = new DOMParser().parseFromString(part(docx, 'word/document.xml') ?? '', 'text/xml')
  return Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).map(p => {
    let text = ''
    for (const node of Array.from(p.getElementsByTagNameNS(W_NS, '*'))) {
      if (node.localName === 't') text += node.textContent ?? ''
      if (node.localName === 'tab' && node.parentNode?.nodeName === 'w:r') text += '\t'
    }
    return { text, keepNext: p.getElementsByTagNameNS(W_NS, 'keepNext').length > 0, el: p }
  })
}

const find = (paras: ReturnType<typeof paragraphs>, text: string) => {
  const found = paras.find(p => p.text === text)
  assert.ok(found, `paragraphe introuvable : ${text}`)
  return found
}

describe('renderCv — template Wise Associates', () => {
  const fr = renderCv(TEMPLATE, MAP, DATA, 'fr')
  const paras = paragraphs(fr)
  const texts = paras.map(p => p.text)

  it('réécrit l\'identité de l\'en-tête et reconstruit les sections dans l\'ordre du template', () => {
    for (const expected of ['C.F.', 'Architecte Data & Cloud', ' 12 ans d\'expérience ']) assert.ok(texts.includes(expected), expected)
    const order = ['RESUME EXPERIENCE PROFESSIONNELLE', 'FORMATION – LANGUES', 'COMPETENCES FONCTIONNELLES ET TECHNIQUES', 'EXPERIENCE PROFESSIONNELLE']
      .map(label => texts.indexOf(label))
    assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), `ordre des sections : ${order}`)
  })

  it('garde le bloc contact du commercial et ne laisse aucun texte d\'exemple du template', () => {
    const all = texts.join('\n')
    assert.match(all, /David Bathaei/)
    for (const placeholder of ['[INITIALES]', '[Titre exact du CV]', '[Client]', '[Réalisation 1]', '[Catégorie]', '[AAAA]']) {
      assert.ok(!all.includes(placeholder), placeholder)
    }
  })

  it('remplit les gabarits : dates et client séparés par une tabulation, langues sur une ligne, environnement', () => {
    find(paras, 'Janv 2021 – Aujourd\'hui\tBanque Exemple')
    find(paras, 'Langues : Anglais (courant) - Espagnol (intermédiaire)')
    find(paras, 'Environnement : Azure, Spark, Kafka')
    find(paras, '2012 : Diplôme d\'ingénieur · École Exemple — Systèmes d\'information')
    find(paras, 'Cloud : Azure, AWS')
  })

  it('aligne le client à droite sur la marge (taquet du template_map)', () => {
    const header = find(paras, 'Sept 2016 – Déc 2020\tAssureur Fictif')
    const tab = header.el.getElementsByTagNameNS(W_NS, 'tabs')[0]?.getElementsByTagNameNS(W_NS, 'tab')[0]
    assert.equal(tab?.getAttributeNS(W_NS, 'val'), 'right')
    assert.equal(tab?.getAttributeNS(W_NS, 'pos'), '9666')
  })

  it('saute le contexte et l\'environnement absents', () => {
    const start = texts.indexOf('Sept 2016 – Déc 2020\tAssureur Fictif')
    const block = texts.slice(start, start + 4)
    assert.deepEqual(block.filter(Boolean), ['Sept 2016 – Déc 2020\tAssureur Fictif', 'Lead développeur', 'Tableaux de bord R&D <interne>.'])
  })

  it('rend une expérience insécable sans l\'enchaîner à la suivante', () => {
    for (const text of ['Janv 2021 – Aujourd\'hui\tBanque Exemple', 'Programme Data — Architecte Data', 'Refonte de la plateforme de données.', 'Encadrement de 6 data engineers.']) {
      assert.equal(find(paras, text).keepNext, true, text)
    }
    // Les prototypes du template Wise sont déjà « solidaires du suivant » (dernière ligne comprise) : la chaîne
    // s'arrête à l'espaceur qui sépare deux expériences.
    const last = paras.indexOf(find(paras, 'Environnement : Azure, Spark, Kafka'))
    assert.equal(paras[last + 1].text, '')
    assert.equal(paras[last + 1].keepNext, false)
    // titre de section collé à son premier bloc
    assert.equal(find(paras, 'EXPERIENCE PROFESSIONNELLE').keepNext, true)
  })

  it('neutralise les métadonnées et ne garde ni commentaire ni révision', () => {
    const core = part(fr, 'docProps/core.xml') ?? ''
    assert.match(core, /<dc:creator>Wise Associates<\/dc:creator>/)
    assert.match(core, /<cp:lastModifiedBy>Wise Associates<\/cp:lastModifiedBy>/)
    assert.equal(part(fr, 'word/comments.xml'), undefined)
    assert.doesNotMatch(part(fr, 'word/document.xml') ?? '', /<w:(ins|del)\b/)
    // Modèle Word d'origine du template : chemin local avec le nom de session Windows de son auteur.
    assert.doesNotMatch(part(fr, 'word/settings.xml') ?? '', /attachedTemplate/)
    assert.doesNotMatch(part(fr, 'word/_rels/settings.xml.rels') ?? '', /attachedTemplate|file:\/\/\//)
    assert.match(part(fr, 'docProps/app.xml') ?? '', /<Template><\/Template>/)
  })

  it('refuse un modèle trop complexe avant tout traitement (paragraphes vides en grand nombre)', () => {
    const files = unzipSync(TEMPLATE)
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace('<w:sectPr', '<w:p/>'.repeat(500) + '<w:sectPr'))
    assert.throws(() => renderCv(zipSync(files), MAP, DATA, 'fr'), TemplateStructureError)
  })

  it('version anglaise : libellés traduits et « Page 1 sur 2 » devenu « of »', () => {
    const en = renderCv(TEMPLATE, MAP, DATA, 'en')
    const enTexts = paragraphs(en).map(p => p.text)
    assert.ok(enTexts.includes('PROFESSIONAL EXPERIENCE'))
    assert.ok(enTexts.includes('Environment: Azure, Spark, Kafka'))
    assert.ok(enTexts.includes('Languages: Anglais (courant) - Espagnol (intermédiaire)'))
    const footers = Object.keys(unzipSync(en)).filter(n => /^word\/footer\d*\.xml$/.test(n)).map(n => part(en, n)).join('')
    assert.match(footers, / of /)
    assert.doesNotMatch(footers, / sur /)
  })

  it('ne finit pas sur un espaceur (page blanche)', () => {
    const doc = new DOMParser().parseFromString(part(fr, 'word/document.xml') ?? '', 'text/xml')
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0]
    const children = Array.from(body.childNodes).filter(n => n.nodeType === 1) as Element[]
    const lastContent = children.at(-2) // le dernier enfant est sectPr
    assert.notEqual((lastContent?.textContent ?? '').trim(), '')
  })
})

describe('renderCv — tabulation dans le même run que le texte', () => {
  // Modèle Wise dont la tabulation avant le client est dans le run du client (comme les dates du modèle « version
  // courte » de Wise Associates) au lieu d'un run à part.
  const files = unzipSync(TEMPLATE)
  const xml = strFromU8(files['word/document.xml'])
  const merged = xml.replace(
    /<w:r><w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr><w:tab\/><\/w:r><w:r>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)(<w:t xml:space="preserve">\[Client\]<\/w:t>)<\/w:r>/,
    '<w:r>$1<w:tab/>$2</w:r>')
  const template = zipSync({ ...files, 'word/document.xml': strToU8(merged) })

  it('la garde devant le texte (dates ou client alignés à droite)', () => {
    assert.notEqual(merged, xml, 'run du client modifié')
    find(paragraphs(renderCv(template, MAP, DATA, 'fr')), 'Janv 2021 – Aujourd\'hui\tBanque Exemple')
  })

  it('ne la double pas quand le gabarit en écrit une', () => {
    const map = { ...MAP, fields: { ...MAP.fields, exp_header: ['{dates}', '\t{client}'] } }
    find(paragraphs(renderCv(template, map, DATA, 'fr')), 'Janv 2021 – Aujourd\'hui\tBanque Exemple')
  })
})

describe('fmt', () => {
  it('remplace les champs et n\'affiche [[ … ]] que si tous ses champs sont remplis', () => {
    assert.equal(fmt('{a}[[ · {b}]]', { a: 'X', b: 'Y' }), 'X · Y')
    assert.equal(fmt('{a}[[ · {b}]]', { a: 'X', b: '  ' }), 'X')
    assert.equal(fmt('{absent}!', {}), '!')
  })
})
