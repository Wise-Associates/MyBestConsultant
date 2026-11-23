import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_FILTERS, EXPERIENCE_MAX, RADIUS_MAX, activeFilterCount, filterCandidates, filtersFromSearchParams, filtersSummary, hasPhrase, hasSearchCriteria,
  equivalentSkillKeys, equivalentSkillNames, jobFamilyCounts, matchesQuery, parseQuery, rankBySkillUse, sanitizeFilters, skillCorrespondences, skillKey, skillMatcher, valuesByFrequency, withFilters, words,
  type CvthequeFilters, type SearchableCandidate,
} from './cvtheque-search'

// Profils fictifs.
const base: SearchableCandidate = {
  name: 'Camille Durand', city: 'Lyon', mobilityRadiusKm: 30, skills: ['Java', 'Spring Boot'], experienceSummary: 'Développeuse back-end',
  experiences: [{ title: 'Développeuse Java', company: 'Exemple Banque', missions: ['API de paiement'] }],
  education: [{ degree: 'Master informatique', school: 'Université de Lyon' }], languages: [{ name: 'Anglais' }],
  yearsOfExperience: 6, openToWork: true, desiredSector: ['Banque'], desiredRoles: ['Lead Developer'], createdAt: '2026-11-10T09:00:00.000Z',
  jobFamily: 'developpement',
}
const other: SearchableCandidate = {
  ...base, name: 'Hugo Martin', city: 'Paris', mobilityRadiusKm: 150, skills: ['React', 'TypeScript'], experienceSummary: 'Front-end',
  experiences: [{ title: 'Développeur React Native', company: 'Studio Test', missions: ['Application mobile'] }],
  education: [{ degree: 'BTS SIO', school: 'Lycée Démo' }], languages: [{ name: 'Espagnol' }], yearsOfExperience: null,
  openToWork: false, desiredSector: ['Assurance'], desiredRoles: ['Développeur mobile'], createdAt: '2026-09-01T09:00:00.000Z',
}
const now = new Date('2026-11-13T12:00:00.000Z')
const names = (f: Partial<typeof EMPTY_FILTERS>) => filterCandidates([base, other], { ...EMPTY_FILTERS, ...f }, now).map(c => c.name)

describe('CV Thèque : lecture de la recherche', () => {
  it('lit les termes, les expressions entre guillemets et les opérateurs en majuscules', () => {
    assert.deepEqual(parseQuery('java AND "react native"'), [['java', 'react native']])
    assert.deepEqual(parseQuery('Kotlin OR Java Spring'), [['kotlin'], ['java', 'spring']])
    assert.deepEqual(parseQuery('Développeur OU Développeuse'), [['developpeur'], ['developpeuse']])
  })

  it('garde « ou » et « et » en minuscules comme des mots, et ignore les opérateurs sans terme', () => {
    assert.deepEqual(parseQuery('chef de projet ou PMO'), [['chef', 'de', 'projet', 'ou', 'pmo']])
    assert.deepEqual(parseQuery('OR java OR'), [['java']])
    assert.deepEqual(parseQuery('  '), [])
  })

  it('compare sans tenir compte des accents ni de la casse', () => {
    assert.equal(matchesQuery('Développeuse Back-End', parseQuery('developpeuse BACK-END')), true)
    assert.equal(matchesQuery('Java', parseQuery('python OR rust')), false)
  })
})

