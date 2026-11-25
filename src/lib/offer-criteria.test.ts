import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CRITERIA_LIMITS, CriteriaSetSchema, cleanLabel, criteriaFingerprint, criteriaSetProblem, defaultCriteriaSet,
  evenLabels, nextCustomId, parseCriteriaSet, requiredLabels, weightsSummingTo, type OfferCriteriaSet,
} from './offer-criteria'

// Offre fictive.
const OFFER = {
  title: 'Développeur Java Angular (H/F) – Paris',
  description: '### Profil recherché\n- 5 ans d’expérience en développement Java\n- Expérience du secteur bancaire\n### Missions\n- Développer les écrans Angular',
  skills: ['Java', 'Angular', 'java', 'Spring Boot'],
  location: 'Paris',
}

const javaAngular = (): OfferCriteriaSet => ({
  version: 1,
  criteria: [
    { id: 'poste', name: 'Poste', weight: 60, labels: [{ label: 'Développeur Java', weight: 70, required: true }, { label: 'Développeur Angular', weight: 30, required: false }] },
    { id: 'competences', name: 'Techno', weight: 30, labels: [{ label: 'Java', weight: 50, required: true }, { label: 'Angular', weight: 50, required: false }] },
    { id: 'x1', name: 'Expérience bancaire', weight: 10, labels: [] },
  ],
  alternativeTitles: ['Ingénieur Java'],
})

