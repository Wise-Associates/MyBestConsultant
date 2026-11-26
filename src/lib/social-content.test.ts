import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PUBLISHER_INTRO, DEFAULT_SOCIAL_CONFIG, boldText, brandPresentation, buildContent, networkHashtags, normalizeCopy, offerHashtags, roleHashtag, SOCIAL_CONTEXT_MAX, sanitizeSocialConfig, tenderProject, toHashtag,
  type CopyDraft, type JobLite,
} from './social-content'

// Offre fictive, au format de « Préparer la publication » (accroche, puis sections « ### » et puces « - »).
const job: JobLite = {
  id: '6a0000000000000000c1', title: 'Accompagnement du projet Gouvernance des données', company: 'Entreprise exemple', location: 'Paris (75)',
  contractType: 'mission', remote: 'onsite', skills: ['Gouvernance des données', 'Stratégie SI'],
  description: [
    'Une direction des systèmes d’information structure sa gouvernance des données.',
    '',
    '### Au programme',
    '- Définir un cadre de gouvernance des données',
    '- Élaborer la feuille de route du SI',
    '- Accompagner la transformation numérique des équipes',
    '- Animer les comités de pilotage',
    '',
    '### Profil recherché',
    '- Maîtrise de **Collibra**',
    '- Capacité à travailler en équipe pluridisciplinaire',
    '',
    '### Modalités',
    '- Durée : 12 mois',
  ].join('\n'),
}
const copy: CopyDraft = {
  hook: 'Gouvernance des données', tagline: 'Rejoignez un projet stratégique', pitch: '',
  missionBullets: ['Définir un cadre de gouvernance des données'], profileBullets: ['Capacité à travailler en équipe pluridisciplinaire'],
  context: '', pole: '', hashtags: [],
}
const opts = { baseUrl: 'https://exemple.test', calendlyUrl: 'https://calendly.com/exemple' }
const applyLine = '👉 Voir l’offre et postuler : https://exemple.test/jobs/6a0000000000000000c1?utm_source=linkedin'
// Intitulé trop long pour un hashtag ; sans hashtag proposé par l'IA : les compétences de l'offre, le contrat (une
// mission → Freelance), puis ceux du réglage ; 5 en tout.
const tagLine = '#GouvernanceDesDonnees #StrategieSI #Freelance #Recrutement #Emploi'

