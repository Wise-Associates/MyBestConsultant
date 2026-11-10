import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CV_CHARS_FOR_SCORING, DOMAIN_CAP, MATCH_RULES, ROLE_CAP, capFor, carriedScreening, matchToCarry, criteriaCounts, cvTextForScoring, parseScoringNotes,
  scoringSystemPrompt, scoringUserMessage, type OfferCriteria, cappedScore, criteriaBlock, judgedScore, judgementFields, judgementSummary, offerCriteria,
  offerRequirements, offerTextForAi, parseDomainFit, parseJudgements, parseTitleRelations, recommendationFor, requiredSkills, rolePairs,
  titleCheckPrompt, withBonus, withTitleRelations, type MatchJudgements,
} from './match-scoring'

describe('expérience du domaine demandé', () => {
  it('lit la réponse de l\'IA, accents et casse compris ; inconnue sinon', () => {
    assert.equal(parseDomainFit('oui'), 'oui')
    assert.equal(parseDomainFit(' Non '), 'non')
    assert.equal(parseDomainFit('PARTIEL'), 'partiel')
    assert.equal(parseDomainFit('non requis'), 'non requis')
    assert.equal(parseDomainFit('non-requis'), 'non requis')
    assert.equal(parseDomainFit(undefined), null)
    assert.equal(parseDomainFit('peut-être'), null)
  })

  it('un 95/100 sans l\'expérience du domaine exigé descend à 60, sous le seuil « correspond » (65)', () => {
    assert.equal(cappedScore(95, 'non'), DOMAIN_CAP.non)
    assert.ok(DOMAIN_CAP.non < 65)
    assert.equal(cappedScore(95, 'partiel'), DOMAIN_CAP.partiel)
    assert.equal(cappedScore(40, 'non'), 40, 'un score déjà bas ne monte pas')
  })

  it('laisse le score quand le domaine est présent, non exigé ou non renseigné', () => {
    assert.equal(cappedScore(95, 'oui'), 95)
    assert.equal(cappedScore(95, 'non requis'), 95)
    assert.equal(cappedScore(95, null), 95)
  })

  it('les consignes de l\'IA comparent les expériences du CV à l\'offre, exigent une preuve, et ne demandent aucune note', () => {
    assert.match(MATCH_RULES, /une compétence ou un outil ne la prouve pas/)
    assert.match(MATCH_RULES, /sans donner de note/)
    assert.match(MATCH_RULES, /"poste" : le titre de l'offre/)
    assert.match(MATCH_RULES, /métier du titre non exercé ne se compense pas/)
    assert.match(MATCH_RULES, /tout "oui" recopie dans "citation" une ligne d'expérience du CV/)
    assert.match(MATCH_RULES, /"intitule" : l'intitulé exact/)
    assert.match(MATCH_RULES, /ravailler dans une équipe agile ou avec des développeurs n'est pas exercer ces métiers/)
    assert.match(MATCH_RULES, /"exigences" : pour chaque exigence de l'offre/)
    assert.match(MATCH_RULES, /compté sur les expériences du même métier/)
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
    assert.match(judgementFields({ skills: 2, requirements: 3 }), /"exigences":\[\{"jugement":"oui"\|"partiel"\|"non","citation":"…"\}, …\] \(3 valeurs/)
    assert.match(judgementFields({ skills: 0, requirements: 0 }), /"competences":\{"jugement":"oui"\|"partiel"\|"non","citation":"…"\}/)
    assert.match(judgementFields({ skills: 0, requirements: 0 }), /"poste":\[\{"metier":"…","exerce":"oui"\|"partiel"\|"non","intitule":"…"\}/)
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
const answer = (over: Record<string, unknown> = {}) => ({
  poste: [{ metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' }],
  exigences: [yes(), yes()], competences: [yes(), yes('Intègre les outils SAST, DAST et SCA dans les pipelines CI/CD GitLab')],
  domaine: 'oui', niveau: 'oui', ...over,
})

describe('jugements vérifiés dans le CV (la réponse de l\'IA ne suffit pas)', () => {
  it('poste : l\'intitulé cité doit figurer dans le CV ; sans intitulé, le métier n\'est pas prouvé', () => {
    const roles = (poste: unknown) => parseJudgements(answer({ poste }), criteria, CV)?.roles
    assert.deepEqual(roles([{ metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' }]),
      [{ title: 'Développeur Full Stack', fit: 'oui', cited: 'Développeur Python' }])
    assert.deepEqual(roles([{ metier: 'Scrum Master', exerce: 'oui', intitule: 'Scrum Master' }]),
      [{ title: 'Scrum Master', fit: 'partiel', cited: 'Scrum Master' }], 'intitulé absent du CV : un niveau de moins')
    assert.deepEqual(roles([{ metier: 'Scrum Master', exerce: 'oui' }]), [{ title: 'Scrum Master', fit: 'non', cited: '' }])
  })

  it('poste : la comparaison des intitulés (même métier, même famille, autre métier) décide, sans liste de mots', () => {
    const j = parseJudgements(answer({ poste: [
      { metier: 'Scrum Master', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
      { metier: 'Développeur Full Stack', exerce: 'oui', intitule: 'Développeur Python' },
      { metier: 'Ingénieur sécurité', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
    ] }), criteria, CV)
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
    assert.deepEqual(parseTitleRelations('aucun tableau', 2), [null, null])
    const prompt = titleCheckPrompt([{ metier: 'Scrum Master', intitule: 'Expert Application Security' }])
    assert.match(prompt.user, /1\. Métier demandé : « Scrum Master » — intitulé du CV : « Expert Application Security »/)
    assert.match(prompt.system, /"meme"\|"famille"\|"autre"/)
  })

  it('compétence « oui » : une ligne d\'expérience du CV qui la nomme, pas la liste des compétences', () => {
    const skills = (competences: unknown[]) => parseJudgements(answer({ competences }), criteria, CV)?.skills
    assert.deepEqual(skills([yes(), yes()]), ['oui', 'partiel'], 'Kubernetes absent de la ligne citée')
    assert.deepEqual(skills([yes('Compétences techniques : Python, Java, SQL, Docker, Kubernetes, Git'), { jugement: 'non' }]),
      ['partiel', 'non'], 'liste de mots-clés')
    assert.deepEqual(skills([yes('Développement full stack React et Node.js pour un site marchand'), { jugement: 'partiel' }]),
      ['partiel', 'partiel'], 'citation absente du CV')
    assert.deepEqual(skills(['oui', 'oui']), ['partiel', 'partiel'], 'sans citation')
  })

  it('exigence « oui » : une ligne d\'au moins 5 mots retrouvée dans le CV', () => {
    const reqs = (exigences: unknown[]) => parseJudgements(answer({ exigences }), criteria, CV)?.requirements
    assert.deepEqual(reqs([yes(), yes('Définit et déploie la stratégie AppSec')]), ['oui', 'oui'])
    assert.deepEqual(reqs([yes('Python Django'), yes('A animé les cérémonies Scrum de trois équipes')]), ['partiel', 'partiel'])
  })

  it('cas de production : expert sécurité applicative sur « Scrum Master et Développeur Full Stack » → 50 au plus', () => {
    // Réponse de l'IA relevée le 2026-11-04 (66 avant vérification), puis comparaison des intitulés : deux « autre ».
    const security = 'Définit et déploie la stratégie AppSec pour plusieurs squads de développement en environnement agile'
    const j = parseJudgements({
      poste: [
        { metier: 'Scrum Master', exerce: 'oui', intitule: 'Expert Application Security / Vulnerability Management' },
        { metier: 'Développeur Full Stack', exerce: 'partiel', intitule: 'Expert Application Security / Vulnerability Management' },
      ],
      exigences: [yes(security), yes(security)],
      competences: [yes('Compétences techniques : Python, Java, SQL, Docker, Kubernetes, Git'), { jugement: 'partiel' }],
      domaine: 'partiel', niveau: 'partiel',
    }, criteria, CV)
    assert.ok(j)
    const checked = withTitleRelations(j, ['autre', 'autre'])
    assert.deepEqual(checked.roles.map(r => r.fit), ['non', 'non'])
    assert.ok(judgedScore(checked) <= ROLE_CAP.non, `${judgedScore(checked)}`)
  })
})

describe('score calculé à partir des jugements de l\'IA (stable d\'un calcul à l\'autre)', () => {
  it('lit les jugements ; un élément oublié vaut « non »', () => {
    const j = parseJudgements(answer({ competences: [yes()], exigences: [yes(), { jugement: 'partiel' }] }), criteria, CV)
    assert.deepEqual(j, {
      roles: [{ title: 'Développeur Full Stack', fit: 'oui', cited: 'Développeur Python' }], requirements: ['oui', 'partiel'], requirementsListed: true,
      skills: ['oui', 'non'], skillsListed: true, domain: 'oui', level: 'oui',
    })
  })

  it('sans liste dans l\'offre, un jugement d\'ensemble', () => {
    const j = parseJudgements(answer({ competences: yes(), exigences: { jugement: 'non' } }), { skills: [], requirements: [] }, CV)
    assert.equal(j?.skillsListed, false)
    assert.deepEqual(j?.skills, ['oui'])
    assert.deepEqual(j?.requirements, ['non'])
  })

  it('refuse une réponse sans poste, exigences, compétences, domaine ou niveau (le candidat reste à noter)', () => {
    for (const missing of ['poste', 'exigences', 'competences', 'domaine', 'niveau']) {
      assert.equal(parseJudgements(answer({ [missing]: undefined }), criteria, CV), null, missing)
    }
    assert.equal(parseJudgements(answer({ poste: [{ metier: 'X', exerce: 'peut-être' }] }), criteria, CV), null)
    assert.equal(parseJudgements('texte', criteria, CV), null)
  })

  const judged = (over: Partial<MatchJudgements> = {}): MatchJudgements => ({
    roles: [{ title: '', fit: 'oui' }], requirements: ['oui', 'oui'], requirementsListed: true,
    skills: ['oui', 'oui'], skillsListed: true, domain: 'oui', level: 'oui', ...over,
  })

  it('calcule le score : poste 30, exigences 30, compétences 20, domaine 15, niveau 5', () => {
    assert.equal(judgedScore(judged()), 100)
    // Exigences de la description 1 sur 4 : la liste de compétences ne suffit plus.
    assert.equal(judgedScore(judged({ requirements: ['oui', 'non', 'non', 'non'] })), 78)
    assert.equal(judgedScore(judged({ requirements: ['oui', 'partiel'], skills: ['oui', 'non'], domain: 'non requis', level: 'non précisé' })), 83)
  })

  it('titre à plusieurs métiers : un métier non exercé plafonne à 50 sans se compenser par l\'autre', () => {
    // « Scrum Master et Développeur Full Stack » (production, 2026-11-04) : un Scrum Master qui n'avait jamais développé était noté 85.
    const j = parseJudgements(answer({
      poste: [{ metier: 'Scrum Master', exerce: 'oui', intitule: 'Scrum Master' }, { metier: 'Développeur Full Stack', exerce: 'non' }],
    }), criteria, 'Scrum Master — Assureur Fictif (2019-2023)')
    assert.equal(j && judgedScore(j), ROLE_CAP.non)
    assert.ok(ROLE_CAP.non < 65)
    assert.equal(judgedScore(judged({ roles: [{ title: '', fit: 'partiel' }] })), ROLE_CAP.partiel)
  })

  it('le domaine exigé absent garde son plafond : jamais au-dessus de 60 ; le plus bas des plafonds l\'emporte', () => {
    assert.equal(judgedScore(judged({ domain: 'non' })), DOMAIN_CAP.non)
    assert.equal(judgedScore(judged({ domain: 'partiel' })), DOMAIN_CAP.partiel)
    assert.equal(capFor({ roles: [{ title: '', fit: 'non' }], domain: 'non' }), ROLE_CAP.non)
  })

  it('résume les jugements pour la raison affichée : poste, exigences, compétences, domaine, niveau', () => {
    assert.equal(judgementSummary(judged({
      roles: [{ title: 'Scrum Master', fit: 'oui' }, { title: 'Développeur Full Stack', fit: 'non' }],
      requirements: ['oui', 'partiel', 'non'], skills: ['oui', 'non'], domain: 'non requis',
    })), 'Poste : Scrum Master oui, Développeur Full Stack non · Exigences : 1 sur 3, 1 partielle · Compétences : 1 sur 2 · Domaine : non requis · Niveau : oui')
    assert.equal(judgementSummary(judged({ requirements: ['partiel'], requirementsListed: false, skills: ['oui'], skillsListed: false })),
      'Poste : oui · Exigences : partiel · Compétences : oui · Domaine : oui · Niveau : oui')
  })
})

describe('une seule notation pour tous les candidats (ADR 0029)', () => {
  const listed: OfferCriteria = { skills: ['Python', 'React'], requirements: ['5 ans de développement'] }
  const offer = { title: 'Développeur Full Stack', description: 'Développement d\'applications web.' }

  it('demande les mêmes champs à l\'IA, quelle que soit la provenance du candidat', () => {
    const system = scoringSystemPrompt(criteriaCounts(listed))
    for (const field of ['"poste"', '"exigences"', '"competences"', '"domaine"', '"niveau"', '"points_forts"', '"vigilances"', '"raison"', '"resume"']) {
      assert.ok(system.includes(field), field)
    }
    assert.ok(system.includes(MATCH_RULES))
    assert.doesNotMatch(system, /"score"/, 'l\'IA ne donne pas de note')
    assert.doesNotMatch(system, /competences_vues/, 'compétences listées par l\'offre : déjà jugées une à une')
    assert.match(scoringSystemPrompt(criteriaCounts({ skills: [], requirements: [] })), /"competences_vues"/)
  })

  it('n\'envoie ni lettre de motivation ni critère ajouté : l\'offre et le CV seulement', () => {
    const message = scoringUserMessage(offer, listed, 'CV fictif')
    assert.match(message, /^=== OFFRE ===\nPoste : Développeur Full Stack\n/)
    assert.match(message, /1\. Python/)
    assert.match(message, /=== CV DU CANDIDAT ===\nCV fictif$/)
    assert.match(scoringUserMessage({ ...offer, details: ['Technologies : Python'] }, listed, 'CV'), /\nTechnologies : Python\nDescription : /)
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

describe('candidat ajouté au funnel depuis le Matching IA : son score est repris', () => {
  it('reprend le score et la raison affichés, et la recommandation qui suit le score', () => {
    assert.deepEqual(carriedScreening({ score: 78, reason: 'Poste : oui · … — Bon profil.' }), {
      aiScore: 78, aiSummary: 'Poste : oui · … — Bon profil.', aiRecommendation: recommendationFor(78),
    })
  })

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

  it('un candidat non noté n\'a pas de score à reprendre', () => {
    assert.equal(carriedScreening({ score: null, reason: '' }), null)
  })

  it('borne la raison à la taille de l\'analyse enregistrée', () => {
    assert.equal(carriedScreening({ score: 50, reason: 'r'.repeat(10_000) })?.aiSummary.length, 3000)
  })
})
