import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  InvalidAnswerError, TruncatedAnswerError, contentOf, countToComplete, cvFileKind, exportBaseName, exportNotes, fitToTemplate,
  initialsOf, parseExtraction, parseTranslation, splitFullName, structureGap, zipNameOf,
} from './cv-data'
import wiseMap from './templates/wise-associates/template_map.json'
import type { CvData, TemplateMap } from './types'

const ANSWER = {
  langue: 'fr',
  titre: 'Développeur Java',
  experience: '[À COMPLÉTER]',
  resume: ['Développeur Java.'],
  experiences: [{ dates: 'Janv 2020 – Aujourd\'hui', client: 'Client Exemple', role_lignes: ['Développeur'], contexte: '', realisations: ['API REST.', 'Tests.'], environnement: 'Java' }],
  formations: [{ annees: 2015, intitule: 'Master', etablissement: 'Université Exemple', details: [] }],
  certifications: [{ annee: '2021', intitule: 'OCP Java', organisme: 'Oracle' }],
  langues: [{ langue: 'Anglais', niveau: 'courant' }],
  competences: [{ categorie: 'Langages', contenu: 'Java, SQL' }],
  termes_identifiants: ['Prénom', 'Nom'],
  omis: ['Projets personnels'],
}

describe('parseExtraction', () => {
  it('lit le JSON même entouré de texte ou de balises markdown, et normalise les valeurs', () => {
    const parsed = parseExtraction(`Voici le dossier :\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)
    assert.equal(parsed.titre, 'Développeur Java')
    assert.equal(parsed.formations[0].annees, '2015')
    assert.deepEqual(parsed.termes_identifiants, ['Prénom', 'Nom'])
    assert.equal(parsed.langue, 'fr')
  })

  it('complète les champs manquants d\'un élément, sans couper les textes longs', () => {
    const long = 'Java, '.repeat(400)
    const parsed = parseExtraction(JSON.stringify({ ...ANSWER, langue: ' EN ', experiences: [{ client: 'Seul client' }], competences: [{ categorie: 'Langages', contenu: long }] }))
    assert.equal(parsed.langue, 'en')
    assert.deepEqual(parsed.experiences[0].realisations, [])
    assert.equal(parsed.experiences[0].dates, '')
    assert.equal(parsed.competences[0].contenu, long.trim())
  })

  it('refuse une rubrique d\'un autre type, une clé renommée ou une langue inconnue, en citant la rubrique', () => {
    const invalid = (answer: object, part: string) => assert.throws(() => parseExtraction(JSON.stringify(answer)),
      (err: Error) => err instanceof InvalidAnswerError && err.message.includes(`« ${part}`))
    invalid({ ...ANSWER, resume: 'Un seul paragraphe.' }, 'resume')
    invalid({ ...ANSWER, experiences: ['texte libre'] }, 'experiences.0')
    invalid({ ...ANSWER, competences: { Langages: 'Java' } }, 'competences')
    invalid({ ...ANSWER, langue: 'de' }, 'langue')
    const { experiences, ...renamed } = ANSWER
    invalid({ ...renamed, experiences_professionnelles: experiences }, 'experiences')
    assert.throws(() => parseExtraction(JSON.stringify({ ...ANSWER, termes_identifiants: [] })), /termes d'identité absents/)
  })

  it('retire les caractères invisibles et de contrôle (fuite cachée, .docx illisible)', () => {
    const parsed = parseExtraction(JSON.stringify({ ...ANSWER, titre: 'Déve\u200Bloppeur\u0002 Java\u2060' }))
    assert.equal(parsed.titre, 'Développeur Java')
  })

  it('distingue une réponse tronquée d\'une réponse invalide, sans citer la réponse dans le message', () => {
    assert.throws(() => parseExtraction(JSON.stringify(ANSWER).slice(0, 200)), TruncatedAnswerError)
    assert.throws(() => parseExtraction('{"titre": "Jean Exemple", oups}'), (err: Error) =>
      !(err instanceof TruncatedAnswerError) && err.message === 'Réponse IA invalide : JSON illisible')
    assert.throws(() => parseExtraction(JSON.stringify({ ...ANSWER, titre: '' })), /intitulé du CV absent/)
  })
})

describe('parseTranslation', () => {
  const source = contentOf(parseExtraction(JSON.stringify(ANSWER)))

  it('accepte une traduction de même structure', () => {
    const translated = parseTranslation(JSON.stringify({ ...source, titre: 'Java Developer' }), source)
    assert.equal(translated.titre, 'Java Developer')
  })

  it('refuse une traduction qui perd une puce, une expérience ou vide un champ, en citant le champ', () => {
    const fewerBullets = { ...source, experiences: [{ ...source.experiences[0], realisations: ['REST API.'] }] }
    assert.throws(() => parseTranslation(JSON.stringify(fewerBullets), source), /Traduction incomplète : « experiences\.0\.realisations »/)
    assert.throws(() => parseTranslation(JSON.stringify({ ...source, experiences: [] }), source), /Traduction incomplète/)
    const emptied = { ...source, titre: 'Java Developer', experiences: [{ ...source.experiences[0], client: '' }] }
    assert.throws(() => parseTranslation(JSON.stringify(emptied), source), /« experiences\.0\.client »/)
  })

  it('refuse une « traduction » identique à l\'original', () => {
    assert.throws(() => parseTranslation(JSON.stringify(source), source), /Traduction absente/)
  })

  it('structureGap : champ vide de l\'original libre, liste de longueur différente signalée', () => {
    assert.equal(structureGap({ a: '', b: ['x'] }, { a: '', b: ['y'] }), null)
    assert.equal(structureGap({ b: ['x', 'y'] }, { b: ['x'] }), 'b')
    assert.equal(structureGap({ c: { d: 'x' } }, { c: { d: ' ' } }), null)
    assert.equal(structureGap({ c: { d: 'x' } }, { c: {} }), 'c.d')
  })
})

describe('règles de l\'export', () => {
  it('initiales du candidat, champ à compléter sans nom', () => {
    assert.equal(initialsOf('Camille', 'Fontaine', 'fr'), 'C.F.')
    assert.equal(initialsOf('Jean-Marc', 'de la Tour', 'fr'), 'J.M.D.L.T.')
    assert.equal(initialsOf('', '', 'en'), '[TO BE COMPLETED]')
  })

  it('ajoute les certifications à la formation quand le template n\'a pas de rubrique dédiée', () => {
    const data: CvData = { ...contentOf(parseExtraction(JSON.stringify(ANSWER))), identifiant: 'C.F.' }
    const wise = fitToTemplate(data, wiseMap as TemplateMap)
    assert.equal(wise.certificationsMerged, true)
    assert.deepEqual(wise.data.formations.at(-1), { annees: '2021', intitule: 'OCP Java', etablissement: 'Oracle', details: [] })
    assert.equal(wise.data.certifications.length, 0)
    const withSection = fitToTemplate(data, { ...(wiseMap as TemplateMap), sections: ['education', 'certifications'] })
    assert.equal(withSection.certificationsMerged, false)
    assert.equal(withSection.data, data)
  })

  it('compte les champs à compléter et rédige le compte rendu', () => {
    const data: CvData = { ...contentOf(parseExtraction(JSON.stringify(ANSWER))), identifiant: 'C.F.' }
    assert.equal(countToComplete(data), 1)
    // Une traduction anglaise qui a laissé le marqueur français compte aussi.
    assert.equal(countToComplete({ ...data, titre: '[TO BE COMPLETED]', experience: '[À COMPLÉTER]' }), 2)
    assert.deepEqual(exportNotes({ toComplete: 1, omitted: ['Projets personnels'], certificationsMerged: true, cvTruncated: true }), [
      'CV très long : seul son début a été lu, les expériences les plus anciennes peuvent manquer. Comparez avec le CV d\'origine.',
      '1 champ « [À COMPLÉTER] » : information absente du CV, à saisir dans Word.',
      'Certifications ajoutées à la rubrique Formation (le modèle n\'a pas de rubrique dédiée).',
      'Non repris faute de rubrique dans le modèle : Projets personnels.',
    ])
    assert.deepEqual(exportNotes({ toComplete: 0, omitted: [], certificationsMerged: false, cvTruncated: false }), [])
  })

  it('nom de fichier ASCII sans espace ni champ à compléter', () => {
    assert.equal(exportBaseName('Wise Associates', 'C.F.', 'Architecte Data & Cloud / Azure'), 'CV_Wise-Associates_C-F_Architecte-Data-Cloud-Azure')
    assert.equal(exportBaseName('Wise Associates', '[À COMPLÉTER]', 'Développeur'), 'CV_Wise-Associates_candidat_Developpeur')
  })

  it('nomme le .zip des deux langues d\'après le nom de base', () => {
    assert.equal(zipNameOf('CV_Wise-Associates_C-F_Architecte-Data_FR.docx'), 'CV_Wise-Associates_C-F_Architecte-Data.zip')
    assert.equal(zipNameOf('CV_Wise-Associates_C-F_Architecte-Data_EN.docx'), 'CV_Wise-Associates_C-F_Architecte-Data.zip')
    assert.equal(zipNameOf('autre.docx'), 'autre.zip')
  })

  it('reconnaît le format du CV à ses premiers octets', () => {
    assert.equal(cvFileKind(new TextEncoder().encode('%PDF-1.7')), 'pdf')
    assert.equal(cvFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), 'docx')
    assert.equal(cvFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), 'doc')
    assert.equal(cvFileKind(new TextEncoder().encode('<html>')), null)
  })
})

describe('splitFullName', () => {
  it('dernier mot pour nom, le reste pour prénom : chacun est cherché seul par le contrôle des fuites', () => {
    assert.deepEqual(splitFullName('Marie Exemple'), { firstName: 'Marie', lastName: 'Exemple' })
    assert.deepEqual(splitFullName('  Jean Pierre   Exemple '), { firstName: 'Jean Pierre', lastName: 'Exemple' })
  })

  it('un seul mot, ou aucun : prénom seul, initiales à compléter sans nom', () => {
    assert.deepEqual(splitFullName('Exemple'), { firstName: 'Exemple', lastName: '' })
    assert.deepEqual(splitFullName('   '), { firstName: '', lastName: '' })
    assert.equal(initialsOf(splitFullName('').firstName, splitFullName('').lastName, 'fr'), initialsOf('', '', 'fr'))
  })
})
