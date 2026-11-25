import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterLevel, locationCheck, minimumYears, profileQueries, profileScore, searchProfileOf, selectHits, skillCheck, skillKey, titleFit,
} from './offer-filter'
import type { SearchHit } from './cv-search'
import type { OfferCriteriaSet } from '@/lib/offer-criteria'

// Offre, critères et CV fictifs.
const OFFER = { title: 'Développeur Java Angular (H/F) – Paris', skills: ['Java', 'Angular', 'Kafka'], location: 'Paris' }
const CRITERIA: OfferCriteriaSet = {
  version: 1,
  criteria: [
    { id: 'poste', name: 'Poste', weight: 40, labels: [{ label: 'Développeur Java', weight: 70, required: true }, { label: 'Développeur Angular', weight: 30, required: false }] },
    { id: 'competences', name: 'Techno', weight: 25, labels: [{ label: 'Java', weight: 60, required: true }, { label: 'Kafka', weight: 40, required: false }] },
    { id: 'localisation', name: 'Localisation', weight: 10, labels: [{ label: 'Paris', weight: 100, required: true }] },
    { id: 'niveau', name: 'Séniorité', weight: 10, labels: [{ label: '5 ans et plus', weight: 100, required: true }] },
    { id: 'domaine', name: 'Secteur', weight: 10, labels: [{ label: 'Banque de détail', weight: 100, required: true }] },
    { id: 'x1', name: 'Expérience des paiements', weight: 5, labels: [] },
  ],
  alternativeTitles: ['Ingénieur études et développement Java'],
}
const profile = searchProfileOf(OFFER, CRITERIA)
const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  id: 'c', sourceId: 'cand', roles: ['Développeur Java senior'], skills: ['Java', 'Spring', 'Kafka'], city: 'Paris',
  yearsOfExperience: 9, sectors: ['banque'], languages: ['Français'], ...over,
})

