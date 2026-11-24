import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIFICATION_SYSTEM, CLASSIFICATION_VERSION, parseClassification, type CvClassification } from '../cv-classification'
import { answerFromClassification, assignSplits, chatExample, csvCell, isInsideDir, maskClassification, maskLeftoverContacts, maskPersonName, textKey } from './cv-classification-dataset'

const classification: CvClassification = {
  version: CLASSIFICATION_VERSION,
  roles: ['Chef de projet', 'PMO'],
  jobFamily: 'pilotage_projet',
  yearsOfExperience: 12,
  seniority: 'senior',
  skills: ['SAFe', 'Jira', 'Power BI'],
  sectors: ['banque', 'assurance'],
  clients: ['Banque Exemple'],
  languages: [{ name: 'Anglais', level: 'courant' }],
  city: 'Lyon',
  country: 'France',
  dailyRate: 650,
  availability: 'Immédiate',
  educationLevel: 'bac+5',
  certifications: ['PMP'],
  summary: 'Chef de projet en banque depuis douze ans. Pilote des programmes réglementaires. Certifié PMP.',
}

describe('réponse attendue du modèle (cible de l\'entraînement)', () => {
  it('relue par parseClassification, elle redonne exactement la classification enregistrée', () => {
    const answer = JSON.stringify(answerFromClassification(classification))
    assert.deepEqual(parseClassification(answer), classification)
  })

  it('porte les clés françaises des consignes, ni version ni séniorité (calculées par le code)', () => {
    const answer = answerFromClassification(classification)
    assert.deepEqual(Object.keys(answer), ['roles', 'famille', 'annees_experience', 'competences', 'secteurs', 'clients', 'langues',
      'ville', 'pays', 'tjm', 'disponibilite', 'niveau_etudes', 'certifications', 'resume'])
    assert.deepEqual(answer.langues, [{ langue: 'Anglais', niveau: 'courant' }])
  })
})

describe('masquage du nom du candidat', () => {
  it('prénom et nom remplacés partout, sans casse ni accents, en mots entiers', () => {
    const text = 'Zineb-Amina EL MANSOURI\nContact : zineb.el.mansouri (masqué)\nMme Mansouri a travaillé chez Mansourisoft.'
    assert.equal(
      maskPersonName(text, ['Zineb-Amina', 'El Mansouri']),
      '[NOM]-[NOM] [NOM] [NOM]\nContact : [NOM].[NOM].[NOM] (masqué)\nMme [NOM] a travaillé chez [NOM]soft.',
    )
    assert.equal(maskPersonName('Élodie DUPRÉ, consultante', ['elodie', 'dupre']), '[NOM] [NOM], consultante')
  })

  it('ne masque pas les particules seules (de, la, van…) ni une lettre isolée', () => {
    assert.equal(maskPersonName('Chef de projet à la Défense', ['Jean de La Fontaine', 'J']), 'Chef de projet à la Défense')
  })

  it('accents décomposés par la lecture du PDF : nom masqué sans accent orphelin', () => {
    assert.equal(maskPersonName('E\u0301lodie DUPRE\u0301 consultante', ['Élodie', 'Dupré']), '[NOM] [NOM] consultante')
  })

  it('en-tête aux lettres espacées et nom collé au prénom', () => {
    assert.equal(maskPersonName('É L O D I E   D U P R É\nConsultante', ['Élodie', 'Dupré']), '[NOM]   [NOM]\nConsultante')
    assert.equal(maskPersonName('ElodieDupré, consultante', ['Élodie', 'Dupré']), '[NOM][NOM], consultante')
  })

  it('partie du nom de 4 lettres ou plus dans un mot plus long : masquée (Mansourisoft)', () => {
    assert.equal(maskPersonName('chez Mansourisoft', ['El Mansouri']), 'chez [NOM]soft')
  })

  it('sans nom connu : texte inchangé', () => {
    assert.equal(maskPersonName('Texte du CV', ['', '  ']), 'Texte du CV')
  })
})

