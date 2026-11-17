import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_CRITERIA, scoreProfile, type MbcCriteria, type MbcProfile } from './rules'
import {
  BASE_STRATEGY_LABEL, STRATEGY_LIMITS, failedRun, hasMorePages, mergePool, parseStrategies, settledRuns, titleKey, titlePairs,
  type StrategyRun,
} from './strategies'

// Données fictives uniquement.
const NOW = new Date('2026-11-16T12:00:00Z')
const base: MbcCriteria = {
  ...EMPTY_CRITERIA, titles: ['Data Engineer'], locations: ['Lyon, France'], seniorities: ['senior'], skills: ['Spark', 'Kafka'],
  sectors: ['Banking'], emailOnly: true,
}
const answer = (strategies: unknown) => JSON.stringify({ strategies })
const profile = (id: string, title = 'Data Engineer', over: Partial<MbcProfile> = {}): MbcProfile => ({
  id, firstName: 'Camille', lastNameMasked: 'Du***t', title, company: 'Exemple SA', hasEmail: true, hasPhone: false,
  refreshedAt: '2026-10-01T00:00:00Z', ...over,
})
const scored = (p: MbcProfile) => scoreProfile(p, base, NOW)

describe('MBC Search : requêtes d\'un besoin proposées par l\'IA', () => {
  it('garde d\'abord la requête des critères, puis les autres intitulés, sans toucher au lieu, à la séniorité ni aux filtres', () => {
    const s = parseStrategies(`Voici :\n${answer([
      { label: 'Intitulé français', titles: ['Ingénieur Data', 'Ingénieur Big Data'], requiredSkills: [] },
      { label: 'Plateformes de données', titles: ['Data Platform Engineer'], requiredSkills: ['Spark'], locations: ['Paris'], seniorities: ['intern'] },
    ])}`, base)
    assert.equal(s.length, 3)
    assert.equal(s[0].label, BASE_STRATEGY_LABEL)
    assert.deepEqual(s[0].criteria, base)
    assert.deepEqual(s[1].criteria.titles, ['Ingénieur Data', 'Ingénieur Big Data'])
    for (const x of s.slice(1)) {
      assert.deepEqual(x.criteria.locations, ['Lyon, France'])
      assert.deepEqual(x.criteria.seniorities, ['senior'])
      assert.deepEqual(x.criteria.sectors, ['Banking'])
      assert.equal(x.criteria.emailOnly, true)
    }
    assert.deepEqual(s[2].criteria.requiredSkills, ['Spark'])
  })

  it('une compétence obligatoire ajoutée par l\'IA reste dans les compétences (sinon elle ne filtrerait pas)', () => {
    const [, s] = parseStrategies(answer([{ label: 'Avec Airflow', titles: ['Data Engineer'], requiredSkills: ['Airflow'] }]), base)
    assert.deepEqual(s.criteria.requiredSkills, ['Airflow'])
    assert.deepEqual(s.criteria.skills, ['Airflow', 'Spark', 'Kafka'])
  })

  it('garde les compétences ★ du recruteur obligatoires dans toutes les requêtes, à la place de celles de l\'IA', () => {
    const withRequired = { ...base, requiredSkills: ['Kafka'] }
    const s = parseStrategies(answer([{ label: 'Autre', titles: ['Streaming Engineer'], requiredSkills: ['Flink', 'Scala'] }]), withRequired)
    assert.deepEqual(s[1].criteria.requiredSkills, ['Kafka'])
  })

  it('écarte doublons (casse, accents, ordre) et propositions illisibles, 5 requêtes au plus', () => {
    const s = parseStrategies(answer([
      { label: 'Même chose', titles: ['data engineer'] },
      { label: 'Vide', titles: [], requiredSkills: [] },
      'pas un objet', null, ['tableau'],
      { label: 'A', titles: ['Ingénieur Données'] },
      { label: 'A bis', titles: ['Ingenieur donnees'] },
      { label: 'B', titles: ['Big Data Engineer'] },
      { label: 'C', titles: ['ETL Developer'] },
      { label: 'D', titles: ['Data Pipeline Engineer'] },
      { label: 'E', titles: ['Analytics Engineer'] },
    ]), base)
    assert.equal(s.length, STRATEGY_LIMITS.count)
    assert.deepEqual(s.map(x => x.label), [BASE_STRATEGY_LABEL, 'A', 'B', 'C', 'D'])
  })

  it('borne ce qui vient de l\'IA : 4 intitulés, 2 mots-clés, libellé et intitulés courts, séniorité inconnue ignorée', () => {
    const [, s, long] = parseStrategies(answer([{
      label: 'x'.repeat(300), titles: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], requiredSkills: ['K1', 'K2', 'K3'],
    }, { label: 'Trop long', titles: ['y'.repeat(200)], seniorities: ['god_mode'] }]), base)
    assert.equal(s.criteria.titles.length, STRATEGY_LIMITS.titles)
    assert.deepEqual(s.criteria.requiredSkills, ['K1', 'K2'])
    assert.equal(s.label.length, STRATEGY_LIMITS.label)
    assert.equal(long.criteria.titles[0].length, 80)
    assert.deepEqual(long.criteria.seniorities, ['senior'])
  })

  it('réponse illisible ou vide : la requête des critères seule', () => {
    for (const text of ['', 'pas de JSON', '{"strategies": "non"}', answer([])]) {
      const s = parseStrategies(text, base)
      assert.equal(s.length, 1, text)
      assert.deepEqual(s[0].criteria, base)
    }
  })
})

