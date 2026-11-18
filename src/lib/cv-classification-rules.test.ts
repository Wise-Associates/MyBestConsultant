import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRuleVocabulary, classifyCvByRules } from './cv-classification-rules'
import { CLASSIFICATION_LIMITS, CLASSIFICATION_VERSION, RULES_MODEL, isUpToDate } from './cv-classification'

const now = new Date('2026-11-18T10:00:00.000Z')
const vocabulary = buildRuleVocabulary()

// CV fictifs, coordonnées déjà masquées comme dans le texte envoyé à l'IA.
const CV_FR = `Jean Exemple
Chef de projet SAP FI/CO
12 rue des Lilas, 69003 Lyon
‹téléphone masqué› · ‹e-mail masqué›
Disponible immédiatement · TJM : 650 € HT

EXPÉRIENCES PROFESSIONNELLES
Janv. 2020 – Aujourd'hui · Chef de projet SAP · Banque Exemple (BNP Paribas)
- Pilotage du déploiement SAP S/4HANA, recueil des besoins, recette fonctionnelle
- Animation des comités, suivi budgétaire, MS Project, Jira
Mars 2016 – Décembre 2019 · Consultant SAP FI/CO · Sopra Steria
- Paramétrage SAP FI, tableaux de bord sous Power BI, requêtes SQL
2013 - 2016 · Analyste programmeur · Assureur Exemple (AXA)
- Développement Java, assurance qualité des livrables

FORMATION
2008 - 2013 · Diplôme d'ingénieur, École Exemple
2008 · Baccalauréat S

CERTIFICATIONS
PMP (2018), ITIL v4 Foundation, Professional Scrum Master PSM I

LANGUES
Français : langue maternelle
Anglais : courant (TOEIC 905)
Espagnol : notions`

const CV_EN = `Alex Example
Senior Full Stack Developer
Based in Paris, France
Available: 1 month notice

Experience
2021 – present  Full Stack Developer, Fintech Example
React, Node.js, TypeScript, PostgreSQL, Docker, Kubernetes, AWS; go-live of the payment platform
2018 – 2021  Software Engineer, Retail Example
Built REST APIs in Java with Spring Boot.

Education
2014 – 2018  MSc Computer Science

Languages
English: native · French: fluent (C1)`