describe('coordonnées restées après le masquage de MBC', () => {
  it('téléphones aux formats manqués : indicatif entre parenthèses, chiffres collés, collé à un mot', () => {
    assert.equal(maskLeftoverContacts('Mobile (33) 6 12 34 56 78 ✉'), 'Mobile [TÉLÉPHONE] ✉')
    assert.equal(maskLeftoverContacts('. Contact  33612345678 ✉'), '. Contact  [TÉLÉPHONE] ✉')
    assert.equal(maskLeftoverContacts('Tél06 12 34 56 78 fin'), 'Tél[TÉLÉPHONE] fin')
  })

  it('e-mails, date de naissance et adresse ; la ville reste (elle sert au matching)', () => {
    assert.equal(maskLeftoverContacts('Contact [NOM].d@gmail.com'), 'Contact [EMAIL]')
    assert.equal(maskLeftoverContacts('Née le 12/03/1985 à Lyon'), 'Née le [DATE DE NAISSANCE] à Lyon')
    assert.equal(maskLeftoverContacts('Date de naissance : 3 mars 1985'), 'Date de naissance : [DATE DE NAISSANCE]')
    assert.equal(maskLeftoverContacts('12 rue de la Paix, 75002 Paris'), '[ADRESSE], 75002 Paris')
    assert.equal(maskLeftoverContacts('8 bis avenue Foch, Lyon'), '[ADRESSE], Lyon')
  })

  it('liens (LinkedIn, sites) remplacés en entier', () => {
    assert.equal(maskLeftoverContacts('Profil : https://www.linkedin.com/in/[NOM]-1a2b3c/ ok'), 'Profil : [LIEN] ok')
    assert.equal(maskLeftoverContacts('linkedin.com/in/[NOM]-dupont-987'), '[LIEN]')
    assert.equal(maskLeftoverContacts('voir www.exemple.fr'), 'voir [LIEN]')
  })

  it('garde les années, montants et durées : ils servent à la classification', () => {
    const text = 'Expériences 2015 2016 2017 2018 · 2019 - 2021 · 01 2019 - 12 2020 · 03.2018 - 06.2023 · TJM 650 € · 12 ans · 1 200 000 € de budget'
    assert.equal(maskLeftoverContacts(text), text)
  })
})

describe('réponse attendue masquée elle aussi', () => {
  it('nom retiré des employeurs, métiers, certifications et du résumé ; famille, ville et chiffres gardés', () => {
    const masked = maskClassification({ ...classification, clients: ['Dupré Conseil SASU', 'Banque Exemple'], summary: 'Élodie Dupré pilote des projets.' }, ['Élodie', 'Dupré'])
    assert.deepEqual(masked.clients, ['[NOM] Conseil SASU', 'Banque Exemple'])
    assert.equal(masked.summary, '[NOM] [NOM] pilote des projets.')
    assert.deepEqual([masked.jobFamily, masked.city, masked.yearsOfExperience], ['pilotage_projet', 'Lyon', 12])
  })
})

describe('fichier de relecture (CSV)', () => {
  it('neutralise une formule de tableur venue d\'un CV', () => {
    assert.equal(csvCell('=HYPERLINK("https://x.example")'), `"'=HYPERLINK(""https://x.example"")"`)
    assert.equal(csvCell('-cmd'), `"'-cmd"`)
    assert.equal(csvCell('Power BI'), '"Power BI"')
  })
})

describe('dossier de sortie hors du dépôt', () => {
  it('dedans, dessous ou identique : refusé ; à côté ou ailleurs : accepté', () => {
    assert.equal(isInsideDir('/depot', '/depot'), true)
    assert.equal(isInsideDir('/depot', '/depot/donnees'), true)
    assert.equal(isInsideDir('/depot', '/depot/..donnees'), true)
    assert.equal(isInsideDir('/depot', '/depot-copie'), false)
    assert.equal(isInsideDir('/depot', '/tmp/exemples'), false)
  })
})

describe('exemple d\'entraînement', () => {
  it('trois messages : consignes de MBC, texte du CV, réponse JSON', () => {
    const example = chatExample('texte du CV', classification)
    assert.equal(example.messages[0].content, CLASSIFICATION_SYSTEM)
    assert.equal(example.messages[1].content, 'texte du CV')
    assert.deepEqual(JSON.parse(example.messages[2].content), answerFromClassification(classification))
  })
})

describe('répartition entraînement / contrôle / test', () => {
  const rows = (family: string, n: number) => Array.from({ length: n }, (_, i) => ({ key: `${family}-${i}`, family }))

  it('par famille, 80 / 10 / 10, chaque famille de 10 exemples ou plus présente dans le test', () => {
    const splits = assignSplits([...rows('data_ia', 50), ...rows('rh', 10)])
    const count = (family: string, split: string) => [...splits].filter(([k, s]) => k.startsWith(family) && s === split).length
    assert.deepEqual([count('data_ia', 'train'), count('data_ia', 'validation'), count('data_ia', 'test')], [40, 5, 5])
    assert.deepEqual([count('rh', 'train'), count('rh', 'validation'), count('rh', 'test')], [8, 1, 1])
  })

  it('famille de moins de 3 exemples : tout à l\'entraînement', () => {
    const splits = assignSplits(rows('design_ux', 2))
    assert.deepEqual([...splits.values()], ['train', 'train'])
  })

  it('déterministe : même répartition à chaque export, quel que soit l\'ordre de lecture', () => {
    const all = [...rows('data_ia', 30), ...rows('developpement', 20)]
    assert.deepEqual(new Map([...assignSplits(all)].sort()), new Map([...assignSplits([...all].reverse())].sort()))
  })
})

describe('doublons', () => {
  it('même CV dans DEV et en production : même clé de texte, espaces et casse ignorés', () => {
    assert.equal(textKey('Chef de projet\n  SAFe'), textKey('chef de projet safe'))
    assert.notEqual(textKey('Chef de projet'), textKey('Développeur'))
  })
})
