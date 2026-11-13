import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_FILTERS, EXPERIENCE_MAX, RADIUS_MAX, activeFilterCount, filterCandidates, matchesQuery, parseQuery, valuesByFrequency, type SearchableCandidate } from './cvtheque-search'

// Profils fictifs.
const base: SearchableCandidate = {
  name: 'Camille Durand', city: 'Lyon', mobilityRadiusKm: 30, skills: ['Java', 'Spring Boot'], experienceSummary: 'Développeuse back-end',
  experiences: [{ title: 'Développeuse Java', company: 'Exemple Banque', missions: ['API de paiement'] }],
  education: [{ degree: 'Master informatique', school: 'Université de Lyon' }], languages: [{ name: 'Anglais' }],
  yearsOfExperience: 6, openToWork: true, desiredSector: ['Banque'], desiredRoles: ['Lead Developer'], createdAt: '2026-11-10T09:00:00.000Z',
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