describe('CV Thèque : filtres', () => {
  it('sans filtre, garde tous les profils', () => {
    assert.deepEqual(names({}), ['Camille Durand', 'Hugo Martin'])
  })

  it('cherche dans tout le profil, lieu étendu à sa région', () => {
    assert.deepEqual(names({ query: 'paiement' }), ['Camille Durand'])
    assert.deepEqual(names({ query: '"react native" OR spring' }), ['Camille Durand', 'Hugo Martin'])
    assert.deepEqual(names({ query: 'Auvergne-Rhône-Alpes' }), ['Camille Durand'])
  })

  it('écarte les profils qui contiennent un mot exclu', () => {
    assert.deepEqual(names({ exclude: 'mobile "front-end"' }), ['Camille Durand'])
  })

  it('filtre la disponibilité et la date d\'ajout', () => {
    assert.deepEqual(names({ availableOnly: true }), ['Camille Durand'])
    assert.deepEqual(names({ addedWithinDays: 7 }), ['Camille Durand'])
    assert.deepEqual(names({ addedWithinDays: 30 }), ['Camille Durand'])
  })

  it('garde un profil sans années d\'expérience connues, et ouvre la borne haute du curseur', () => {
    assert.deepEqual(names({ experience: [8, EXPERIENCE_MAX] }), ['Hugo Martin'])
    assert.deepEqual(names({ experience: [2, 5] }), ['Hugo Martin'])
  })

  it('compte un rayon au-delà du maximum du curseur dans « 100 km et plus »', () => {
    assert.deepEqual(names({}), ['Camille Durand', 'Hugo Martin'])
    assert.deepEqual(names({ radius: [50, RADIUS_MAX] }), ['Hugo Martin'])
    assert.deepEqual(names({ radius: [0, 50] }), ['Camille Durand'])
  })

  it('filtre le lieu, et écarte un profil sans ville quand un lieu est demandé', () => {
    assert.deepEqual(names({ location: 'Île-de-France' }), ['Hugo Martin'])
    assert.deepEqual(filterCandidates([{ ...base, city: '' }], { ...EMPTY_FILTERS, location: 'Lyon' }, now), [])
  })

  it('exige toutes les compétences et langues choisies, et l\'un des secteurs', () => {
    assert.deepEqual(names({ skills: ['java', 'spring'] }), ['Camille Durand'])
    assert.deepEqual(names({ skills: ['java', 'react'] }), [])
    assert.deepEqual(names({ languages: ['espagnol'] }), ['Hugo Martin'])
    assert.deepEqual(names({ sectors: ['banque', 'Assurance'] }), ['Camille Durand', 'Hugo Martin'])
  })

  it('filtre l\'entreprise, la formation, les intitulés et les expériences', () => {
    assert.deepEqual(names({ company: 'studio' }), ['Hugo Martin'])
    assert.deepEqual(names({ school: 'master' }), ['Camille Durand'])
    assert.deepEqual(names({ titleQuery: 'lead OR mobile' }), ['Camille Durand', 'Hugo Martin'])
    assert.deepEqual(names({ titleQuery: '"react native"' }), ['Hugo Martin'])
    assert.deepEqual(names({ experienceQuery: 'paiement' }), ['Camille Durand'])
  })
})

describe('CV Thèque : compteur et propositions', () => {
  it('compte les filtres réglés, hors barre de recherche', () => {
    assert.equal(activeFilterCount(EMPTY_FILTERS), 0)
    assert.equal(activeFilterCount({ ...EMPTY_FILTERS, query: 'java', availableOnly: true, skills: ['Java'], radius: [0, 50] }), 3)
  })

  it('propose les valeurs les plus fréquentes d\'abord, une fois par profil', () => {
    assert.deepEqual(valuesByFrequency([['Java', 'java', 'SQL'], ['React', 'Java'], ['React']]), ['Java', 'React', 'SQL'])
  })
})

describe('CV Thèque : mots entiers (demande du PO, 2026-11-18)', () => {
  it('découpe en mots, ponctuation comme séparateur, C++ et C# gardés', () => {
    assert.deepEqual(words('Node.js, C++ / C#'), ['node', 'js', 'c++', 'c#'])
    assert.deepEqual(words('Développeur Back-End'), ['developpeur', 'back', 'end'])
  })

  it('cherche une suite de mots, jamais un morceau de mot', () => {
    assert.equal(hasPhrase(words('Développeur React Native'), 'react native'), true)
    assert.equal(hasPhrase(words('JavaScript'), 'java'), false)
    assert.equal(hasPhrase(words('Node.js'), 'node'), true)
    assert.equal(hasPhrase(words('C++'), 'c'), false)
    assert.equal(matchesQuery('JavaScript et TypeScript', parseQuery('java')), false)
  })

  it('ignore un terme sans lettre ni chiffre, qui répondrait à tous les profils', () => {
    assert.deepEqual(parseQuery('stagiaire / alternant'), [['stagiaire', 'alternant']])
    assert.deepEqual(names({ exclude: 'stagiaire / alternant' }), ['Camille Durand', 'Hugo Martin'])
    assert.deepEqual(names({ company: '&' }), ['Camille Durand', 'Hugo Martin'])
    assert.deepEqual(names({ school: '.' }), ['Camille Durand', 'Hugo Martin'])
  })

  it('distingue C, C++ et C#, et ne confond pas un mot avec son pluriel', () => {
    assert.equal(hasPhrase(words('C#, .NET'), 'c#'), true)
    assert.equal(hasPhrase(words('C++'), 'c#'), false)
    assert.equal(hasPhrase(words('Développeurs Java'), 'développeur'), false)
  })

  it('« Java » ne retient plus un profil JavaScript', () => {
    const js: SearchableCandidate = { ...base, name: 'Profil JS', skills: ['JavaScript'], experiences: [], experienceSummary: '', desiredRoles: [] }
    assert.deepEqual(filterCandidates([base, js], { ...EMPTY_FILTERS, skills: ['Java'] }, now).map(c => c.name), ['Camille Durand'])
    assert.deepEqual(filterCandidates([base, js], { ...EMPTY_FILTERS, query: 'java' }, now).map(c => c.name), ['Camille Durand'])
  })
})

