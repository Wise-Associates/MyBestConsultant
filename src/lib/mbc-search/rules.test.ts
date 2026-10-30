import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_CRITERIA, PAGE_SIZE, criteriaProblem, criteriaSchema, parseApolloPeople, parseBriefCriteria, rankProfiles, scoreProfile,
  toApolloQuery, type MbcProfile,
} from './rules'
import { MBC_SEARCH_DAILY_LIMITS, MBC_SEARCH_QUOTA_MESSAGE, mbcSearchDenial } from './access'

// Données fictives uniquement.
const NOW = new Date('2026-10-30T12:00:00Z')
const profile = (over: Partial<MbcProfile> = {}): MbcProfile => ({
  id: 'p1', firstName: 'Camille', lastNameMasked: 'Du***t', title: 'Senior Data Engineer', company: 'Exemple SA',
  hasEmail: true, hasPhone: false, refreshedAt: '2026-10-01T00:00:00Z', ...over,
})

describe('MBC Search : critères de recherche', () => {
  it('refuse une recherche sans intitulé ni compétence', () => {
    assert.match(criteriaProblem(EMPTY_CRITERIA) ?? '', /intitulé de poste ou une compétence/)
    assert.equal(criteriaProblem({ ...EMPTY_CRITERIA, skills: ['Kafka'] }), null)
  })

  it('valide les critères reçus du navigateur (séniorité inconnue, listes trop longues)', () => {
    assert.equal(criteriaSchema.safeParse({ ...EMPTY_CRITERIA, seniorities: ['god_mode'] }).success, false)
    assert.equal(criteriaSchema.safeParse({ ...EMPTY_CRITERIA, titles: Array(9).fill('Dev') }).success, false)
    assert.equal(criteriaSchema.safeParse({ ...EMPTY_CRITERIA, titles: ['x'.repeat(81)] }).success, false)
    assert.equal(criteriaSchema.safeParse({ titles: ['Data Engineer'], locations: ['Paris'], seniorities: ['senior'], skills: [] }).success, true)
  })

  it('construit la requête Apollo : compétences en mots-clés, 25 profils par page', () => {
    const q = toApolloQuery({ titles: ['Data Engineer'], locations: ['Paris, France'], seniorities: ['senior'], skills: ['Spark', 'Kafka'] }, 3)
    assert.deepEqual(q.person_titles, ['Data Engineer'])
    assert.deepEqual(q.person_locations, ['Paris, France'])
    assert.deepEqual(q.person_seniorities, ['senior'])
    assert.equal(q.q_keywords, 'Spark Kafka')
    assert.equal(q.page, 3)
    assert.equal(q.per_page, PAGE_SIZE)
  })
})

describe('MBC Search : lecture de la réponse d\'Apollo', () => {
  it('lit les profils sans e-mail ni téléphone, nom de famille masqué', () => {
    const res = parseApolloPeople({
      total_entries: 120,
      people: [{
        id: 'a1', first_name: 'Camille', last_name_obfuscated: 'Du***t', title: 'Data Engineer', has_email: true,
        has_direct_phone: 'Yes', last_refreshed_at: '2026-10-20T04:37:33.000+00:00', organization: { name: 'Exemple SA' },
      }],
    })
    assert.equal(res?.total, 120)
    assert.deepEqual(res?.profiles[0], {
      id: 'a1', firstName: 'Camille', lastNameMasked: 'Du***t', title: 'Data Engineer', company: 'Exemple SA',
      hasEmail: true, hasPhone: true, refreshedAt: '2026-10-20T04:37:33.000+00:00',
    })
  })

  it('écarte un profil illisible sans perdre la page, et refuse une réponse d\'une autre forme', () => {
    const res = parseApolloPeople({ people: [{ title: 'sans id' }, { id: 'a2', has_direct_phone: 'Maybe: please request' }] })
    assert.equal(res?.profiles.length, 1)
    assert.equal(res?.profiles[0].hasPhone, false)
    assert.equal(parseApolloPeople({ people: 'non' }), null)
    assert.equal(parseApolloPeople(null), null)
  })
})

