import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildClientSheet, initialsOf, namesLeft, scrubIdentity, sheetInitials, SHEET_LIMITS } from './client-sheet'
import { judgementSummary, type MatchJudgements } from './match-scoring'

// Candidats fictifs.
const marie = [{ first: 'Marie', last: 'Durand' }]
const scrub = (text: string, first: string, last: string) => scrubIdentity(text, [{ first, last }])

describe('identité du candidat sur la fiche client', () => {
  it('ne garde que les initiales, d\'un nom qui n\'est pas une valeur de remplacement', () => {
    assert.equal(initialsOf('Marie-Hélène', 'Durand'), 'M. D.')
    assert.equal(initialsOf(' élodie ', ''), 'É.')
    assert.equal(initialsOf('', ''), 'Candidat')
    assert.equal(sheetInitials([{ first: 'CV', last: 'Marie Durand 2024' }, { first: 'Marie', last: 'Durand' }]), 'M. D.')
    assert.equal(sheetInitials([{ first: 'Profil', last: 'sans nom' }, { first: '', last: '' }]), 'Candidat')
  })

  it('remplace le nom par les initiales et retire e-mail, téléphone et liens', () => {
    const out = scrubIdentity(
      'Marie Durand (marie.durand@exemple.fr, 06 12 34 56 78, +33 6 12 34 56 78) : DURAND MARIE a convaincu. Marie reste disponible, voir https://www.linkedin.com/in/marie-durand-123 et linkedin.com/in/md.',
      marie,
    )
    assert.equal(out, 'M. D. : M. D. a convaincu. M. D. reste disponible, voir et')
  })

  it('reconnaît les noms sans accents, en capitales, composés ou à particule', () => {
    assert.equal(scrub('HELENE LEFEVRE est prête, Mme Lefevre aussi.', 'Hélène', 'Lefèvre'), 'H. L. est prête, Mme H. L. aussi.')
    assert.equal(scrub('M. de La Tour a convaincu ; La Tour confirme.', 'Anne', 'de La Tour'), 'M. A. D. a convaincu ; A. D. confirme.')
    assert.equal(scrub('M. d’Artagnan est mobile.', 'Charles', 'd\'Artagnan'), 'M. C. D. est mobile.')
    assert.equal(scrub('Jean Pierre Martin, puis Jean-Pierre.', 'Jean-Pierre', 'Martin'), 'J. M., puis J. M..')
    assert.equal(scrub('Mme Lefèvre et Mme Durand.', 'Marie', 'Durand-Lefèvre'), 'Mme M. D. et Mme M. D..')
    assert.equal(scrub('Zoé Durand arrive.', 'Zoé'.normalize('NFD'), 'Durand'), 'Z. D. arrive.')
  })

  it('retire aussi le nom écrit sur le CV, et ignore les valeurs de remplacement des profils de chasseur', () => {
    const names = [{ first: 'Profil', last: 'sans nom' }, { first: 'Marie', last: 'Durand' }]
    assert.equal(scrubIdentity('Profil solide : Marie Durand, voir mariedurand.dev ou github: marie-durand.', names), 'Profil solide : M. D., voir ou github:')
    assert.equal(scrubIdentity('Mme Durand, 10 ans.', [{ first: 'CV', last: 'Marie Durand 2024' }]), 'Mme M. D., 10 ans.')
  })

  it('retire les numéros et adresses quel que soit leur format, sans toucher aux périodes', () => {
    assert.equal(scrubIdentity('Appeler le +1 (415) 555-0123 ou le 06  12 34 56 78 ; marie.d [at] gmail.com.', marie), 'Appeler le ou le ; .')
    assert.equal(scrubIdentity('Habite 12 rue des Lilas, 69003 Lyon, née le 3 mars 1985.', marie), 'Habite , 69003 Lyon, .')
    assert.equal(scrubIdentity('Postes 2015-2018-2021, de 2019 - 2022, 45 000 € par an.', marie), 'Postes 2015-2018-2021, de 2019 - 2022, 45 000 € par an.')
  })

  it('garde les mots courants et les noms d\'entreprise', () => {
    assert.equal(scrub('Chez Société Générale de 2019 - 2022, puis 2022-2024, un petit projet.', 'Paul', 'Petit'),
      'Chez Société Générale de 2019 - 2022, puis 2022-2024, un petit projet.')
    // Nom de deux lettres : seul le nom complet est remplacé, pas l'article « le ».
    assert.equal(scrub('Le candidat, Anh Le, le confirme.', 'Anh', 'Le'), 'Le candidat, A. L., le confirme.')
  })

  it('signale un nom resté en minuscules', () => {
    assert.deepEqual(namesLeft('un petit projet', [{ first: 'Paul', last: 'Petit' }]), ['Petit'])
    assert.deepEqual(namesLeft('M. D. a convaincu', marie), [])
  })
})