describe('CV Thèque : filtres dans l\'adresse et recherches enregistrées', () => {
  const full: CvthequeFilters = {
    query: 'revit OR archicad', exclude: 'stage', availableOnly: true, addedWithinDays: 30, experience: [5, EXPERIENCE_MAX], radius: [0, 50],
    location: 'Madagascar', skills: ['Revit', 'Architecture'], sectors: ['BTP'], languages: ['Anglais'], company: 'Exemple', school: 'Master',
    titleQuery: 'modeleur BIM', experienceQuery: 'maquette', jobFamilies: ['developpement', 'architecture'],
  }

  it('relit dans l\'adresse exactement les filtres écrits', () => {
    assert.deepEqual(filtersFromSearchParams(withFilters(new URLSearchParams(), full)), full)
    assert.equal(withFilters(new URLSearchParams(), EMPTY_FILTERS).toString(), '')
  })

  it('garde les autres paramètres de l\'adresse', () => {
    assert.equal(withFilters(new URLSearchParams('recherche=abc&q=old'), { ...EMPTY_FILTERS, query: 'java' }).toString(), 'recherche=abc&q=java')
  })

  it('borne une valeur non fiable et ignore ce qu\'il ne connaît pas', () => {
    const f = sanitizeFilters({
      query: 'x'.repeat(1000), skills: ['Java', 'java', 42, ...Array.from({ length: 40 }, (_, i) => `S${i}`)], experience: [12, 3],
      radius: [-5, 999], addedWithinDays: 12, availableOnly: 'oui', hack: true,
    })
    assert.equal(f.query.length, 300)
    assert.equal(f.skills.length, 20)
    assert.deepEqual(f.skills.slice(0, 2), ['Java', 'S0'])
    assert.deepEqual(f.experience, [3, 12])
    assert.deepEqual(f.radius, [0, RADIUS_MAX])
    assert.equal(f.addedWithinDays, 0)
    assert.equal(f.availableOnly, false)
    assert.deepEqual(sanitizeFilters(null), EMPTY_FILTERS)
    assert.deepEqual(filtersFromSearchParams(new URLSearchParams('exp=abc&ajout=7')), { ...EMPTY_FILTERS, addedWithinDays: 7 })
  })

  it('refuse d\'enregistrer une recherche qui retiendrait tout le monde', () => {
    assert.equal(hasSearchCriteria(EMPTY_FILTERS), false)
    assert.equal(hasSearchCriteria({ ...EMPTY_FILTERS, availableOnly: true, addedWithinDays: 7, exclude: 'stage', query: ' ' }), false)
    assert.equal(hasSearchCriteria({ ...EMPTY_FILTERS, skills: ['Revit'] }), true)
    assert.equal(hasSearchCriteria({ ...EMPTY_FILTERS, experience: [5, EXPERIENCE_MAX] }), true)
  })

  it('résume les critères en lignes lisibles', () => {
    assert.deepEqual(filtersSummary({ ...EMPTY_FILTERS, skills: ['Revit', 'Architecture'], experience: [5, EXPERIENCE_MAX], location: 'Madagascar', languages: ['Anglais'] }), [
      'Compétences : Revit, Architecture', 'Expérience : 5 ans et plus', 'Lieu : Madagascar', 'Langues : Anglais',
    ])
    assert.deepEqual(filtersSummary({ ...EMPTY_FILTERS, radius: [0, 30] }), ['Mobilité : jusqu’à 30 km'])
  })
})