describe('texte LinkedIn d’une offre', () => {
  it('publie toute la description de l’offre, titres et puces mis en forme pour LinkedIn', () => {
    const { linkedin } = buildContent(job, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.includes([
      '🎯 Au programme',
      '• Définir un cadre de gouvernance des données',
      '• Élaborer la feuille de route du SI',
      '• Accompagner la transformation numérique des équipes',
      '• Animer les comités de pilotage',
      '',
      '🧩 Profil recherché',
      '• Maîtrise de Collibra',
      '• Capacité à travailler en équipe pluridisciplinaire',
      '',
      '📋 Modalités',
      '• Durée : 12 mois',
    ].join('\n')), linkedin)
    assert.ok(linkedin.startsWith(`🚀 ${boldText('Accompagnement du projet Gouvernance des données')} — Entreprise exemple\n\n📍 Paris (75) · Mission · Présentiel\n\nDans le cadre de son développement, Entreprise exemple recherche`), linkedin)
    assert.ok(!linkedin.includes('###') && !linkedin.includes('**') && !linkedin.includes('…') && !linkedin.includes('➕'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n\n${tagLine}`), linkedin)
  })

  it('raccourcit une offre trop longue section par section, la plus longue d’abord, et dit où lire la suite', () => {
    const list = (label: string, n: number) => Array.from({ length: n }, (_, i) => `- ${label} numéro ${i + 1} attendue du consultant`).join('\n')
    const description = `Intro de l’offre.\n\n### Au programme\n${list('Tâche', 120)}\n\n### Profil recherché\n${list('Compétence', 60)}\n\n### Modalités\n- Démarrage : janvier 2027\n- Durée : 12 mois`
    const { linkedin } = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.length <= 3000, `${linkedin.length} caractères`)
    assert.ok(linkedin.includes('intervenir sur une mission.\n\n🧭 Intro de l’offre.\n\n🎯 Au programme'), linkedin)
    assert.ok(linkedin.includes('\n\n🎯 Au programme\n• Tâche numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n🧩 Profil recherché\n• Compétence numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n📋 Modalités\n• Démarrage : janvier 2027\n• Durée : 12 mois\n\n➕ Suite de l’offre sur le lien ci-dessous\n\n'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n\n${tagLine}`))
    // Premières puces de chaque section, entières et dans l'ordre ; les deux longues sections gardent une place comparable.
    for (const label of ['Tâche', 'Compétence']) {
      const kept = linkedin.split('\n').filter(l => l.startsWith(`• ${label} `))
      assert.deepEqual(kept, kept.map((_, i) => `• ${label} numéro ${i + 1} attendue du consultant`))
      assert.ok(kept.length >= 10, `${label} : ${kept.length} puces`)
    }
    assert.ok(!linkedin.includes('…'), linkedin)
  })

  it('coupe un paragraphe unique trop long au dernier mot entier', () => {
    const description = 'Mission longue et détaillée. '.repeat(200).trim()
    const { linkedin } = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.length <= 3000)
    const [body] = linkedin.split(`…\n\n➕ Suite de l’offre sur le lien ci-dessous\n\n${applyLine}`)
    const kept = body.slice(body.lastIndexOf('\n\n') + 2)
    assert.ok(kept.length > 1000 && description.startsWith(kept), kept)
    assert.equal(description[kept.length], ' ')
  })

  it('sans description, reprend l’accroche et les puces rédigées par l’IA, entières', () => {
    const { linkedin } = buildContent({ ...job, description: '' }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.includes('Rejoignez un projet stratégique'))
    assert.ok(linkedin.includes('🎯 Au programme\n• Définir un cadre de gouvernance des données'))
    assert.ok(linkedin.includes('🧩 Profil recherché : Capacité à travailler en équipe pluridisciplinaire'))
  })
})

describe('contexte en tête de la publication LinkedIn', () => {
  // Offre de l'admin (identifiant Appwrite, hexadécimal) : un appel d'offres (« ao… ») n'a pas la présentation de Wise.
  const platform: JobLite = { ...job, id: '6a1b2c3d4e5f60718293', fromPlatform: true, title: 'Consultant gouvernance des données (H/F)' }
  const recruit = (team: string) => `Dans le cadre de son développement, Wise Associates recherche un consultant gouvernance des données pour rejoindre ${team} et intervenir auprès de ses clients du secteur financier et de l’assurance.`
  const head = (j: JobLite, c: CopyDraft = copy, cfg = DEFAULT_SOCIAL_CONFIG) =>
    buildContent(j, c, cfg, opts).captions.linkedin.split('\n\n🎯 Au programme')[0]

  it('offre de la plateforme : présente Wise Associates, sa phrase de recrutement avec le pôle, puis le projet rédigé par l’IA', () => {
    const context = 'Une DSI structure la gouvernance de ses données et sa feuille de route SI.'
    const linkedin = buildContent(platform, { ...copy, context, pole: 'Data et intelligence artificielle' }, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(linkedin.includes([
      '📍 Paris (75) · Mission · Présentiel', '', DEFAULT_PUBLISHER_INTRO, '',
      recruit('son pôle d’expertise Data et intelligence artificielle'), '', `🧭 Le projet : ${context}`, '', '🎯 Au programme',
    ].join('\n')), linkedin)
    assert.ok(!linkedin.includes('Une direction des systèmes d’information structure'), 'accroche répétée')
    assert.ok(!linkedin.includes('Pourquoi cette publication'), linkedin)
  })

  it('lien Calendly de la plateforme sur ses posts seulement ; Instagram ne nomme pas le site (demande du 2026-11-26)', () => {
    const calendlyLine = '📅 Envie d’en discuter ? Réservez un échange : https://calendly.com/exemple'
    const own = buildContent(platform, copy, DEFAULT_SOCIAL_CONFIG, opts)
    assert.ok(own.captions.linkedin.includes(calendlyLine), own.captions.linkedin)
    assert.equal(own.calendlyUrl, 'https://calendly.com/exemple')
    const org = buildContent({ ...job, company: 'Acme' }, copy, DEFAULT_SOCIAL_CONFIG, opts)
    for (const caption of Object.values(org.captions)) {
      assert.ok(!caption.includes('calendly') && !/wise|mybest|my best/i.test(caption), caption)
    }
    assert.equal(org.calendlyUrl, '')
    assert.ok(org.captions.instagram.includes('👉 Postuler : lien dans la bio'), org.captions.instagram)
  })

  it('appel d’offres publié par la plateforme : ni présentation de Wise Associates ni phrase de recrutement (ADR 0060)', () => {
    const context = 'Un organisme public modernise le paiement des aides.'
    const linkedin = buildContent({ ...platform, id: 'ao6ade48df0003fdac503e' }, { ...copy, context, pole: 'Data et intelligence artificielle' },
      DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(!/wise/i.test(linkedin), linkedin)
    assert.ok(linkedin.includes(`📍 Paris (75) · Mission · Présentiel\n\n🧭 Le projet : ${context}`), linkedin)
    // Qui recrute : la première phrase de « Le contexte », à la place de celle de Wise (le reste de la section n'est pas répété).
    const opening = 'Un organisme public chargé de services numériques de télédéclaration recrute un profil pour assurer le support applicatif de niveau 2.'
    const description = `Assurez la continuité de service.\n\n### Le contexte\n${opening} Son système sert des milliers d’usagers.\n\n### Au programme\n- Qualifier les incidents`
    const withContext = buildContent({ ...platform, id: 'ao6ade48df0003fdac503e', description }, { ...copy, context }, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(withContext.includes(`📍 Paris (75) · Mission · Présentiel\n\n${opening}\n\n🧭 Le projet : ${context}\n\n🎯 Au programme`), withContext)
    assert.ok(!withContext.includes('milliers d’usagers'), withContext)
    // « Le projet » proposé à la relecture : la suite de la section, sans sa première phrase, en phrases entières.
    assert.equal(tenderProject(description), 'Son système sert des milliers d’usagers.')
    assert.equal(tenderProject(`### Le contexte\n${opening} ${'Une phrase de plus. '.repeat(30)}`).length <= SOCIAL_CONTEXT_MAX, true)
    assert.equal(tenderProject('### Au programme\n- Qualifier'), '')
    // Une autre offre de la plateforme garde la présentation de Wise Associates.
    assert.ok(buildContent(platform, copy, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin.includes(DEFAULT_PUBLISHER_INTRO))
  })

  it('« Le projet » tient lieu de la section « Le contexte » de la description, qui n’est pas répétée (ADR 0060)', () => {
    const description = 'Pilotez la gouvernance des données.\n\n### Le contexte\nUn organisme public modernise son SI.\n\n### Au programme\n- Définir le cadre'
    const context = 'Un organisme public modernise le SI de ses aides.'
    const withProject = buildContent({ ...platform, description }, { ...copy, context }, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(withProject.includes(`🧭 Le projet : ${context}\n\n🎯 Au programme\n• Définir le cadre`), withProject)
    assert.ok(!withProject.includes('Le contexte'), withProject)
    // Sans projet rédigé par l'IA : la section reste dans le corps.
    const without = buildContent({ ...platform, description }, { ...copy, context: '' }, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(without.includes('🏢 Le contexte\nUn organisme public modernise son SI.'), without)
  })

  it('sans pôle ni texte de l’IA : « ses équipes », et l’accroche de la description sert de projet', () => {
    assert.ok(head(platform).endsWith(`\n\n${recruit('ses équipes')}\n\n🧭 Une direction des systèmes d’information structure sa gouvernance des données.`), head(platform))
  })

  it('intitulé repris sans « Consultant » en tête, « H/F » ni parenthèses', () => {
    const text = head({ ...platform, title: 'Consultante SAP FI H/F (Paris)' })
    assert.ok(text.includes('recherche un consultant SAP FI pour rejoindre'), text)
    assert.ok(head({ ...platform, title: 'Ingénieur DevOps / Cloud AWS' }).includes('recherche un consultant Ingénieur DevOps / Cloud AWS pour'))
  })

  it('intitulé d’un lot d’appel d’offres repris sans « Lot N » en tête', () => {
    for (const title of ['Lot 2. Expert en données fiscales', 'LOT 2 - Expert en données fiscales', 'Lot n°2 : Expert en données fiscales']) {
      assert.ok(head({ ...platform, title }).includes('recherche un consultant Expert en données fiscales pour rejoindre'), title)
    }
    // « Lot » ailleurs que devant un numéro en tête de l'intitulé reste.
    assert.ok(head({ ...platform, title: 'Gestionnaire de lots logistiques' }).includes('recherche un consultant Gestionnaire de lots logistiques pour'))
  })

  it('offre d’une organisation cliente : texte de la direction appliqué à l’organisation, sa présentation en tête (ADR 0058)', () => {
    const about = 'Acme accompagne les collectivités dans la transformation de leurs ressources humaines.'
    const text = head({ ...job, company: 'Acme', contractType: 'mission', title: 'Consultant SIRH (H/F)', publisherAbout: about })
    assert.ok(text.endsWith([
      '📍 Paris (75) · Mission · Présentiel', '', about, '',
      'Dans le cadre de son développement, Acme recherche un consultant SIRH pour intervenir sur une mission.', '',
      '🧭 Une direction des systèmes d’information structure sa gouvernance des données.',
    ].join('\n')), text)
    assert.ok(!text.includes(DEFAULT_PUBLISHER_INTRO) && !text.includes('Pourquoi cette publication'), text)
    // Seule l'organisation qui publie est nommée : ni Wise Associates ni MyBestConsultant (demande du 2026-11-26).
    assert.ok(!/wise|mybest|my best/i.test(text), text)
  })

  it('offre d’une organisation en CDI, sans présentation : « rejoindre ses équipes en CDI », pas de paragraphe vide', () => {
    const text = head({ ...job, company: 'Acme', contractType: 'cdi', title: 'Chef de projet SI' })
    assert.ok(text.includes('Présentiel\n\nDans le cadre de son développement, Acme recherche un consultant Chef de projet SI pour rejoindre ses équipes en CDI.\n\n🧭 Une direction'), text)
  })

  it('présentation vidée par l’admin : aucune ligne de présentation', () => {
    const cfg = sanitizeSocialConfig({ ...DEFAULT_SOCIAL_CONFIG, publisherIntro: '  ' })
    assert.equal(cfg.publisherIntro, '')
    assert.ok(head(platform, copy, cfg).includes('Présentiel\n\nDans le cadre de son développement'))
  })

  it('réglage enregistré avant la présentation, ou avec l’ancienne par défaut : celle par défaut ; une présentation modifiée est gardée', () => {
    assert.equal(sanitizeSocialConfig({ hashtags: ['emploi'] }).publisherIntro, DEFAULT_PUBLISHER_INTRO)
    const previous = 'Wise Associates est un cabinet de conseil qui accompagne entreprises, organismes publics et investisseurs dans leurs transformations commerciales et numériques : stratégie, risques, data & IA.'
    assert.equal(sanitizeSocialConfig({ publisherIntro: previous }).publisherIntro, DEFAULT_PUBLISHER_INTRO)
    assert.equal(sanitizeSocialConfig({ publisherIntro: 'Texte de l’admin.' }).publisherIntro, 'Texte de l’admin.')
  })

  it('pôle de l’IA gardé seulement s’il est l’un des pôles de Wise Associates, écrit comme dans la liste', () => {
    assert.equal(normalizeCopy({ pole: ' data et INTELLIGENCE artificielle ' }, job).pole, 'Data et intelligence artificielle')
    assert.equal(normalizeCopy({ pole: 'Strategie' }, job).pole, 'Stratégie')
    assert.equal(normalizeCopy({ pole: 'Cybersécurité' }, job).pole, '')
    assert.equal(normalizeCopy({ pole: 3 }, job).pole, '')
    assert.equal(normalizeCopy({}, job).pole, '')
  })

  it('une introduction longue ou en plusieurs paragraphes reste dans le corps, sans ligne « projet »', () => {
    const description = 'Premier paragraphe du contexte.\n\nSecond paragraphe du contexte.\n\n### Missions\n- Animer les ateliers'
    const linkedin = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(!linkedin.includes('🧭'), linkedin)
    assert.ok(linkedin.includes('Premier paragraphe du contexte.\n\nSecond paragraphe du contexte.\n\n'), linkedin)
  })
})

describe('hashtags d’expertise', () => {
  it('écrit chaque terme en un mot, sans accent, sigles et graphies techniques gardés', () => {
    assert.deepEqual(
      ['Risque de liquidité', 'Gestion ALM', 'Contingency Funding Plan (CFP)', 'C#', '.NET', 'ASP.NET Core', 'Node.js', 'CI/CD', 'C++', 'DevOps', 'AWS'].map(toHashtag),
      ['RisqueDeLiquidite', 'GestionALM', 'ContingencyFundingPlan', 'CSharp', 'DotNet', 'ASPNETCore', 'NodeJS', 'CICD', 'Cpp', 'DevOps', 'AWS'],
    )
    assert.equal(toHashtag('Capacité à travailler en équipe pluridisciplinaire et transverse'), '', 'trop long pour un hashtag')
    assert.equal(toHashtag('de'), '')
  })

  const alm: JobLite = {
    ...job, title: 'Expert ALM - Liquidité / Contingency Funding Plan / PPR',
    skills: ['Gestion ALM', 'Risque de Liquidité', 'Contingency Funding Plan (CFP)', 'Backtesting'],
    description: 'Pilotez la refonte du Contingency Funding Plan.\n\n### Profil recherché\n- Expertise en risque de liquidité et Plan Préventif de Rétablissement (PPR)',
  }

  it('garde les hashtags de l’IA présents dans l’offre et écarte ceux qui n’y sont pas', () => {
    assert.deepEqual(
      offerHashtags(alm, ['ALM', 'RisqueDeLiquidite', 'FinanceDeMarche', 'CFP', '#PPR', 'Python', 'Backtesting']),
      ['ALM', 'RisqueDeLiquidite', 'CFP', 'PPR', 'Backtesting'],
    )
  })

  it('sans proposition retenue, reprend les compétences de l’offre (6 au plus)', () => {
    assert.deepEqual(offerHashtags(alm, ['Python', 'Marketing']), ['GestionALM', 'RisqueDeLiquidite', 'ContingencyFundingPlan', 'Backtesting'])
    const many = { ...alm, skills: Array.from({ length: 9 }, (_, i) => `Compétence${i + 1}`) }
    assert.equal(offerHashtags(many, []).length, 6)
  })

})

describe('hashtags de chaque réseau', () => {
  const dev: JobLite = {
    ...job, title: 'Développeur Full Stack Java / Angular', contractType: 'mission',
    skills: ['Java', 'Spring Boot', 'Angular', 'PostgreSQL', 'Docker'], description: 'Développer en Java / Spring Boot et Angular, en équipe full stack.',
  }
  const proposed = ['Java', 'Angular', 'SpringBoot', 'FullStack']
  const last = (text: string) => text.slice(text.lastIndexOf('\n') + 1)

  it('LinkedIn et Instagram : le poste, 3 expertises, le contrat ; Facebook : 2 expertises et le contrat ; X : 2 expertises', () => {
    assert.deepEqual(networkHashtags(dev, proposed, DEFAULT_SOCIAL_CONFIG), {
      linkedin: ['#DeveloppeurFullStackJava', '#Java', '#Angular', '#SpringBoot', '#Freelance'],
      instagram: ['#DeveloppeurFullStackJava', '#Java', '#Angular', '#SpringBoot', '#Freelance'],
      facebook: ['#Java', '#Angular', '#Freelance'],
      x: ['#Java', '#Angular'],
    })
  })

  it('écrit ces hashtags en dernière ligne de chaque publication', () => {
    const { captions } = buildContent(dev, { ...copy, hashtags: proposed }, DEFAULT_SOCIAL_CONFIG, opts)
    assert.equal(last(captions.linkedin), '#DeveloppeurFullStackJava #Java #Angular #SpringBoot #Freelance')
    assert.equal(last(captions.instagram), '#DeveloppeurFullStackJava #Java #Angular #SpringBoot #Freelance')
    assert.equal(last(captions.facebook), '#Java #Angular #Freelance')
    assert.equal(last(captions.x), '#Java #Angular')
  })

  it('un CDI ou un CDD donne son hashtag de contrat', () => {
    assert.deepEqual(networkHashtags({ ...dev, contractType: 'cdi' }, proposed, DEFAULT_SOCIAL_CONFIG).facebook, ['#Java', '#Angular', '#CDI'])
    assert.deepEqual(networkHashtags({ ...dev, contractType: 'cdd' }, proposed, DEFAULT_SOCIAL_CONFIG).facebook, ['#Java', '#Angular', '#CDD'])
  })

  it('tire le poste de l’intitulé, avant « / » ou « - », sans H/F ; rien s’il est trop long', () => {
    assert.deepEqual(
      ['Ingénieur DevOps / Cloud AWS', 'Chef de projet Data - Power BI', 'Consultant SAP FI (H/F)', 'Développeur Java H/F', 'Product Owner, assurance'].map(roleHashtag),
      ['IngenieurDevOps', 'ChefDeProjetData', 'ConsultantSAPFI', 'DeveloppeurJava', 'ProductOwner'],
    )
    assert.equal(roleHashtag('Accompagnement du projet Gouvernance des données'), '')
  })

  it('écarte une expertise qui n’est que le début du poste', () => {
    const data = { ...dev, title: 'Chef de projet Data / Power BI', contractType: 'cdi', skills: ['Power BI', 'SQL'], description: 'Chef de projet data, Power BI et SQL.' }
    assert.deepEqual(networkHashtags(data, ['ChefDeProjet', 'Data', 'PowerBI', 'SQL'], DEFAULT_SOCIAL_CONFIG).linkedin, ['#ChefDeProjetData', '#Data', '#PowerBI', '#SQL', '#CDI'])
  })

  it('poste trop long : une expertise de plus, pas les hashtags du réglage', () => {
    const tags = networkHashtags({ ...dev, title: 'Accompagnement du projet de modernisation de l’espace client' }, proposed, DEFAULT_SOCIAL_CONFIG)
    assert.deepEqual(tags.linkedin, ['#Java', '#Angular', '#SpringBoot', '#Freelance', '#FullStack'])
  })

  it('sans poste, expertise ni contrat, la place va aux hashtags du réglage', () => {
    const tags = networkHashtags({ ...dev, title: 'Accompagnement du projet de modernisation', contractType: undefined, skills: [] }, [], DEFAULT_SOCIAL_CONFIG)
    assert.deepEqual(tags.linkedin, ['#Recrutement', '#Emploi', '#IT', '#Consulting'])
    assert.deepEqual(tags.x, ['#Recrutement', '#Emploi'])
  })

  it('un hashtag déjà présent n’est pas répété', () => {
    const tags = networkHashtags({ ...dev, title: 'Java' }, proposed, { ...DEFAULT_SOCIAL_CONFIG, hashtags: ['java', 'recrutement'] })
    assert.deepEqual(tags.linkedin, ['#Java', '#Angular', '#SpringBoot', '#FullStack', '#Freelance'])
  })
})

describe('intitulé en gras', () => {
  it('passe lettres et chiffres en gras Unicode, accents et ponctuation gardés', () => {
    assert.equal(boldText('Az 09'), '𝗔𝘇 𝟬𝟵')
    assert.equal(boldText('é'), '𝗲́')
    assert.equal(boldText('C# / .NET'), '𝗖# / .𝗡𝗘𝗧')
  })

  it('met l’intitulé en gras sur LinkedIn, Facebook et Instagram ; pas sur X, qui reprend l’accroche', () => {
    const { captions } = buildContent(job, copy, DEFAULT_SOCIAL_CONFIG, opts)
    const head = `🚀 ${boldText(job.title)} — Entreprise exemple\n\n`
    for (const text of [captions.linkedin, captions.facebook, captions.instagram]) assert.ok(text.startsWith(head), text)
    assert.ok(captions.x.startsWith('🚀 Gouvernance des données\n'), captions.x)
  })
})

describe('textes rédigés par l’IA', () => {
  it('garde les puces entières ; seules les pastilles de l’affiche restent limitées à 40 caractères', () => {
    const mission = 'Piloter la mise en place du cadre de gouvernance des données avec les directions métiers et la DSI du groupe'
    const draft = normalizeCopy({ missionBullets: [mission], profileBullets: ['Capacité à travailler en équipe pluridisciplinaire'] }, job)
    assert.deepEqual(draft.missionBullets, [mission])
    assert.deepEqual(draft.profileBullets, ['Capacité à travailler en équipe pluridisciplinaire'])
    const { image, captions } = buildContent(job, draft, DEFAULT_SOCIAL_CONFIG, opts)
    assert.ok(image.skills.every(s => s.length <= 40), image.skills.join(' | '))
    assert.ok(captions.instagram.includes('Capacité à travailler en équipe pluridisciplinaire'))
    assert.ok(captions.facebook.includes(mission))
  })
})

describe('présentation d’une organisation tirée de sa marque employeur (ADR 0058)', () => {
  it('premières phrases entières de l’« À propos » qui tiennent en 300 caractères', () => {
    const first = 'Acme accompagne les collectivités dans la transformation de leurs ressources humaines.'
    const second = 'Ses équipes interviennent du choix du SIRH à son déploiement.'
    const about = `${first}\n\n${second} Une troisième phrase ${'beaucoup '.repeat(30)}trop longue pour tenir dans la limite.`
    assert.equal(brandPresentation(about, 'Accroche'), `${first} ${second}`)
  })

  it('sans « À propos » utilisable : l’accroche ; sans rien : aucune présentation', () => {
    assert.equal(brandPresentation('', '  Le conseil RH des collectivités  '), 'Le conseil RH des collectivités')
    assert.equal(brandPresentation(`${'x'.repeat(320)}.`, 'Accroche courte'), 'Accroche courte')
    assert.equal(brandPresentation('', ''), '')
  })
})