describe('filtre des CV après le préfiltre (ADR 0061, phase 2)', () => {
  it('tire de l’offre ses recherches : titre, métiers et autres intitulés, puis technologies ★ d’abord', () => {
    assert.deepEqual(profile.titles, ['Développeur Java Angular', 'Développeur Java', 'Développeur Angular', 'Ingénieur études et développement Java'])
    const queries = profileQueries(profile, 'kind = "candidate"', 'cvs')
    assert.deepEqual(queries.map(q => [q.q, q.limit]), [
      ['Développeur Java Angular', 100], ['Développeur Java', 60], ['Développeur Angular', 60], ['Ingénieur études et développement Java', 60],
      ['Java', 50], ['Kafka', 50],
    ])
    assert.ok(queries.every(q => q.filter === 'kind = "candidate"' && q.attributesToRetrieve.includes('yearsOfExperience')))
  })

  it('sans critères : ceux par défaut de l’offre (métier du titre et ville requis, poids du barème ramenés aux cinq critères)', () => {
    const plain = searchProfileOf(OFFER, null)
    assert.deepEqual(plain.roles, [{ label: 'Développeur Java Angular', weight: 100, required: true }])
    assert.deepEqual(plain.location, [{ label: 'Paris', weight: 100, required: true }])
    assert.deepEqual(plain.skills.map(s => [s.label, s.required]), [['Java', false], ['Angular', false], ['Kafka', false]])
    assert.deepEqual(plain.weights, { role: 33, skills: 30, location: 14, seniority: 11, sector: 12, language: 0 })
  })

  it('un intitulé court doit être retrouvé entier, un long aux deux tiers', () => {
    assert.equal(titleFit(['Développeur Python'], 'Développeur Java').matches, false)
    assert.equal(titleFit(['Développeur Java/JEE'], 'Développeur Java').matches, true)
    assert.equal(titleFit(['Chef de projet'], 'Chef de projet MOA').matches, true)
    assert.equal(titleFit(['Chef de cuisine'], 'Chef de projet MOA').matches, false)
  })

  it('lit les années minimales d’une séniorité, borne basse d’une fourchette', () => {
    assert.equal(minimumYears('5 ans et plus'), 5)
    assert.equal(minimumYears('10+ ans d’expérience'), 10)
    assert.equal(minimumYears('Senior'), 8)
    assert.equal(minimumYears('Profil confirmé'), 3)
    assert.equal(minimumYears('Expérience significative'), null)
    // Revue de code du 2026-11-24 : la borne haute écartait des CV dans la fourchette.
    assert.equal(minimumYears('Junior (0-2 ans)'), 0)
    assert.equal(minimumYears('3-5 ans'), 3)
    assert.equal(minimumYears('entre 10 et 15 ans'), 10)
    assert.equal(minimumYears('Confirmé (3 à 7 ans)'), 3)
  })

  it('technologies : orthographes et synonymes, une lettre, libellé composé, libellé illisible', () => {
    assert.equal(skillKey('Spring Boot'), skillKey('SpringBoot'))
    assert.equal(skillKey('Node.js'), skillKey('NodeJS'))
    assert.equal(skillKey('JS'), skillKey('JavaScript'))
    assert.equal(skillCheck(['JS', 'React'], 'JavaScript'), 'pass')
    assert.equal(skillCheck(['SpringBoot'], 'Spring Boot'), 'pass')
    assert.equal(skillCheck(['R', 'Python'], 'R'), 'pass')
    assert.equal(skillCheck(['C++'], 'C'), 'fail')
    assert.equal(skillCheck(['SAP FI'], 'SAP'), 'pass')
    assert.equal(skillCheck(['Java'], 'Java/Angular'), 'fail')
    assert.equal(skillCheck(['Java', 'Angular'], 'Java/Angular'), 'pass')
    assert.equal(skillCheck(['Java'], ' / '), 'unknown')
    assert.equal(skillCheck([], 'Java'), 'unknown')
  })

  it('lieu : même ville ou région, ville entière, libellé sans lieu inconnu', () => {
    assert.equal(locationCheck('Versailles', 'Paris (hybride)'), 'pass')
    assert.equal(locationCheck('Paris', 'Île-de-France'), 'pass')
    assert.equal(locationCheck('Saint-Étienne', 'Saint-Denis'), 'fail')
    assert.equal(locationCheck('Lyon', 'Paris'), 'fail')
    assert.equal(locationCheck('Brest', 'Brest'), 'pass')
    for (const label of ['Télétravail', 'France', 'Hybride', 'Full remote']) assert.equal(locationCheck('Lyon', label), 'unknown', label)
    assert.equal(locationCheck('', 'Paris'), 'unknown')
  })

  it('plusieurs villes ou secteurs ★ : l’un suffit ; plusieurs langues ★ : toutes', () => {
    const many = searchProfileOf(OFFER, {
      ...CRITERIA,
      criteria: CRITERIA.criteria.map(c => (c.id === 'localisation'
        ? { ...c, labels: [{ label: 'Paris', weight: 50, required: true }, { label: 'Lyon', weight: 50, required: true }] }
        : c.id === 'domaine' ? { ...c, labels: [{ label: 'Banque', weight: 50, required: true }, { label: 'Assurance', weight: 50, required: true }] }
          : c)),
    })
    assert.equal(filterLevel(many, hit({ city: 'Lyon', sectors: ['assurance'] })), 0)
    const languages = searchProfileOf(OFFER, {
      ...CRITERIA,
      criteria: [...CRITERIA.criteria.filter(c => c.id !== 'x1'), { id: 'langue', name: 'Langue', weight: 5, labels: [{ label: 'English', weight: 50, required: true }, { label: 'Allemand', weight: 50, required: true }] }],
    })
    assert.equal(filterLevel(languages, hit({ languages: ['Anglais', 'Allemand'] })), 0)
    assert.equal(filterLevel(languages, hit({ languages: ['Anglais'] })), 3)
  })

  it('assouplit dans l’ordre : ville, séniorité, secteur et langue, métier ; jamais une technologie ★', () => {
    assert.equal(filterLevel(profile, hit()), 0)
    assert.equal(filterLevel(profile, hit({ city: 'Lyon' })), 1)
    assert.equal(filterLevel(profile, hit({ city: 'Lyon', yearsOfExperience: 2 })), 2)
    assert.equal(filterLevel(profile, hit({ sectors: ['industrie'] })), 3)
    assert.equal(filterLevel(profile, hit({ roles: ['Data Engineer'] })), 4)
    assert.equal(filterLevel(profile, hit({ skills: ['Python', 'Kafka'] })), null)
    // Une année de moins tolérée (l'IA jugera « partiel »).
    assert.equal(filterLevel(profile, hit({ yearsOfExperience: 4 })), 0)
    // Autre intitulé du premier métier : il compte comme ce métier.
    assert.equal(filterLevel(profile, hit({ roles: ['Ingénieur études et développement Java'] })), 0)
  })

  it('une valeur absente du CV ne l’écarte jamais', () => {
    assert.equal(filterLevel(profile, hit({ city: '', yearsOfExperience: null, sectors: [], languages: [], roles: [] })), 0)
    assert.equal(filterLevel(profile, hit({ skills: [] })), 0)
  })

  it('pré-score aux poids de l’offre : Java 70 / Angular 30 classe le développeur Java devant le développeur Angular', () => {
    const java = profileScore(profile, hit({ roles: ['Développeur Java'] }))
    const angular = profileScore(profile, hit({ roles: ['Développeur Angular'] }))
    assert.ok(java > angular, `${java} > ${angular}`)
    assert.ok(profileScore(profile, hit({ skills: ['Java', 'Kafka'] })) > profileScore(profile, hit({ skills: ['Java'] })))
    // Métiers ou technologies inconnus : moitié, devant un autre métier connu.
    assert.ok(profileScore(profile, hit({ roles: [] })) > profileScore(profile, hit({ roles: ['Comptable'] })))
    assert.ok(profileScore(profile, hit({ skills: [] })) > profileScore(profile, hit({ skills: ['Python'] })))
  })

  it('réunit les recherches, écarte les CV sans technologie ★, classe par niveau puis pré-score, en garde au plus `keep`', () => {
    const lists: SearchHit[][] = [
      [hit({ sourceId: 'loin', city: 'Lyon' }), hit({ sourceId: 'ideal' }), hit({ sourceId: 'sans-java', skills: ['Python'] })],
      [hit({ sourceId: 'ideal' }), hit({ sourceId: 'proche', roles: ['Développeur Angular'], skills: ['Java'] })],
    ]
    const result = selectHits(profile, lists, 10)
    // « proche » n'a pas le métier ★ : retenu seulement au dernier niveau, après « loin » (autre ville).
    assert.deepEqual(result, { ids: ['ideal', 'loin', 'proche'], found: 4, excluded: 1 })
    assert.deepEqual(selectHits(profile, lists, 2).ids, ['ideal', 'loin'])
  })
})
