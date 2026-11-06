import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APOLLO_PERSON_ID, EMPTY_CRITERIA, apolloKeywords, cleanOutreachDraft, outreachNeedText, outreachPersonText, savedSearchName, PAGE_SIZE, criteriaProblem, criteriaSchema, parseApolloMatches, parseApolloPeople, parseBriefCriteria,
  rankProfiles, scoreProfile, toApolloQuery, toRevealRequest, type MbcProfile,
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

  it('construit la requête Apollo : compétences obligatoires en mots-clés, 25 profils par page', () => {
    const q = toApolloQuery({ titles: ['Data Engineer'], locations: ['Paris, France'], seniorities: ['senior'], skills: ['Spark', 'Kafka'], requiredSkills: ['kafka'] }, 3)
    assert.deepEqual(q.person_titles, ['Data Engineer'])
    assert.deepEqual(q.person_locations, ['Paris, France'])
    assert.deepEqual(q.person_seniorities, ['senior'])
    assert.equal(q.q_keywords, 'kafka')
    assert.equal(q.page, 3)
    assert.equal(q.per_page, PAGE_SIZE)
    assert.ok(!('q_organization_keyword_tags' in q) && !('contact_email_status' in q))
  })

  it('ne filtre pas sur les compétences facultatives, sauf sans intitulé ; oublie une obligatoire retirée de la liste', () => {
    assert.equal(apolloKeywords({ ...EMPTY_CRITERIA, titles: ['Data Engineer'], skills: ['Spark'] }), '')
    assert.equal(apolloKeywords({ ...EMPTY_CRITERIA, skills: ['Spark', 'Kafka'] }), 'Spark Kafka')
    assert.equal(apolloKeywords({ ...EMPTY_CRITERIA, titles: ['Dev'], skills: ['Spark'], requiredSkills: ['Kafka'] }), '')
  })

  it('filtre par secteur de l\'employeur et sur les personnes à l\'e-mail connu', () => {
    const q = toApolloQuery({ ...EMPTY_CRITERIA, titles: ['Dev'], sectors: ['Banking'], emailOnly: true }, 1)
    assert.deepEqual(q.q_organization_keyword_tags, ['Banking'])
    assert.ok(q.contact_email_status?.includes('verified'))
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
    assert.deepEqual(s.match, { title: 'full', skills: [], reachable: true, fresh: true })
    assert.deepEqual(s.points, { title: 55, skills: 0, reachable: 10, fresh: 10 })
  })

  it('compte une compétence visible dans l\'intitulé, sans tenir compte des accents ni de la casse', () => {
    const s = scoreProfile(profile({ title: 'Ingénieur données SPARK' }), { ...criteria, titles: ['Ingénieur données'] }, NOW)
    assert.equal(s.score, 100)
    assert.ok(s.reasons.includes('Compétence visible : Spark'))
    assert.deepEqual(s.match.skills, ['Spark'])
  })

  it('note partiellement un intitulé proche et ignore un profil ancien ou injoignable', () => {
    const s = scoreProfile(profile({ title: 'Data Analyst', hasEmail: false, refreshedAt: '2025-01-01T00:00:00Z' }), criteria, NOW)
    assert.equal(s.score, 28)
    assert.deepEqual(s.reasons, ['Intitulé proche de « Data Engineer »'])
    assert.deepEqual(s.match, { title: 'partial', skills: [], reachable: false, fresh: false })
  })

  it('marque le critère d\'intitulé « indifférent » quand aucun intitulé n\'est demandé', () => {
    assert.equal(scoreProfile(profile(), { ...criteria, titles: [] }, NOW).match.title, 'any')
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
    const c = parseBriefCriteria('Voici :\n```json\n{"titles":["Data Engineer","data engineer"],"locations":["Lyon"],"seniorities":["senior","boss"],"skills":["Spark"],"sectors":["Banking"]}\n```')
    assert.deepEqual(c, { titles: ['Data Engineer'], locations: ['Lyon'], seniorities: ['senior'], skills: ['Spark'], requiredSkills: [], sectors: ['Banking'] })
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

describe('MBC Search : profils complets (enrichissement Apollo)', () => {
  it('n\'envoie à Apollo que les identifiants des personnes', () => {
    assert.deepEqual(toRevealRequest(['0123456789abcdef01234567']), { details: [{ id: '0123456789abcdef01234567' }] })
    assert.ok(APOLLO_PERSON_ID.test('0123456789abcdef01234567'))
    assert.ok(!APOLLO_PERSON_ID.test('../people/1'))
  })

  it('lit nom entier, LinkedIn, e-mail professionnel, lieu et parcours', () => {
    const [p] = parseApolloMatches({
      matches: [{
        id: 'a1', first_name: 'Camille', last_name: 'Dupont', name: 'Camille Dupont', title: 'Data Engineer',
        headline: 'Data Engineer chez Exemple SA', linkedin_url: 'http://www.linkedin.com/in/camille-exemple',
        email: 'camille.dupont@exemple.fr', email_status: 'verified', photo_url: 'https://media.exemple.fr/p.jpg',
        city: 'Lyon', state: 'Auvergne-Rhône-Alpes', country: 'France',
        organization: { name: 'Exemple SA', website_url: 'http://www.exemple.fr' },
        employment_history: [
          { title: 'Data Engineer', organization_name: 'Exemple SA', start_date: '2022-03-01', end_date: null, current: true },
          { title: 'Développeuse', organization_name: 'Démo SAS', start_date: '2019-01-01', end_date: '2022-02-01', current: false },
          { title: null, organization_name: null },
        ],
      }],
    }) ?? []
    assert.deepEqual(p, {
      id: 'a1', name: 'Camille Dupont', title: 'Data Engineer', headline: 'Data Engineer chez Exemple SA', company: 'Exemple SA',
      companyWebsite: 'https://www.exemple.fr', location: 'Lyon, Auvergne-Rhône-Alpes, France',
      linkedinUrl: 'https://www.linkedin.com/in/camille-exemple', email: 'camille.dupont@exemple.fr', emailStatus: 'verified',
      photoUrl: 'https://media.exemple.fr/p.jpg',
      experiences: [
        { title: 'Data Engineer', company: 'Exemple SA', start: '2022-03', end: '', current: true },
        { title: 'Développeuse', company: 'Démo SAS', start: '2019-01', end: '2022-02', current: false },
      ],
    })
  })

  it('écarte les personnes non trouvées, les liens dangereux et les e-mails qui ne sont pas de simples adresses', () => {
    const res = parseApolloMatches({ matches: [null, { id: 'a2', first_name: 'Lucas', last_name: 'Martin', linkedin_url: 'javascript:alert(1)', email: 'x@y.fr?bcc=z@w.fr' }] })
    assert.equal(res?.length, 1)
    assert.equal(res?.[0].name, 'Lucas Martin')
    assert.equal(res?.[0].linkedinUrl, '')
    assert.equal(res?.[0].email, '')
    assert.equal(parseApolloMatches({ people: [] }), null)
  })
})

describe('MBC Search : message d\'approche', () => {
  it('n\'envoie à l\'IA que le prénom, le poste et le parcours', () => {
    const text = outreachPersonText({ firstName: 'Camille', title: 'Data Engineer', company: 'Exemple SA', experiences: [{ title: 'Développeuse', company: 'Démo SAS' }, { title: '', company: '' }] })
    assert.equal(text, 'Prénom : Camille\nPoste actuel : Data Engineer chez Exemple SA\nParcours :\n- Développeuse chez Démo SAS')
  })

  it('prend le brief comme besoin, sinon les critères', () => {
    assert.equal(outreachNeedText('  Data engineer à Lyon ', EMPTY_CRITERIA), 'Data engineer à Lyon')
    assert.equal(outreachNeedText('', { ...EMPTY_CRITERIA, titles: ['Data Engineer'], locations: ['Lyon'] }), 'Poste : Data Engineer\nLieu : Lyon')
    assert.equal(outreachNeedText('', EMPTY_CRITERIA), '')
  })

  it('nettoie la réponse de l\'IA (guillemets, bloc de code)', () => {
    assert.equal(cleanOutreachDraft('```\nBonjour Camille,\n```'), 'Bonjour Camille,')
    assert.equal(cleanOutreachDraft('« Bonjour »'), 'Bonjour')
    assert.equal(cleanOutreachDraft('   '), '')
  })
})

describe('MBC Search : nom d\'une recherche', () => {
  it('nomme une recherche d\'après son intitulé et sa ville', () => {
    assert.equal(savedSearchName({ ...EMPTY_CRITERIA, titles: ['Data Engineer'], locations: ['Lyon, France'] }), 'Data Engineer · Lyon')
    assert.equal(savedSearchName({ ...EMPTY_CRITERIA, skills: ['Kafka'] }), 'Kafka')
  })
})