describe('CV Thèque : équivalences de compétences (ADR 0057)', () => {
  // Profil fictif proche du cas signalé le 2026-11-20 : NestJS et Angular, sans « Node.js » écrit.
  const nest: SearchableCandidate = {
    ...base, name: 'Profil Nest', skills: ['JavaScript', 'Angular', 'NestJS', 'Express', 'Docker'], experiences: [], experienceSummary: '', desiredRoles: [],
  }
  const skillsOf = (skills: string[], list: SearchableCandidate[] = [base, other, nest]) =>
    filterCandidates(list, { ...EMPTY_FILTERS, skills }, now).map(c => c.name)

  it('retient un profil NestJS pour « Node.js », et pour « Angular » + « Node.js »', () => {
    assert.deepEqual(skillsOf(['Node.js']), ['Profil Nest'])
    assert.deepEqual(skillsOf(['Angular', 'Node.js']), ['Profil Nest'])
  })

  it('lit les écritures d\'une même compétence, sans table pour les mots collés', () => {
    const p = (skills: string[]) => ({ ...nest, name: skills.join('+'), skills })
    assert.deepEqual(skillsOf(['Node.js'], [p(['NodeJS']), p(['Node']), p(['node js'])]), ['NodeJS', 'Node', 'node js'])
    assert.deepEqual(skillsOf(['NodeJS'], [p(['Node.js'])]), ['Node.js'])
    assert.deepEqual(skillsOf(['Kubernetes'], [p(['K8s'])]), ['K8s'])
    assert.deepEqual(skillsOf(['JS'], [p(['JavaScript'])]), ['JavaScript'])
    assert.deepEqual(skillsOf(['CI/CD'], [p(['CICD'])]), ['CICD'])
  })

  it('enchaîne les compétences voisines dans un seul sens', () => {
    const p = (skills: string[]) => ({ ...nest, name: skills.join('+'), skills })
    // NestJS ⇒ Node.js ⇒ JavaScript ; Next.js ⇒ React ; Angular ⇒ TypeScript ⇒ JavaScript.
    assert.deepEqual(skillsOf(['JavaScript'], [p(['NestJS']), p(['Next.js']), p(['Angular'])]), ['NestJS', 'Next.js', 'Angular'])
    assert.deepEqual(skillsOf(['Java'], [p(['Spring Boot'])]), ['Spring Boot'])
    // L'inverse ne vaut pas : savoir Node.js ne fait pas un développeur NestJS.
    assert.deepEqual(skillsOf(['NestJS'], [p(['Node.js']), p(['JavaScript'])]), [])
    assert.deepEqual(skillsOf(['Spring Boot'], [p(['Java'])]), [])
  })

  it('ne rapproche pas deux technologies au nom voisin, ni un mot dans une autre compétence', () => {
    const p = (skills: string[]) => ({ ...nest, name: skills.join('+'), skills })
    assert.deepEqual(skillsOf(['Java'], [p(['JavaScript']), p(['TypeScript']), p(['NestJS'])]), [])
    assert.deepEqual(skillsOf(['Angular'], [p(['AngularJS'])]), [])
    assert.deepEqual(skillsOf(['Golang'], [p(['Go-to-market'])]), [])
    assert.deepEqual(skillsOf(['Golang'], [p(['Go'])]), ['Go'])
    // Règle d'avant gardée : un mot entier d'une compétence plus longue.
    assert.deepEqual(skillsOf(['React'], [p(['React Native'])]), ['React Native'])
  })

  it('dit quelle compétence du profil a répondu, seulement pour une équivalence', () => {
    assert.deepEqual(skillCorrespondences(nest.skills, ['Angular', 'Node.js', 'TypeScript']), [
      { asked: 'Node.js', own: 'NestJS' }, { asked: 'TypeScript', own: 'Angular' },
    ])
    assert.deepEqual(skillMatcher('Node.js')(['NodeJS']), { own: 'NodeJS', viaEquivalence: false })
    assert.equal(skillMatcher('Node.js')(['Python']), null)
    assert.equal(skillKey('Node.js'), skillKey('node JS'))
    assert.ok(equivalentSkillKeys('JavaScript').has(skillKey('NestJS')))
    assert.equal(equivalentSkillKeys('  ').size, 0)
  })
})