describe('classification d\'un CV sans IA, par règles (ADR 0044)', () => {
  it('lit un CV français : métiers, famille, compétences, expérience, études, langues, lieu, TJM', () => {
    const c = classifyCvByRules(CV_FR, vocabulary, now)
    assert.equal(c.version, CLASSIFICATION_VERSION)
    assert.deepEqual(c.roles, ['Chef de projet', 'Consultant SAP FI/CO', 'Analyste programmeur'])
    assert.equal(c.jobFamily, 'pilotage_projet')
    for (const skill of ['SAP S/4HANA', 'SAP FI/CO', 'SAP FI', 'SAP', 'Recueil des besoins', 'Recette', 'MS Project', 'Jira', 'Power BI', 'SQL', 'Java', 'Suivi budgétaire']) {
      assert.ok(c.skills.includes(skill), `compétence attendue : ${skill} (trouvées : ${c.skills.join(', ')})`)
    }
    // « BI » est dans « Power BI », « Chef » dans « Chef de projet » : jamais comptés seuls.
    assert.ok(!c.skills.includes('BI') && !c.skills.some(s => /^chef$/i.test(s)))
    // Janv. 2020 – nov. 2026 (83 mois) + mars 2016 – déc. 2019 (46) + 2013 – 2016 (36) ; la formation n'est pas comptée.
    assert.equal(c.yearsOfExperience, 14)
    assert.equal(c.seniority, 'senior')
    assert.equal(c.educationLevel, 'bac+5')
    assert.deepEqual(c.certifications, ['PMP', 'ITIL', 'PSM'])
    assert.deepEqual(c.languages, [{ name: 'Français', level: 'natif' }, { name: 'Anglais', level: 'courant' }, { name: 'Espagnol', level: 'notions' }])
    assert.deepEqual([c.city, c.country], ['Lyon', 'France'])
    assert.equal(c.dailyRate, 650)
    assert.equal(c.availability, 'Immédiate')
    // « assurance qualité » n'est pas le secteur de l'assurance ; AXA et « Assureur », si.
    assert.deepEqual(c.sectors, ['banque', 'assurance', 'conseil_services'])
    // Ni clients ni résumé sans IA : trop risqué à deviner.
    assert.deepEqual([c.clients, c.summary], [[], ''])
  })

  it('lit un CV anglais avec les mêmes listes', () => {
    const c = classifyCvByRules(CV_EN, vocabulary, now)
    assert.deepEqual(c.roles, ['Développeur Full Stack', 'Ingénieur logiciel'])
    assert.equal(c.jobFamily, 'developpement')
    for (const skill of ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Kubernetes', 'AWS', 'Java', 'Spring Boot', 'API REST']) {
      assert.ok(c.skills.includes(skill), `compétence attendue : ${skill} (trouvées : ${c.skills.join(', ')})`)
    }
    // « go-live » n'est pas le langage Go.
    assert.ok(!c.skills.some(s => /^go(lang)?$/i.test(s)))
    // 2021 – nov. 2026 (71 mois) + 2018 – 2021 (36).
    assert.equal(c.yearsOfExperience, 9)
    assert.equal(c.educationLevel, 'bac+5')
    assert.deepEqual(c.languages, [{ name: 'Anglais', level: 'natif' }, { name: 'Français', level: 'courant' }])
    assert.deepEqual([c.city, c.country], ['Paris', 'France'])
    assert.equal(c.availability, 'Préavis de 1 mois')
  })

  it('ne prend pas un mot courant pour une compétence, un diplôme ou un secteur', () => {
    const text = `Chef de projet
Vue d'ensemble du programme ; go-live en spring 2020 ; Scrum Master de l'équipe.
Gestion des licences Microsoft, assurance qualité, banque de données clients, couche transport TCP.
Garantir la disponibilité des applications.`
    const c = classifyCvByRules(text, vocabulary, now)
    for (const word of ['Chef', 'Vue', 'Go', 'Spring']) assert.ok(!c.skills.includes(word), word)
    assert.ok(c.skills.includes('Scrum'))
    assert.equal(c.educationLevel, 'non_precise')
    assert.deepEqual(c.sectors, [])
    // « disponibilité » loin de l'en-tête : une phrase de mission, pas une disponibilité.
    assert.equal(c.availability, '')
    assert.equal(c.yearsOfExperience, null)
    assert.equal(c.seniority, null)
  })

  it('compte une seule fois les périodes qui se chevauchent, et préfère les années écrites', () => {
    const overlapping = `Expériences
Janvier 2018 - Décembre 2021 · Développeur Java
Juin 2020 - Décembre 2021 · Freelance en parallèle
depuis janvier 2022 · Tech Lead`
    // Janv. 2018 – nov. 2026 sans trou ni double compte : 107 mois.
    assert.equal(classifyCvByRules(overlapping, vocabulary, now).yearsOfExperience, 9)
    assert.equal(classifyCvByRules(`Consultant SAP, 12 ans d'expérience\n2024 - 2025 · Consultant SAP`, vocabulary, now).yearsOfExperience, 12)
  })

  it('garde dans le parcours les expériences qui suivent un « Environnement technique »', () => {
    const inline = `Expériences
2020 - 2026 · Chef de projet
Environnement technique : Jira, Git
2010 - 2016 · Analyste programmeur
- Java`
    const bare = inline.replace('Environnement technique : Jira, Git', 'Environnement technique\nJira, Git')
    for (const text of [inline, bare]) {
      const c = classifyCvByRules(text, vocabulary, now)
      // Janv. 2020 – janv. 2026 (72 mois) + janv. 2010 – janv. 2016 (72).
      assert.deepEqual([c.roles, c.yearsOfExperience], [['Chef de projet', 'Analyste programmeur'], 12], text)
      assert.ok(c.skills.includes('Jira') && c.skills.includes('Git'))
    }
  })

  it('ne prend pas les années d\'un outil pour celles du parcours', () => {
    const text = `Expériences
2020 - 2026 · Chef de projet
- 2 ans d'expérience sur Jira
2010 - 2016 · Analyste programmeur`
    assert.equal(classifyCvByRules(text, vocabulary, now).yearsOfExperience, 12)
  })

  it('lit un TJM écrit avec un séparateur de milliers', () => {
    assert.equal(classifyCvByRules('Tarif : 1 200 €/jour', vocabulary, now).dailyRate, 1200)
    assert.equal(classifyCvByRules('TJM : 1 200 € HT', vocabulary, now).dailyRate, 1200)
    assert.equal(classifyCvByRules('TJM : 15 000 €', vocabulary, now).dailyRate, null)
  })

  it('ne prend pas « L3 » ou « licence Oracle » pour un diplôme hors d\'une rubrique Formation', () => {
    const text = 'Expériences\n2020 - 2022 · Support applicatif niveau L3\nGestion de la licence Oracle, flux M2M'
    assert.equal(classifyCvByRules(text, vocabulary, now).educationLevel, 'non_precise')
    assert.equal(classifyCvByRules('Ingénieur DevOps\nDiplôme d\'ingénieur, École Exemple (2012)', vocabulary, now).educationLevel, 'bac+5')
  })

  it('reconnaît les noms d\'entreprises en capitales, pas un mot courant', () => {
    assert.deepEqual(classifyCvByRules('Missions chez BNP PARIBAS puis SOCIETE GENERALE', vocabulary, now).sectors, ['banque'])
    assert.deepEqual(classifyCvByRules('Charte graphique bleu et orange', vocabulary, now).sectors, [])
    assert.deepEqual(classifyCvByRules('Opérateur : Orange Business', vocabulary, now).sectors, ['telecom'])
  })

  it('lit les compétences d\'une liste séparée par des tirets', () => {
    const c = classifyCvByRules('Compétences : Java-Spring Boot-Docker-Kubernetes', vocabulary, now)
    for (const skill of ['Java', 'Spring Boot', 'Docker', 'Kubernetes']) assert.ok(c.skills.includes(skill), skill)
  })

  it('arrête la ville au nom qui suit le code postal', () => {
    assert.equal(classifyCvByRules('69003 Lyon Chef de projet SAP', vocabulary, now).city, 'Lyon')
    assert.equal(classifyCvByRules('17000 La Rochelle', vocabulary, now).city, 'La Rochelle')
    assert.equal(classifyCvByRules('92100 Boulogne-Billancourt Cedex', vocabulary, now).city, 'Boulogne-Billancourt')
  })

  it('lit les langues hors d\'une rubrique seulement avec un niveau', () => {
    const c = classifyCvByRules('Projet pour une banque française. Allemand : bilingue. Italien (B2).', vocabulary, now)
    assert.deepEqual(c.languages, [{ name: 'Allemand', level: 'bilingue' }, { name: 'Italien', level: 'intermediaire' }])
  })

  it('déduit la famille des compétences quand aucun métier n\'est reconnu', () => {
    const c = classifyCvByRules('Missions : Kubernetes, Terraform, Ansible, AWS, Docker, Jira, Python.', vocabulary, now)
    assert.deepEqual(c.roles, [])
    assert.equal(c.jobFamily, 'infrastructure_cloud')
    assert.equal(classifyCvByRules('Rien de reconnaissable ici.', vocabulary, now).jobFamily, 'autre')
  })

  it('trouve la ville dans les grandes villes connues quand il n\'y a pas de code postal', () => {
    const c = classifyCvByRules('Ingénieur DevOps\nAntananarivo, Madagascar\nDocker, Kubernetes', vocabulary, now)
    assert.deepEqual([c.city, c.country], ['Antananarivo', 'Madagascar'])
    assert.equal(classifyCvByRules('Data Analyst\nVit en Belgique\nSQL', vocabulary, now).country, 'Belgique')
  })

  it('borne les listes comme une classification par l\'IA', () => {
    const many = Array.from({ length: 80 }, (_, i) => `Outil${i}`)
    const vocab = buildRuleVocabulary({ skills: many })
    const c = classifyCvByRules(many.join(', '), vocab, now)
    assert.equal(c.skills.length, CLASSIFICATION_LIMITS.skills)
  })

  it('écrit la disponibilité sous une forme fermée, jamais le texte qui la suit', () => {
    const availability = (header: string) => classifyCvByRules(header, vocabulary, now).availability
    assert.equal(availability('Jean Exemple – Disponible immédiatement – né le 12/03/1985 à Lyon'), 'Immédiate')
    assert.equal(availability('Available from January 2027 John Example Paris Area'), 'À partir de janvier 2027')
    assert.equal(availability('Disponibilité : 01/03/2027'), 'À partir du 01/03/2027')
    assert.equal(availability('Préavis de 2 mois'), 'Préavis de 2 mois')
    assert.equal(availability('Disponible selon projet, contact Jean Exemple'), '')
  })

  it('reste rapide avec un vocabulaire piégé (termes faits de tirets) sur un CV plein de tirets', () => {
    const trapped = buildRuleVocabulary({ skills: ['- - - a', 'a -- b', 'x-y-z w'], roles: ['- - - - - a'] })
    for (const text of ['-'.repeat(12_000), '- '.repeat(6_000), `a${'-'.repeat(11_000)}b`]) {
      const started = performance.now()
      classifyCvByRules(text, trapped, now)
      assert.ok(performance.now() - started < 1500, `classement trop lent (${text.slice(0, 10)}…)`)
    }
  })

  it('reste rapide sur un texte hostile', () => {
    const hostile = `${'2019 - 2020 Janv. '.repeat(400)}${'a'.repeat(4000)}${' SAP SAP-FI SAP FI/CO'.repeat(200)}`
    const started = performance.now()
    classifyCvByRules(hostile.slice(0, 12_000), vocabulary, now)
    assert.ok(performance.now() - started < 1500, 'classement trop lent')
  })
})