describe('fiche candidat proposée au client', () => {
  const profile = {
    skills: ['Java', 'Spring', 'Java', 'Kafka', ...Array.from({ length: 20 }, (_, i) => `Outil ${i}`)],
    experienceSummary: 'Marie Durand, 8 ans de développement Java dans la banque.',
    experiences: [
      { title: 'Lead développeuse Java', company: 'Banque fictive', period: '2021 - 2024', missions: ['Mission détaillée'] },
      { title: '', company: '', period: '2019' },
      { title: 'Développeuse', company: 'ESN fictive', period: '2016 - 2021', missions: [] },
    ],
    education: [{ degree: 'Master informatique', school: 'Université fictive', year: '2016' }],
    languages: [{ name: 'Anglais', level: 'courant' }, { name: 'Espagnol', level: '' }],
    yearsOfExperience: 8,
  }
  const judged: MatchJudgements = {
    scale: 'matching', roles: [{ title: 'Développeur Java', fit: 'oui' }], requirements: ['oui'], requirementsListed: true,
    skills: ['oui', 'partiel'], skillsListed: true, fits: { projet: 'oui', client: 'oui', localisation: 'oui', niveau: 'oui', formation: 'oui', domaine: 'oui', langue: 'oui', tjm: 'oui' },
  }

  it('reprend le profil du CV analysé, sans identité', () => {
    const sheet = buildClientSheet({
      appId: 'app1', firstName: 'Marie', lastName: 'Durand', city: 'Lyon', cvProfileJson: JSON.stringify(profile), score: 82,
      aiSummary: `${judgementSummary(judged)} — Marie Durand correspond bien au poste.`,
      steps: [{ id: 's1', label: 'Entretien IA', report: 'Marie très claire, joignable au 06 12 34 56 78.' }],
    })
    assert.equal(sheet.initials, 'M. D.')
    assert.equal(sheet.headline, 'Lead développeuse Java')
    assert.equal(sheet.years, 8)
    assert.equal(sheet.city, 'Lyon')
    assert.deepEqual(sheet.languages, ['Anglais (courant)', 'Espagnol'])
    assert.equal(sheet.skills.length, SHEET_LIMITS.skills)
    assert.deepEqual(sheet.skills.slice(0, 3), ['Java', 'Spring', 'Kafka'])
    assert.equal(sheet.summary, 'M. D., 8 ans de développement Java dans la banque.')
    assert.deepEqual(sheet.experiences.map(e => e.company), ['Banque fictive', 'ESN fictive'])
    assert.deepEqual(sheet.education, [{ degree: 'Master informatique', school: 'Université fictive', year: '2016' }])
    assert.equal(sheet.fit?.score, 82)
    assert.ok(sheet.fit && sheet.fit.parts.length > 0 && sheet.fit.parts.every(p => p.percent >= 0 && p.percent <= 100))
    assert.equal(sheet.fit?.opinion, 'M. D. correspond bien au poste.')
    assert.equal(sheet.steps[0].report, 'M. D. très claire, joignable au .')
    assert.ok(!JSON.stringify(sheet).includes('Durand'))
    assert.deepEqual(sheet.warnings, [])
  })

  it('nettoie aussi les champs saisis par un chasseur et le nom lu sur le CV', () => {
    const sheet = buildClientSheet({
      appId: 'app3', firstName: 'Profil', lastName: 'sans nom',
      cvProfileJson: JSON.stringify({ candidateName: 'Marie Durand', skills: ['marie.durand@gmail.com', 'SQL'], languages: [{ name: 'Anglais', level: 'voir linkedin.com/in/marie-durand' }], experienceSummary: 'Marie Durand, analyste ; durand reste joignable.' }),
      steps: [{ id: 's1', label: 'Entretien avec Marie Durand', report: 'RAS.' }],
    })
    assert.equal(sheet.initials, 'M. D.')
    assert.deepEqual(sheet.skills, ['SQL'])
    assert.deepEqual(sheet.languages, ['Anglais (voir)'])
    assert.equal(sheet.steps[0].label, 'Entretien avec M. D.')
    assert.deepEqual(sheet.warnings, ['Profil'])
  })

  it('reste lisible sans CV analysé ni score', () => {
    for (const cvProfileJson of [undefined, '', '{abîmé', JSON.stringify({ skills: 'Java', experiences: [null], yearsOfExperience: 'huit' })]) {
      const sheet = buildClientSheet({ appId: 'app2', firstName: 'Paul', lastName: 'Martin', cvProfileJson, steps: [] })
      assert.equal(sheet.initials, 'P. M.')
      assert.deepEqual([sheet.skills, sheet.experiences, sheet.years, sheet.fit], [[], [], null, null], String(cvProfileJson))
    }
  })
})