describe('MBC Search : score et classement', () => {
  const criteria = { titles: ['Data Engineer'], locations: [], seniorities: [], skills: ['Spark'] }

  it('donne les points de l\'intitulé, de la joignabilité et de la fraîcheur, avec leurs raisons', () => {
    const s = scoreProfile(profile(), criteria, NOW)
    // 55 (intitulé) + 0 (Spark non visible) + 10 (e-mail) + 10 (mis à jour il y a un mois)
    assert.equal(s.score, 75)
    assert.deepEqual(s.reasons, ['Intitulé conforme : « Data Engineer »', 'E-mail disponible', 'Profil mis à jour il y a moins de 6 mois'])
  })

  it('compte une compétence visible dans l\'intitulé, sans tenir compte des accents ni de la casse', () => {
    const s = scoreProfile(profile({ title: 'Ingénieur données SPARK' }), { ...criteria, titles: ['Ingénieur données'] }, NOW)
    assert.equal(s.score, 100)
    assert.ok(s.reasons.includes('Compétence visible : Spark'))
  })

  it('note partiellement un intitulé proche et ignore un profil ancien ou injoignable', () => {
    const s = scoreProfile(profile({ title: 'Data Analyst', hasEmail: false, refreshedAt: '2025-01-01T00:00:00Z' }), criteria, NOW)
    assert.equal(s.score, 28)
    assert.deepEqual(s.reasons, ['Intitulé proche de « Data Engineer »'])
  })

  it('classe du meilleur au moins bon, en gardant l\'ordre d\'Apollo à score égal', () => {
    const ranked = rankProfiles([
      profile({ id: 'faible', title: 'Comptable', hasEmail: false }),
      profile({ id: 'b' }),
      profile({ id: 'c' }),
    ], criteria, NOW)
    assert.deepEqual(ranked.map(p => p.id), ['b', 'c', 'faible'])
  })
})

describe('MBC Search : critères tirés du brief par l\'IA', () => {
  it('lit le JSON même entouré de texte, écarte doublons et séniorités inconnues', () => {
    const c = parseBriefCriteria('Voici :\n```json\n{"titles":["Data Engineer","data engineer"],"locations":["Lyon"],"seniorities":["senior","boss"],"skills":["Spark"]}\n```')
    assert.deepEqual(c, { titles: ['Data Engineer'], locations: ['Lyon'], seniorities: ['senior'], skills: ['Spark'] })
  })

  it('renvoie null quand rien n\'est exploitable (fail closed)', () => {
    assert.equal(parseBriefCriteria('Je ne peux pas'), null)
    assert.equal(parseBriefCriteria('{ pas du json }'), null)
    assert.equal(parseBriefCriteria('{"titles":[],"skills":[]}'), null)
  })
})

describe('MBC Search : accès', () => {
  const allowed = { tenantId: 'tenant-acme', subscriptionStatus: 'active', emailVerified: true }

  it('est permis à une organisation abonnée (essai compris) à l\'adresse vérifiée', () => {
    assert.equal(mbcSearchDenial(allowed), null)
    assert.equal(mbcSearchDenial({ ...allowed, subscriptionStatus: 'trialing' }), null)
  })

  it('est refusé sans abonnement actif ou sans adresse vérifiée', () => {
    for (const status of ['canceled', 'past_due', '', null, undefined]) {
      assert.match(mbcSearchDenial({ ...allowed, subscriptionStatus: status }) ?? '', /abonnement/, String(status))
    }
    assert.match(mbcSearchDenial({ ...allowed, emailVerified: false }) ?? '', /adresse e-mail/)
  })

  it('annonce le plafond du jour', () => {
    assert.ok(MBC_SEARCH_DAILY_LIMITS.perOrganisation < MBC_SEARCH_DAILY_LIMITS.allOrganisations)
    assert.match(MBC_SEARCH_QUOTA_MESSAGE.organisation, new RegExp(`${MBC_SEARCH_DAILY_LIMITS.perOrganisation} recherches`))
  })
})