describe('vocabulaire des règles', () => {
  it('ajoute les compétences de l\'index sans doublon, sans qualité personnelle, donnée sensible ni mot ambigu', () => {
    const vocab = buildRuleVocabulary({
      skills: ['javascript', 'Autonomie', 'Rigueur et sens du détail', 'Snowflake Cortex', 'Une compétence décrite par une très longue phrase', 'Go', 'Bon relationnel', 'RQTH', 'Travailleur handicapé', '- - - a'],
      roles: ['Chef de projet MOA', 'Chef de projet'],
    })
    const names = new Set(vocab.skills.map(t => t.name))
    assert.ok(names.has('JavaScript') && !names.has('javascript'))
    assert.ok(names.has('Snowflake Cortex'))
    for (const dropped of ['Autonomie', 'Rigueur et sens du détail', 'Une compétence décrite par une très longue phrase', 'Bon relationnel', 'RQTH', 'Travailleur handicapé', '- - - a']) assert.ok(!names.has(dropped), dropped)
    // « Go » d'une offre n'est pas une écriture reconnue (« go-live ») ; le langage reste reconnu écrit « Golang ».
    assert.ok(!vocab.skills.some(t => t.variants.some(v => v.toLowerCase() === 'go')))
    assert.equal(vocab.roles.filter(t => t.name === 'Chef de projet').length, 1)
    assert.ok(vocab.roles.some(t => t.name === 'Chef de projet MOA'))
    assert.ok(classifyCvByRules('Mise en place de Snowflake Cortex', vocab, now).skills.includes('Snowflake Cortex'))
  })
})

describe('classification à refaire', () => {
  it('refait par l\'IA une classification faite par les règles', () => {
    const stored = { sourceKey: 'f:abc', version: CLASSIFICATION_VERSION, model: 'claude-haiku-5-5' }
    assert.equal(isUpToDate(stored, 'f:abc'), true)
    assert.equal(isUpToDate({ ...stored, model: RULES_MODEL }, 'f:abc'), false)
    assert.equal(isUpToDate(stored, 'f:autre'), false)
    assert.equal(isUpToDate({ ...stored, version: CLASSIFICATION_VERSION - 1 }, 'f:abc'), false)
    assert.equal(isUpToDate(null, 'f:abc'), false)
    // Classement sans IA (npm run cv:classify -- --rules) : une classification par les règles suffit.
    assert.equal(isUpToDate({ ...stored, model: RULES_MODEL }, 'f:abc', { acceptRules: true }), true)
    assert.equal(isUpToDate({ ...stored, model: RULES_MODEL }, 'f:autre', { acceptRules: true }), false)
  })
})