describe('critères de matching d’une offre', () => {
  it('critères par défaut : les cinq de MBC Search (Intitulé 33, Compétences 30), métier du titre et lieu requis', () => {
    const set = defaultCriteriaSet(OFFER)
    assert.deepEqual(set.criteria.map(c => [c.id, c.name, c.weight]), [
      ['poste', 'Intitulé', 33], ['localisation', 'Lieu', 14], ['niveau', 'Séniorité', 11], ['competences', 'Compétences', 30], ['domaine', 'Secteur', 12],
    ])
    const poste = set.criteria.find(c => c.id === 'poste')
    assert.deepEqual(poste?.labels, [{ label: 'Développeur Java Angular', weight: 100, required: true }])
    // Compétences sans doublon (« Java » / « java »), poids égaux de total 100.
    const techno = set.criteria.find(c => c.id === 'competences')
    assert.deepEqual(techno?.labels.map(l => l.label), ['Java', 'Angular', 'Spring Boot'])
    assert.deepEqual(techno?.labels.map(l => l.weight), [34, 33, 33])
    // Lieu : requis par défaut, comme le critère rouge du barème qu'il remplace.
    assert.deepEqual(set.criteria.find(c => c.id === 'localisation')?.labels, [{ label: 'Paris', weight: 100, required: true }])
    assert.equal(criteriaSetProblem(set), null)
  })

  it('refuse des critères trop longs pour leur attribut (20 000 caractères)', () => {
    const huge: OfferCriteriaSet = {
      version: 1,
      criteria: Array.from({ length: CRITERIA_LIMITS.criteria }, (_, i) => ({
        id: i === 0 ? 'poste' : `x${i}`, name: `Critère ${i}`, weight: i < 2 ? 8 : 7,
        labels: evenLabels(Array.from({ length: i === 0 ? 4 : CRITERIA_LIMITS.labels }, (_, k) => `${'Libellé très détaillé '.repeat(7)}${i}-${k}`)),
      })),
      alternativeTitles: [],
    }
    assert.equal(criteriaSetProblem(huge), 'Critères trop longs : retirez des libellés ou raccourcissez-les.')
  })

  it('accepte des critères retirés, un critère ajouté et des sous-poids (Java 70 / Angular 30)', () => {
    const parsed = CriteriaSetSchema.parse(javaAngular())
    assert.equal(parsed.criteria[2].name, 'Expérience bancaire')
    assert.equal(parsed.criteria[0].labels[0].weight, 70)
  })

  it('refuse un total différent de 100, pour l’offre comme dans un critère', () => {
    const offer = javaAngular()
    offer.criteria[0].weight = 59
    assert.equal(criteriaSetProblem(offer), 'Les poids des critères doivent totaliser 100.')
    const labels = javaAngular()
    labels.criteria[0].labels[1].weight = 20
    assert.equal(criteriaSetProblem(labels), 'Les libellés de « Intitulé » doivent totaliser 100.')
  })

  it('refuse un critère inconnu, en double, un critère ajouté sans nom, un libellé en double ou vide', () => {
    const unknown = javaAngular()
    unknown.criteria[2].id = 'salaire'
    assert.equal(criteriaSetProblem(unknown), 'Critère inconnu.')
    const twice = javaAngular()
    twice.criteria[2].id = 'poste'
    assert.equal(criteriaSetProblem(twice), 'Un critère figure deux fois.')
    const unnamed = javaAngular()
    unnamed.criteria[2].name = ' : '
    assert.equal(criteriaSetProblem(unnamed), 'Un critère ajouté doit avoir un nom.')
    const duplicate = javaAngular()
    duplicate.criteria[1].labels[1].label = 'JAVA'
    assert.equal(criteriaSetProblem(duplicate), '« Compétences » a deux fois le même libellé.')
    const empty = javaAngular()
    empty.criteria[1].labels[1].label = ' , '
    assert.equal(criteriaSetProblem(empty), 'Un libellé est vide.')
  })

  it('refuse un champ inattendu et un poids non entier ; nom de MBC Search pour un critère du barème, même enregistré sous l’ancien', () => {
    assert.notEqual(criteriaSetProblem({ ...javaAngular(), extra: 1 }), null)
    const decimal = javaAngular()
    decimal.criteria[0].weight = 59.5
    decimal.criteria[2].weight = 10.5
    assert.notEqual(criteriaSetProblem(decimal), null)
    const renamed = javaAngular()
    renamed.criteria[0].name = 'Autre nom'
    assert.equal(CriteriaSetSchema.parse(renamed).criteria[0].name, 'Intitulé')
    // Critères enregistrés avant l'ADR 0062 (« Poste », « Techno ») : relus sous les noms actuels, même empreinte.
    const parsed = CriteriaSetSchema.parse(javaAngular())
    assert.deepEqual(parsed.criteria.map(c => c.name), ['Intitulé', 'Compétences', 'Expérience bancaire'])
    assert.equal(criteriaFingerprint(parsed), criteriaFingerprint(javaAngular()))
  })

  it('borne le nombre de critères et de libellés', () => {
    const many = javaAngular()
    many.criteria[1].labels = evenLabels(Array.from({ length: CRITERIA_LIMITS.labels + 3 }, (_, i) => `Outil ${i}`))
    assert.equal(many.criteria[1].labels.length, CRITERIA_LIMITS.labels)
    assert.equal(criteriaSetProblem(many), null)
  })

  it('libellés sans les séparateurs du résumé des jugements', () => {
    assert.equal(cleanLabel('Java, Spring : expert · senior — 2026\n'), 'Java Spring expert senior 2026')
    assert.equal(CriteriaSetSchema.parse({ ...javaAngular(), alternativeTitles: ['Ingénieur : Java'] }).alternativeTitles[0], 'Ingénieur Java')
  })

  it('poids entiers dont le total fait 100, proportionnels aux parts, au moins 1 chacun', () => {
    assert.deepEqual(weightsSummingTo(3), [34, 33, 33])
    assert.deepEqual(weightsSummingTo(2, 100, [7, 3]), [70, 30])
    assert.deepEqual(weightsSummingTo(3, 100, [0, 0, 0]), [34, 33, 33])
    assert.deepEqual(weightsSummingTo(0), [])
    for (const count of [1, 2, 5, 7, 12, 14]) {
      const weights = weightsSummingTo(count, 100, Array.from({ length: count }, (_, i) => i * i))
      assert.equal(weights.reduce((s, w) => s + w, 0), 100)
      assert.ok(weights.every(w => Number.isInteger(w) && w >= 1))
    }
  })

  it('poids ramenés à un autre total : proportions gardées, petits poids non gonflés', () => {
    // Place faite à un critère ajouté (5 points) : les dix critères passent de 100 à 95.
    assert.deepEqual(weightsSummingTo(10, 95, [35, 20, 12, 11, 10, 3, 3, 2, 2, 2]), [33, 19, 11, 10, 10, 3, 3, 2, 2, 2])
    // Déjà à 100 : rien ne bouge.
    assert.deepEqual(weightsSummingTo(10, 100, [35, 20, 12, 11, 10, 3, 3, 2, 2, 2]), [35, 20, 12, 11, 10, 3, 3, 2, 2, 2])
    // Une part nulle reçoit 1, pris au premier des plus gros poids.
    assert.deepEqual(weightsSummingTo(3, 100, [0, 50, 50]), [1, 49, 50])
  })

  it('empreinte : change avec les libellés et le nom d’un critère ajouté, pas avec les poids ni ★', () => {
    const base = criteriaFingerprint(javaAngular())
    const weights = javaAngular()
    weights.criteria[0].labels[0].weight = 50
    weights.criteria[0].labels[1].weight = 50
    weights.criteria[0].labels[1].required = true
    weights.criteria[0].weight = 50
    weights.criteria[2].weight = 20
    assert.equal(criteriaFingerprint(weights), base)
    const label = javaAngular()
    label.criteria[1].labels[1].label = 'React'
    assert.notEqual(criteriaFingerprint(label), base)
    const name = javaAngular()
    name.criteria[2].name = 'Expérience assurance'
    assert.notEqual(criteriaFingerprint(name), base)
    assert.match(base, /^[0-9a-f]{8}$/)
  })

  it('relit des critères enregistrés ; illisibles ou invalides : null', () => {
    assert.deepEqual(parseCriteriaSet(JSON.stringify(javaAngular())), CriteriaSetSchema.parse(javaAngular()))
    assert.equal(parseCriteriaSet('{'), null)
    assert.equal(parseCriteriaSet(''), null)
    assert.equal(parseCriteriaSet(JSON.stringify({ ...javaAngular(), version: 2 })), null)
  })

  it('libellés requis et identifiant d’un nouveau critère', () => {
    assert.deepEqual(requiredLabels(javaAngular()), ['Développeur Java', 'Java'])
    assert.deepEqual(requiredLabels(javaAngular(), 'competences'), ['Java'])
    assert.equal(nextCustomId(javaAngular()), 'x2')
  })
})
