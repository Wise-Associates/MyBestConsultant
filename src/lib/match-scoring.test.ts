import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CV_CHARS_FOR_SCORING, DOMAIN_CAP, MISSING_CAP, ROLE_CAP, SCALES, judgedResult, matchRules, matchToCarry, criteriaCounts, cvTextForScoring,
  offerDetails, parseFit, parseScoringNotes, scoringSystemPrompt, scoringUserMessage, type OfferCriteria, criteriaBlock, judgedScore,
  judgementFields, judgementSummary, offerCriteria, offerRequirements, offerTextForAi, parseJudgements, parseTitleRelations, recommendationFor,
  requiredSkills, rolePairs, titleCheckPrompt, withBonus, withTitleRelations, type ActiveScale, type MatchJudgements,
  CURRENT_WEIGHTS_VERSION, WEIGHT_VERSIONS, scaleKeys, SOURCE_CONTEXT_CHARS, sourceContextForScoring,
} from './match-scoring'

describe('deux barèmes : matching des CV disponibles, score final de l\'AO (ADR 0036)', () => {
  it('les poids de chaque barème font 100, dans l\'ordre du tableau des recruteurs', () => {
    for (const scale of ['matching', 'final', 'legacy'] as const) {
      assert.equal(Object.values(SCALES[scale].weights).reduce((sum, w) => sum + (w ?? 0), 0), 100, scale)
    }
    assert.deepEqual(Object.keys(SCALES.matching.weights),
      ['poste', 'exigences', 'projet', 'competences', 'localisation', 'niveau', 'formation', 'domaine', 'langue', 'tjm'])
    assert.deepEqual(Object.keys(SCALES.final.weights), ['poste', 'exigences', 'projet', 'competences', 'client', 'localisation', 'niveau'])
  })

  it('lit un critère à une seule valeur, accents et casse compris ; inconnu sinon', () => {
    assert.equal(parseFit('oui', 'non requis'), 'oui')
    assert.equal(parseFit(' Non ', 'non requis'), 'non')
    assert.equal(parseFit('PARTIEL', 'non précisé'), 'partiel')
    assert.equal(parseFit('non-requis', 'non requis'), 'non requis')
    assert.equal(parseFit('non précisé', 'non requis'), 'non requis', 'valeur neutre du critère, quelle que soit celle écrite')
    assert.equal(parseFit(undefined, 'non requis'), null)
    assert.equal(parseFit('peut-être', 'non précisé'), null)
  })

  it('les consignes comparent les expériences du CV à l\'offre, exigent une preuve, et ne demandent aucune note', () => {
    const rules = matchRules('matching')
    assert.match(rules, /Évalue le candidat sur 10 critères, sans donner de note/)
    assert.match(rules, /une compétence ou un outil ne la prouve pas/)
    assert.match(rules, /1\. "poste" : le titre de l'offre/)
    assert.match(rules, /métier du titre non exercé ne se compense pas/)
    assert.match(rules, /tout "oui" des listes "exigences" et "competences" recopie dans "citation" une ligne d'expérience du CV/)
    assert.match(rules, /"intitule" : l'intitulé exact/)
    assert.match(rules, /ravailler dans une équipe agile ou avec des développeurs n'est pas exercer ces métiers/)
    assert.match(rules, /2\. "exigences" : le contexte et la description de l'offre/)
    assert.match(rules, /comptée sur les expériences du même métier/)
    for (const field of ['"projet"', '"localisation"', '"formation"', '"langue"', '"tjm"']) assert.ok(rules.includes(field), field)
    assert.doesNotMatch(rules, /"client"/)
  })

  it('score final : l\'expérience et l\'environnement du client, jamais les diplômes', () => {
    const rules = matchRules('final')
    assert.match(rules, /Évalue le candidat sur 7 critères/)
    assert.match(rules, /jamais les diplômes/)
    assert.match(rules, /5\. "client" : l'environnement du client de l'offre/)
    for (const field of ['"formation"', '"langue"', '"tjm"', '"domaine"']) assert.ok(!rules.includes(field), field)
  })
})

describe('bonus (recommandations) ajouté au score de l\'IA', () => {
  it('ne fait jamais passer un candidat sous le seuil au-dessus de 65', () => {
    assert.equal(withBonus(60, 12), 64)
    assert.equal(withBonus(64, 1), 64)
    assert.equal(withBonus(50, 5), 55)
  })

  it('ajoute le bonus au-dessus du seuil, plafonné à 100', () => {
    assert.equal(withBonus(70, 12), 82)
    assert.equal(withBonus(95, 12), 100)
  })
})

describe('description de l\'offre envoyée à l\'IA', () => {
  const missions = Array.from({ length: 40 }, (_, i) => `- Mission fictive numéro ${i + 1} sur le projet`).join('\n')
  const description = `### Contexte\nGrand groupe fictif.\n\n### Missions\n${missions}\n\n### Profil recherché\n- Expérience de la banque de détail exigée\n- Java, Spring`

  it('met le profil recherché en premier : coupée, la description garde l\'exigence du domaine', () => {
    const text = offerTextForAi(description, 400)
    assert.ok(text.length <= 400, `${text.length}`)
    assert.match(text, /^### Profil recherché/)
    assert.match(text, /banque de détail exigée/)
  })

  it('garde tout le texte quand il tient, et le texte brut quand il n\'a pas de sections', () => {
    assert.match(offerTextForAi(description, 10_000), /Mission fictive numéro 40/)
    assert.equal(offerTextForAi('Développeur Java fictif, banque.', 100), 'Développeur Java fictif, banque.')
    assert.equal(offerTextForAi('x'.repeat(500), 100), 'x'.repeat(100))
  })
})

describe('recommandation d\'un score plafonné', () => {
  it('suit le barème : un 60 n\'est jamais « top »', () => {
    assert.equal(recommendationFor(95), 'top')
    assert.equal(recommendationFor(80), 'good')
    assert.equal(recommendationFor(60), 'average')
    assert.equal(recommendationFor(45), 'weak')
    assert.equal(recommendationFor(10), 'reject')
  })
})

describe('exigences de l\'offre tirées de sa description (les mêmes pour tous les candidats)', () => {
  const description = `### Contexte\nGrand groupe fictif.\n\n### Missions\n- Animer les cérémonies Scrum\n- Développer des API Node.js\n\n### Profil recherché\n- 5 ans de développement full stack\n- **Expérience** de Scrum Master\n- Développer des API Node.js`

  it('profil recherché d\'abord, puis missions, sans doublon ni gras, 10 au plus', () => {
    assert.deepEqual(offerRequirements(description), [
      '5 ans de développement full stack', 'Expérience de Scrum Master', 'Développer des API Node.js', 'Animer les cérémonies Scrum',
    ])
    const long = `### Missions\n${Array.from({ length: 30 }, (_, i) => `- Mission fictive ${i}`).join('\n')}`
    assert.equal(offerRequirements(long).length, 10)
  })

  it('aucune exigence pour une description sans liste : l\'IA juge alors l\'ensemble', () => {
    assert.deepEqual(offerRequirements('Développeur fictif pour une banque.'), [])
    assert.match(criteriaBlock(offerCriteria([], 'Développeur fictif pour une banque.')), /Exigences de l'offre : aucune liste/)
  })

  it('numérote exigences et compétences pour l\'IA, dans l\'ordre de ses réponses', () => {
    const block = criteriaBlock(offerCriteria(['Java', 'java', ' Spring '], description))
    assert.match(block, /Exigences de l'offre \(réponds dans cet ordre\) :\n1\. 5 ans de développement full stack\n2\. Expérience de Scrum Master/)
    assert.match(block, /Compétences demandées \(réponds dans cet ordre\) :\n1\. Java\n2\. Spring$/)
    assert.equal(requiredSkills(Array.from({ length: 20 }, (_, i) => `C${i}`)).length, 12)
    assert.match(judgementFields('matching', { skills: 2, requirements: 3 }), /"exigences":\[\{"jugement":"oui"\|"partiel"\|"non","citation":"…"\}, …\] \(3 valeurs/)
    assert.match(judgementFields('matching', { skills: 0, requirements: 0 }), /"competences":\{"jugement":"oui"\|"partiel"\|"non","citation":"…"\}/)
    assert.match(judgementFields('final', { skills: 0, requirements: 0 }), /"poste":\[\{"metier":"…","exerce":"oui"\|"partiel"\|"non","intitule":"…"\}/)
    assert.match(judgementFields('matching'), /"langue":"oui"\|"partiel"\|"non"\|"non requis","tjm":"oui"\|"partiel"\|"non"\|"non précisé"$/)
    assert.match(judgementFields('final'), /"client":"oui"\|"partiel"\|"non"\|"non précisé"/)
    assert.match(judgementFields('matching'), /\(une valeur par exigence de la liste numérotée de l'offre, dans l'ordre ; sans liste, un seul objet\)/)
  })
})

// CV fictif construit sur le cas de production du 2026-11-04 (expert sécurité applicative noté 85 sur « Scrum Master et
// Développeur Full Stack »), plus une ancienne expérience de développeur pour les cas acceptés.
const CV = `Expert Application Security / Vulnerability Management — Cyberdéfense Fictive (depuis 2021)
- Définit et déploie la stratégie AppSec pour plusieurs squads de développement en environnement agile
- Intègre les outils SAST, DAST et SCA dans les pipelines CI/CD GitLab
Développeur Python — Banque Fictive (2016-2020)
- Développement d'API REST en Python avec Django et PostgreSQL pour le crédit immobilier
Compétences techniques : Python, Java, SQL, Docker, Kubernetes, Git`
const DEV_LINE = 'Développement d\'API REST en Python avec Django et PostgreSQL pour le crédit immobilier'
const criteria = { skills: ['Python', 'Kubernetes'], requirements: ['3 ans de développement d\'API', 'Animer les cérémonies Scrum'] }
const yes = (citation = DEV_LINE) => ({ jugement: 'oui', citation })
// Réponse avec les critères des deux barèmes : chaque barème ne lit que les siens.
const answer = (over: Record<string, unknown> = {}) => ({
  poste: [{ metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' }],
  exigences: [yes(), yes()], competences: [yes(), yes('Intègre les outils SAST, DAST et SCA dans les pipelines CI/CD GitLab')],
  projet: 'oui', client: 'partiel', localisation: 'oui', niveau: 'oui', formation: 'non requis', domaine: 'oui', langue: 'non requis',
  tjm: 'non précisé', ...over,
})
const parse = (raw: unknown, cv = CV, scale: ActiveScale = 'matching', c: OfferCriteria = criteria) => parseJudgements(raw, c, cv, scale)

describe('jugements vérifiés dans le CV (la réponse de l\'IA ne suffit pas)', () => {
  it('poste : l\'intitulé cité doit figurer dans le CV ; sans intitulé, le métier n\'est pas prouvé', () => {
    const roles = (poste: unknown) => parse(answer({ poste }))?.roles
    assert.deepEqual(roles([{ metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' }]),
      [{ title: 'Développeur Full Stack', fit: 'oui', cited: 'Développeur Python' }])
    assert.deepEqual(roles([{ metier: 'Scrum Master', exerce: 'oui', intitule: 'Scrum Master' }]),
      [{ title: 'Scrum Master', fit: 'partiel', cited: 'Scrum Master' }], 'intitulé absent du CV : un niveau de moins')
    assert.deepEqual(roles([{ metier: 'Scrum Master', exerce: 'oui' }]), [{ title: 'Scrum Master', fit: 'non', cited: '' }])
  })

  it('poste : la comparaison des intitulés (même métier, même famille, autre métier) décide, sans liste de mots', () => {
    const j = parse(answer({ poste: [
      { metier: 'Scrum Master', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
      { metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' },
      { metier: 'Ingénieur sécurité', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
    ] }))
    assert.ok(j)
    assert.deepEqual(rolePairs(j).map(p => p.metier), ['Scrum Master', 'Développeur Full Stack', 'Ingénieur sécurité'])
    const fits = (relations: Parameters<typeof withTitleRelations>[1]) => withTitleRelations(j, relations).roles.map(r => r.fit)
    assert.deepEqual(fits(['autre', 'meme', 'famille']), ['non', 'oui', 'partiel'])
    // Vérification impossible (IA indisponible) : jamais « oui » sans elle, « partiel » au plus.
    assert.deepEqual(fits([null, null, null]), ['partiel', 'partiel', 'partiel'])
  })

  it('lit la comparaison des intitulés ; une valeur illisible ou absente est inconnue', () => {
    assert.deepEqual(parseTitleRelations('Voici : ["autre", "MÊME", "famille"]', 4), ['autre', 'meme', 'famille', null])
    assert.deepEqual(parseTitleRelations('["peut-être"]', 1), [null])
    // Longueur exigée (MBC Search, longues listes) : une valeur manquante décalerait les avis suivants.
    assert.deepEqual(parseTitleRelations('["meme", "autre"]', 3, true), [null, null, null])
    assert.deepEqual(parseTitleRelations('["meme", "autre", "famille"]', 3, true), ['meme', 'autre', 'famille'])
    assert.deepEqual(parseTitleRelations('aucun tableau', 2), [null, null])
    const prompt = titleCheckPrompt([{ metier: 'Scrum Master', intitule: 'Expert Application Security' }])
    assert.match(prompt.user, /1\. Métier demandé : « Scrum Master » — intitulé du CV : « Expert Application Security »/)
    assert.match(prompt.system, /"meme"\|"famille"\|"autre"/)
  })

  it('compétence « oui » : une ligne d\'expérience du CV qui la nomme, pas la liste des compétences', () => {
    const skills = (competences: unknown[]) => parse(answer({ competences }))?.skills
    assert.deepEqual(skills([yes(), yes()]), ['oui', 'partiel'], 'Kubernetes absent de la ligne citée')
    assert.deepEqual(skills([yes('Compétences techniques : Python, Java, SQL, Docker, Kubernetes, Git'), { jugement: 'non' }]),
      ['partiel', 'non'], 'liste de mots-clés')
    assert.deepEqual(skills([yes('Développement full stack React et Node.js pour un site marchand'), { jugement: 'partiel' }]),
      ['partiel', 'partiel'], 'citation absente du CV')
    assert.deepEqual(skills(['oui', 'oui']), ['partiel', 'partiel'], 'sans citation')
  })

  it('exigence « oui » : une ligne d\'au moins 5 mots retrouvée dans le CV', () => {
    const reqs = (exigences: unknown[]) => parse(answer({ exigences }))?.requirements
    assert.deepEqual(reqs([yes(), yes('Définit et déploie la stratégie AppSec')]), ['oui', 'oui'])
    assert.deepEqual(reqs([yes('Python Django'), yes('A animé les cérémonies Scrum de trois équipes')]), ['partiel', 'partiel'])
  })

  it('cas de production : expert sécurité applicative sur « Scrum Master et Développeur Full Stack » → 50 au plus', () => {
    // Réponse de l'IA relevée le 2026-11-04 (66 avant vérification), puis comparaison des intitulés : deux « autre ».
    const security = 'Définit et déploie la stratégie AppSec pour plusieurs squads de développement en environnement agile'
    const j = parse({
      poste: [
        { metier: 'Scrum Master', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
        { metier: 'Développeur Full Stack', exerce: 'partiel', intitule: 'Expert Application Security / Vulnerability Management' },
      ],
      exigences: [yes(security), yes(security)],
      competences: [yes('Compétences techniques : Python, Java, SQL, Docker, Kubernetes, Git'), { jugement: 'partiel' }],
      projet: 'partiel', localisation: 'oui', niveau: 'partiel', formation: 'non requis', domaine: 'partiel', langue: 'non requis', tjm: 'non précisé',
    })
    assert.ok(j)
    const checked = withTitleRelations(j, ['autre', 'autre'])
    assert.deepEqual(checked.roles.map(r => r.fit), ['non', 'non'])
    assert.ok(judgedScore(checked) <= ROLE_CAP.non, `${judgedScore(checked)}`)
  })
})

describe('score calculé à partir des jugements de l\'IA (stable d\'un calcul à l\'autre)', () => {
  it('lit les jugements du barème ; un élément oublié vaut « non »', () => {
    const j = parse(answer({ competences: [yes()], exigences: [yes(), { jugement: 'partiel' }] }))
    assert.deepEqual(j, {
      scale: 'matching',
      roles: [{ title: 'Développeur Full Stack', fit: 'oui', cited: 'Développeur Python' }], requirements: ['oui', 'partiel'], requirementsListed: true,
      skills: ['oui', 'non'], skillsListed: true,
      fits: { projet: 'oui', localisation: 'oui', niveau: 'oui', formation: 'non requis', domaine: 'oui', langue: 'non requis', tjm: 'non précisé' },
    })
    assert.deepEqual(parse(answer(), CV, 'final')?.fits, { projet: 'oui', client: 'partiel', localisation: 'oui', niveau: 'oui' })
  })

  it('sans liste dans l\'offre, un jugement d\'ensemble', () => {
    const j = parse(answer({ competences: yes(), exigences: { jugement: 'non' } }), CV, 'matching', { skills: [], requirements: [] })
    assert.equal(j?.skillsListed, false)
    assert.deepEqual(j?.skills, ['oui'])
    assert.deepEqual(j?.requirements, ['non'])
  })

  it('refuse une réponse à laquelle manque un critère du barème (le candidat reste à noter)', () => {
    for (const missing of ['poste', 'exigences', 'projet', 'competences', 'localisation', 'niveau', 'formation', 'domaine', 'langue', 'tjm']) {
      assert.equal(parse(answer({ [missing]: undefined })), null, missing)
    }
    assert.equal(parse(answer({ client: undefined }), CV, 'final'), null, 'client')
    assert.ok(parse(answer({ formation: undefined, langue: 'peut-être' }), CV, 'final'), 'critères du matching seulement')
    assert.equal(parse(answer({ poste: [{ metier: 'X', exerce: 'peut-être' }] })), null)
    assert.equal(parse('texte'), null)
  })

  const ALL_YES = { projet: 'oui', client: 'oui', localisation: 'oui', niveau: 'oui', formation: 'oui', domaine: 'oui', langue: 'oui', tjm: 'oui' } as const
  const judged = (over: Partial<MatchJudgements> = {}, fits: MatchJudgements['fits'] = {}, scale: ActiveScale = 'matching'): MatchJudgements => ({
    scale, roles: [{ title: '', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
    skills: ['oui', 'oui'], skillsListed: true, fits: { ...ALL_YES, ...fits }, ...over,
  })

  it('matching (poids v2 du 2026-11-19) : poste 35, techno 20, localisation 12, secteur 11, séniorité 10, contexte 3, projet 3, formation 2, langue 2, TJM 2', () => {
    assert.equal(judgedScore(judged()), 100)
    assert.equal(judgedScore(judged({}, { tjm: 'non' })), 98, 'critère blanc : sans plafond')
    assert.equal(judgedScore(judged({}, { projet: 'non', tjm: 'partiel' })), 96)
    // Contexte 3 × 0,75 et techno 20 × 0,5 : 100 − 0,75 − 10 = 89,25.
    assert.equal(judgedScore(judged({ requirements: ['oui', 'partiel'], skills: ['oui', 'non'] }, { domaine: 'non requis', niveau: 'non précisé' })), 89)
  })

  it('score final (poids v2) : poste 35, techno 20, localisation 12, client 11, séniorité 10, contexte 6, projet 6 ; diplômes absents', () => {
    assert.equal(judgedScore(judged({}, {}, 'final')), 100)
    assert.equal(judgedScore(judged({}, { formation: 'non', langue: 'non', domaine: 'non', tjm: 'non' }, 'final')), 100, 'hors du barème final')
    assert.equal(judgedScore(judged({}, { localisation: 'non' }, 'final')), 88, 'localisation : blanche au score final')
    // Client partiel : 11 × 0,5 perdus, 94,5 arrondi.
    assert.equal(judgedScore(judged({}, { client: 'partiel' }, 'final')), 95)
  })

  it('poids par défaut : chaque version fait 100 par barème, dans l\'ordre des critères du barème ; la version actuelle est celle des barèmes', () => {
    for (const [version, scales] of Object.entries(WEIGHT_VERSIONS)) {
      for (const scale of ['matching', 'final'] as const) {
        assert.equal(Object.values(scales[scale]).reduce((sum, w) => sum + (w ?? 0), 0), 100, `v${version} ${scale}`)
        assert.deepEqual(Object.keys(scales[scale]), scaleKeys(scale), `v${version} ${scale} : ordre du résumé`)
      }
    }
    assert.equal(SCALES.matching.weights, WEIGHT_VERSIONS[CURRENT_WEIGHTS_VERSION].matching)
    assert.equal(SCALES.final.weights, WEIGHT_VERSIONS[CURRENT_WEIGHTS_VERSION].final)
  })

  it('critère rouge qui manque : plafonné sous 65, quel que soit le reste', () => {
    for (const red of ['localisation', 'niveau', 'formation', 'langue'] as const) {
      assert.equal(judgedScore(judged({}, { [red]: 'non' })), MISSING_CAP, red)
    }
    assert.equal(judgedScore(judged({}, { client: 'non' }, 'final')), MISSING_CAP)
    assert.ok(MISSING_CAP < 65)
    // Techno : moins d'un tiers des points manque ; un tiers pile ne plafonne pas.
    assert.equal(judgedScore(judged({ skills: ['oui', 'non', 'non', 'non'] })), MISSING_CAP)
    assert.equal(judgedScore(judged({ skills: ['oui', 'non', 'non'] })), 87)
    assert.equal(judgedScore(judged({ skills: ['non'] }, {}, 'final')), MISSING_CAP)
    // Neutre : jamais plafonné.
    assert.equal(judgedScore(judged({}, { langue: 'non requis', localisation: 'non précisé' })), 100)
  })

  it('titre à plusieurs métiers : un métier non exercé plafonne à 50 sans se compenser par l\'autre', () => {
    // « Scrum Master et Développeur Full Stack » (production, 2026-11-04) : un Scrum Master qui n'avait jamais développé était noté 85.
    const j = parse(answer({
      poste: [{ metier: 'Scrum Master', exerce: 'oui', intitule: 'Scrum Master' }, { metier: 'Développeur Full Stack', exerce: 'non' }],
    }), 'Scrum Master — Assureur Fictif (2019-2023)')
    assert.equal(j && judgedScore(j), ROLE_CAP.non)
    assert.ok(ROLE_CAP.non < 65)
    assert.equal(judgedScore(judged({ roles: [{ title: '', fit: 'partiel' }] })), ROLE_CAP.partiel)
  })

  it('le secteur exigé absent garde son plafond : jamais au-dessus de 60 ; le plus bas des plafonds l\'emporte', () => {
    assert.equal(judgedScore(judged({}, { domaine: 'non' })), DOMAIN_CAP.non)
    assert.equal(judgedScore(judged({}, { domaine: 'partiel' })), DOMAIN_CAP.partiel)
    const both = judgedResult(judged({ roles: [{ title: '', fit: 'non' }] }, { domaine: 'non' }))
    assert.deepEqual(both.cap, { value: ROLE_CAP.non, key: 'poste', level: 'non' })
    assert.equal(both.score, ROLE_CAP.non)
    assert.equal(judgedResult(judged({ roles: [{ title: '', fit: 'non' }], requirements: ['non'], skills: ['non'] }, { domaine: 'non' })).cap, null,
      'un plafond qui n\'abaisse rien n\'est pas signalé')
  })

  it('résume les jugements pour la raison affichée, dans l\'ordre du barème', () => {
    assert.equal(judgementSummary(judged({
      roles: [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }],
      requirements: ['oui', 'partiel', 'non'], skills: ['oui', 'non'],
    }, { domaine: 'non requis', tjm: 'non précisé' })), 'Poids v2 · Poste : Scrum Master oui, Développeur Full Stack non · Contexte : 1 sur 3, 1 partielle'
      + ' · Projet : oui · Techno : 1 sur 2 · Localisation : oui · Séniorité : oui · Formation : oui · Secteur : non requis · Langue : oui'
      + ' · TJM : non précisé', 'version des poids notée en tête')
    assert.equal(judgementSummary(judged({ requirements: ['partiel'], requirementsListed: false, skills: ['oui'], skillsListed: false }, {}, 'final')),
      'Poids v2 · Poste : oui · Contexte : partiel · Projet : oui · Techno : oui · Client : oui · Localisation : oui · Séniorité : oui')
  })
})

describe('une seule notation pour tous les candidats (ADR 0029)', () => {
  const listed: OfferCriteria = { skills: ['Python', 'React'], requirements: ['5 ans de développement'] }
  const offer = { title: 'Développeur Full Stack', description: 'Développement d\'applications web.' }

  it('demande les champs du barème à l\'IA, avec les mêmes notes quelle que soit la provenance du candidat', () => {
    for (const scale of ['matching', 'final'] as const) {
      const system = scoringSystemPrompt(scale, criteriaCounts(listed))
      for (const field of ['"poste"', '"exigences"', '"competences"', '"niveau"', '"points_forts"', '"vigilances"', '"raison"', '"resume"']) {
        assert.ok(system.includes(field), `${scale} ${field}`)
      }
      assert.ok(system.includes(matchRules(scale)), scale)
      assert.doesNotMatch(system, /"score"/, 'l\'IA ne donne pas de note')
      assert.doesNotMatch(system, /competences_vues/, 'compétences listées par l\'offre : déjà jugées une à une')
    }
    assert.match(scoringSystemPrompt('final', criteriaCounts({ skills: [], requirements: [] })), /"competences_vues"/)
  })

  it('précisions de l\'offre : lieu, télétravail, rémunération, clients sans doublon', () => {
    assert.deepEqual(offerDetails({ location: ' Paris ', remote: 'hybrid', salary: 600, contractType: 'freelance' }, ['BNP Paribas', '', ' BNP Paribas ', 'Grand groupe bancaire']),
      ['Lieu : Paris', 'Télétravail : partiel', 'TJM : 600 €/jour', 'Client : BNP Paribas, Grand groupe bancaire'])
    assert.deepEqual(offerDetails({ salary: 55000, contractType: 'cdi' }), ['Salaire : 55 000 €/an'])
    assert.deepEqual(offerDetails({ location: 42, salary: '600', remote: null }), [], 'champs illisibles : aucune ligne')
  })

  it('n\'envoie ni lettre de motivation ni critère ajouté : l\'offre et le CV seulement', () => {
    const message = scoringUserMessage(offer, listed, 'CV fictif')
    assert.match(message, /^=== OFFRE ===\nPoste : Développeur Full Stack\n/)
    assert.match(message, /1\. Python/)
    assert.match(message, /=== CV DU CANDIDAT ===\nCV fictif$/)
    assert.match(scoringUserMessage({ ...offer, details: ['Technologies : Python'] }, listed, 'CV'), /\nTechnologies : Python\nDescription : /)
  })

  it('offre publiée depuis un appel d’offres : sa description d’origine suit la description, avant le CV (contexte interne)', () => {
    const message = scoringUserMessage({ ...offer, sourceContext: 'Refonte de la chaîne de paiement de Banque Exemple.' }, listed, 'CV fictif')
    assert.match(message, /\nDescription : [^\n]*[\s\S]*\n\nContexte de l'appel d'offres d'origine \(usage interne[^\n]*\nRefonte de la chaîne de paiement de Banque Exemple\.\n\n=== CV DU CANDIDAT ===\nCV fictif$/)
    // Les listes jugées restent celles de l'offre relue : le contexte vient après elles.
    assert.ok(message.indexOf('1. Python') < message.indexOf('Contexte de l\'appel d\'offres'), message)
    // Sans contexte (offre ordinaire, AO supprimé) : message inchangé, notations gardées reprises du cache.
    assert.equal(scoringUserMessage({ ...offer, sourceContext: '' }, listed, 'CV'), scoringUserMessage(offer, listed, 'CV'))
    assert.ok(!scoringUserMessage(offer, listed, 'CV').includes('Contexte de l\'appel d\'offres'))
  })

  it('description d’origine d’un appel d’offres : coordonnées et liens de l’interlocuteur masqués, bornée', () => {
    const text = sourceContextForScoring(`Contexte : refonte du SI.\n\n\n\nContact : jean.martin@exemple.test · 06 07 08 09 10 · https://exemple.test/ao\n${'x'.repeat(10_000)}`)
    assert.ok(text.startsWith('Contexte : refonte du SI.\n\nContact : '), text.slice(0, 80))
    assert.ok(!text.includes('jean.martin@exemple.test') && !text.includes('06 07 08 09 10') && !text.includes('https://exemple.test'), text.slice(0, 200))
    assert.equal(text.length, SOURCE_CONTEXT_CHARS)
  })

  it('lit les notes de l\'IA, bornées ; une réponse sans notes donne des listes vides', () => {
    const notes = parseScoringNotes({
      raison: ' Manque le domaine bancaire. ', resume: 'Profil fictif solide.',
      points_forts: ['Python', 42, 'React', 'API', 'SQL', 'Docker'], vigilances: 'pas une liste',
      competences_vues: [{ nom: 'Python', jugement: 'oui' }, { nom: 'Go', jugement: 'peut-être' }, { nom: '', jugement: 'oui' }],
    })
    assert.equal(notes.reason, 'Manque le domaine bancaire.')
    assert.equal(notes.summary, 'Profil fictif solide.')
    assert.deepEqual(notes.strengths, ['Python', 'React', 'API', 'SQL'])
    assert.deepEqual(notes.concerns, [])
    assert.deepEqual(notes.namedSkills, [{ name: 'Python', match: 'oui' }])
    assert.deepEqual(parseScoringNotes(null), { reason: '', summary: '', strengths: [], concerns: [], namedSkills: [] })
  })

  it('masque les coordonnées du CV et le borne ; les preuves sont vérifiées dans ce même texte', () => {
    const text = cvTextForScoring(`Marie Fictive\nmarie@exemple.fr · 06 07 08 09 10\nDéveloppeuse Python (2018 - 2024)\n${'x'.repeat(20_000)}`)
    assert.doesNotMatch(text, /marie@exemple\.fr|06 07 08 09 10/)
    assert.match(text, /‹e-mail masqué› · ‹téléphone masqué›/)
    assert.match(text, /\(2018 - 2024\)/, 'une période n\'est pas un téléphone')
    assert.equal(text.length, CV_CHARS_FOR_SCORING)
  })

  it('garde les périodes, versions et références : seuls les vrais numéros de téléphone sont masqués', () => {
    for (const kept of ['Développeur 2016 - 2018 - 2020 Paris', 'Projet 2015 - 2018 2018 - 2020 Lyon', 'Python 3.11 - 3.12 - 2020 2021', 'Avis 2023/S 123-456789', '05.03.2020 - 12.06.2022']) {
      assert.equal(cvTextForScoring(kept), kept, kept)
    }
    for (const phone of ['06 07 08 09 10', '0607080910', '06.07.08.09.10', '+33 6 07 08 09 10', '+33 (0)6 07 08 09 10', '0033 6 07 08 09 10', '+44 20 7946 0958']) {
      assert.equal(cvTextForScoring(`Tél. ${phone} fin`), 'Tél. ‹téléphone masqué› fin', phone)
    }
  })

  it('masque un numéro coupé par un retour à la ligne et les liens (profil, site)', () => {
    assert.equal(cvTextForScoring('Tel 06 12 34\n56 78 fin'), 'Tel ‹téléphone masqué› fin')
    assert.equal(cvTextForScoring('linkedin.com/in/marie-fictive-1234 · https://exemple.fr/cv'), '‹lien masqué› · ‹lien masqué›')
    assert.equal(cvTextForScoring('www.github.com/mfictive'), '‹lien masqué›')
    assert.equal(cvTextForScoring('Node.js, Vue.js et ASP.NET'), 'Node.js, Vue.js et ASP.NET', 'une technologie n\'est pas un lien')
  })
})

describe('candidat ajouté au funnel depuis le Matching IA : son score de matching (historique)', () => {
  const shown = [
    { source: 'pool' as const, id: 'row-b', candidateId: 'cand-b', score: 95, reason: 'B' },
    { source: 'pool' as const, id: 'row-a', candidateId: 'cand-a', score: 30, reason: 'A' },
    { source: 'vivier' as const, id: 'cv-1', score: 70, reason: 'V' },
    { source: 'application' as const, id: 'app-1', candidateId: 'cand-c', score: 80, reason: 'C' },
  ]

  it('base candidats : le score du candidat vérifié par le serveur, jamais celui de la ligne envoyée par le navigateur', () => {
    assert.equal(matchToCarry(shown, { source: 'pool', id: 'row-a' }, 'cand-a')?.score, 30)
    // Ligne d'un autre candidat (95) envoyée avec le candidat A : le score de A, pas celui de B.
    assert.equal(matchToCarry(shown, { source: 'pool', id: 'row-b' }, 'cand-a')?.score, 30)
    assert.equal(matchToCarry(shown, { source: 'pool', id: 'row-b' }, 'cand-x'), undefined)
  })

  it('vivier : le CV vérifié par le serveur ; une candidature n\'est jamais reprise', () => {
    assert.equal(matchToCarry(shown, { source: 'vivier', id: 'cv-1' }, 'cand-y')?.score, 70)
    assert.equal(matchToCarry(shown, { source: 'vivier', id: 'row-b' }, 'cand-b'), undefined)
    assert.equal(matchToCarry(shown, { source: 'application', id: 'app-1' }, 'cand-c'), undefined)
  })
})