describe('MBC Search : profils réunis de plusieurs requêtes', () => {
  it('réunit sans doublon (identifiant Apollo), note les requêtes de chaque profil et compte les nouveaux', () => {
    const first = mergePool([], [scored(profile('a')), scored(profile('b', 'Comptable'))], 0)
    assert.equal(first.added, 2)
    const second = mergePool(first.pool, [scored(profile('b', 'Comptable')), scored(profile('c', 'Data Engineer', { hasEmail: false }))], 1)
    assert.equal(second.added, 1)
    assert.deepEqual(second.pool.map(p => p.id), ['a', 'c', 'b'], 'du meilleur au moins bon score')
    assert.deepEqual(second.pool.find(p => p.id === 'b')?.strategies, [0, 1])
    // La même requête relue (page suivante qui renvoie une personne déjà vue) n'est pas comptée deux fois.
    assert.deepEqual(mergePool(second.pool, [scored(profile('a'))], 0).pool.find(p => p.id === 'a')?.strategies, [0])
  })

  it('« Chercher plus loin » : seulement une requête finie à laquelle Apollo annonce d\'autres profils, 5 pages au plus', () => {
    const run = (over: Partial<StrategyRun>): StrategyRun => ({
      strategy: { label: 'x', criteria: base }, status: 'done', page: 1, total: 340, found: 100, added: 80, ...over,
    })
    assert.equal(hasMorePages(run({})), true)
    assert.equal(hasMorePages(run({ total: 100 })), false)
    assert.equal(hasMorePages(run({ page: STRATEGY_LIMITS.maxPage, total: 10_000 })), false)
    assert.equal(hasMorePages(run({ status: 'error', page: 0 })), false)
    assert.equal(hasMorePages(run({ status: 'stopped', page: 0 })), false)
  })

  it('page suivante en échec : la requête garde ses profils et ses chiffres, et la même page reste proposée', () => {
    const done: StrategyRun = { strategy: { label: 'x', criteria: base }, status: 'done', page: 1, total: 340, found: 100, added: 80 }
    const later = failedRun(done, 2, 'Apollo ne répond pas')
    assert.equal(later.status, 'done')
    assert.equal(later.error, 'Apollo ne répond pas')
    assert.equal(later.found, 100)
    assert.equal(hasMorePages(later), true, 'page 2 de nouveau')
    assert.equal(failedRun({ ...done, page: 0, found: 0 }, 1, 'refus').status, 'error')
  })

  it('fin d\'un passage, même interrompu : pas lancées « arrêtées », restée en cours en échec, finies inchangées', () => {
    const r = (status: StrategyRun['status'], page = 0): StrategyRun => ({ strategy: { label: status, criteria: base }, status, page, total: 0, found: 0, added: 0 })
    const settled = settledRuns([r('done', 1), r('running'), r('waiting'), r('error'), r('running', 1)], 'Serveur injoignable')
    assert.deepEqual(settled.map(x => x.status), ['done', 'error', 'stopped', 'error', 'done'])
    assert.equal(settled[1].error, 'Serveur injoignable')
    assert.equal(settled[4].error, 'Serveur injoignable', 'page suivante interrompue : profils gardés')
  })
})

describe('MBC Search : intitulés à faire comparer par l\'IA', () => {
  it('une paire par intitulé différent de la page, le métier demandé étant les intitulés du recruteur', () => {
    const pairs = titlePairs({ ...base, titles: ['Data Engineer', 'Ingénieur Data'] }, [
      profile('a', 'Senior Data Engineer'), profile('b', ' senior data engineer '), profile('c', 'Comptable'), profile('d', ''),
    ])
    assert.deepEqual(pairs, [
      { metier: 'Data Engineer / Ingénieur Data', intitule: 'Senior Data Engineer' },
      { metier: 'Data Engineer / Ingénieur Data', intitule: 'Comptable' },
    ])
    assert.equal(titleKey(' Data ENGINEER '), titleKey('data engineer'))
  })

  it('aucune paire sans intitulé demandé (le critère ne départage personne)', () => {
    assert.deepEqual(titlePairs({ ...base, titles: [] }, [profile('a')]), [])
  })

  it('n\'interroge pas l\'IA sur un intitulé identique à l\'un de ceux demandés, et ne lui envoie que des intitulés entiers', () => {
    const long = ['Data Engineer', 'Ingénieur Data', 'Big Data Engineer', 'Ingénieur Big Data', 'Data Platform Engineer', 'Ingénieur Plateforme Data']
    const pairs = titlePairs({ ...base, titles: long }, [profile('a', 'ingénieur data'), profile('b', 'ETL Developer')])
    assert.deepEqual(pairs.map(p => p.intitule), ['ETL Developer'])
    assert.ok(pairs[0].metier.length <= 120)
    assert.ok(long.slice(0, 2).every(t => pairs[0].metier.includes(t)))
    assert.ok(!pairs[0].metier.endsWith(' / '))
  })
})