describe('CV Thèque : tri par place des compétences dans le parcours', () => {
  const profile = (name: string, title: string, missions: string[], skills: string[]): SearchableCandidate => ({
    ...base, name, skills, desiredRoles: [], experienceSummary: '', experiences: [{ title, company: 'Exemple', missions }],
  })
  // Profils fictifs, dans l'ordre d'arrivée.
  const pm = profile('Chef de projet', 'Chef de projet SI', ['Pilotage du budget'], ['HTML, CSS, JavaScript'])
  const dev = profile('Dev missions', 'Développeur full stack', ['Écrans en JavaScript et HTML'], ['JavaScript'])
  const angular = profile('Dev Angular', 'Développeur Angular', ['Applications de gestion'], ['Angular'])
  const js = profile('Dev JS', 'Développeur JavaScript', ['API'], ['JavaScript'])

  it('place d\'abord l\'intitulé, puis les missions, puis la seule liste de compétences', () => {
    assert.deepEqual(rankBySkillUse([pm, dev, angular, js], ['JavaScript']).map(c => c.name), ['Dev Angular', 'Dev JS', 'Dev missions', 'Chef de projet'])
  })

  it('ne change rien sans compétence demandée, et n\'écarte personne', () => {
    assert.deepEqual(rankBySkillUse([pm, dev], []).map(c => c.name), ['Chef de projet', 'Dev missions'])
    assert.equal(rankBySkillUse([pm, dev, angular, js], ['JavaScript']).length, 4)
  })
})

describe('CV Thèque : tri, équivalences dans les intitulés', () => {
  const profile = (name: string, title: string, skills: string[]): SearchableCandidate => ({
    ...base, name, skills, desiredRoles: [], experienceSummary: '', experiences: [{ title, company: 'Exemple', missions: [] }],
  })
  it('compte un intitulé qui nomme une équivalence (« JS », « Angular ») comme la compétence elle-même', () => {
    const pm = profile('Chef de projet', 'Chef de projet SI', ['JavaScript'])
    const js = profile('Dev JS', 'Développeur FullStack JS', ['JavaScript'])
    const ng = profile('Dev Angular', 'Développeur .NET & Angular', ['JavaScript'])
    assert.deepEqual(rankBySkillUse([pm, js, ng], ['JavaScript']).map(c => c.name), ['Dev JS', 'Dev Angular', 'Chef de projet'])
    assert.ok(equivalentSkillNames('JavaScript').includes('NestJS'))
    assert.deepEqual(equivalentSkillNames(''), [])
  })
})

describe('CV Thèque : filtre Métier (ADR 0057)', () => {
  const pm: SearchableCandidate = { ...base, name: 'Chef de projet', jobFamily: 'pilotage_projet' }
  const unclassified: SearchableCandidate = { ...base, name: 'Pas encore classé', jobFamily: null }
  const run = (jobFamilies: CvthequeFilters['jobFamilies']) =>
    filterCandidates([base, pm, unclassified], { ...EMPTY_FILTERS, jobFamilies }, now).map(c => c.name)

  it('garde les profils d\'une des familles choisies, et écarte un CV pas encore classé', () => {
    assert.deepEqual(run(['developpement']), ['Camille Durand'])
    assert.deepEqual(run(['developpement', 'pilotage_projet']), ['Camille Durand', 'Chef de projet'])
    assert.deepEqual(run([]), ['Camille Durand', 'Chef de projet', 'Pas encore classé'])
  })

  it('compte comme critère d\'une recherche, et se relit sans valeur inconnue ni doublon, dans l\'ordre de la liste', () => {
    assert.equal(hasSearchCriteria({ ...EMPTY_FILTERS, jobFamilies: ['rh'] }), true)
    assert.equal(activeFilterCount({ ...EMPTY_FILTERS, jobFamilies: ['rh'] }), 1)
    assert.deepEqual(sanitizeFilters({ jobFamilies: ['rh', 'pirate', 'developpement', 'rh', 42] }).jobFamilies, ['developpement', 'rh'])
    assert.deepEqual(filtersFromSearchParams(new URLSearchParams('metier=rh&metier=inconnu')).jobFamilies, ['rh'])
    assert.ok(filtersSummary({ ...EMPTY_FILTERS, jobFamilies: ['developpement', 'rh'] }).includes('Métier : Développement ou Ressources humaines'))
  })

  it('compte les profils par famille', () => {
    const counts = jobFamilyCounts([base, pm, unclassified, { ...base, jobFamily: 'developpement' }])
    assert.equal(counts.find(c => c.family === 'developpement')?.count, 2)
    assert.equal(counts.find(c => c.family === 'pilotage_projet')?.count, 1)
    assert.equal(counts.find(c => c.family === 'rh')?.count, 0)
  })
})
