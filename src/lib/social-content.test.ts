import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PUBLISHER_INTRO, DEFAULT_SOCIAL_CONFIG, buildContent, normalizeCopy, offerHashtags, sanitizeSocialConfig, toHashtag,
  type CopyDraft, type JobLite,
} from './social-content'

// Offre fictive, au format de « Préparer la publication » (accroche, puis sections « ### » et puces « - »).
const job: JobLite = {
  id: 'ao123', title: 'Accompagnement du projet Gouvernance des données', company: 'Entreprise exemple', location: 'Paris (75)',
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
  context: '', hashtags: [],
}
const opts = { baseUrl: 'https://exemple.test', calendlyUrl: 'https://calendly.com/exemple' }
const applyLine = '👉 Voir l’offre et postuler : https://exemple.test/jobs/ao123?utm_source=linkedin'
// Sans hashtag proposé par l'IA : les compétences de l'offre, puis ceux du réglage.
const tagLine = '#GouvernanceDesDonnees #StrategieSI #recrutement #emploi #IT #consulting'

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
    assert.ok(linkedin.startsWith('🚀 Accompagnement du projet Gouvernance des données — Entreprise exemple\n\n📍 Paris (75) · Mission · Présentiel\n\n📣 Entreprise exemple recrute via'), linkedin)
    assert.ok(!linkedin.includes('###') && !linkedin.includes('**') && !linkedin.includes('…') && !linkedin.includes('➕'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n📅 Envie d’en discuter ? Réservez un échange : https://calendly.com/exemple\n\n${tagLine}`), linkedin)
  })

  it('raccourcit une offre trop longue section par section, la plus longue d’abord, et dit où lire la suite', () => {
    const list = (label: string, n: number) => Array.from({ length: n }, (_, i) => `- ${label} numéro ${i + 1} attendue du consultant`).join('\n')
    const description = `Intro de l’offre.\n\n### Au programme\n${list('Tâche', 120)}\n\n### Profil recherché\n${list('Compétence', 60)}\n\n### Modalités\n- Démarrage : janvier 2027\n- Durée : 12 mois`
    const { linkedin } = buildContent({ ...job, description }, copy, DEFAULT_SOCIAL_CONFIG, opts).captions
    assert.ok(linkedin.length <= 3000, `${linkedin.length} caractères`)
    assert.ok(linkedin.includes('\n🧭 Intro de l’offre.\n🔎 Pourquoi cette publication'), linkedin)
    assert.ok(linkedin.includes('\n\n🎯 Au programme\n• Tâche numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n🧩 Profil recherché\n• Compétence numéro 1 attendue du consultant\n'), linkedin)
    assert.ok(linkedin.includes('\n\n📋 Modalités\n• Démarrage : janvier 2027\n• Durée : 12 mois\n\n➕ Suite de l’offre sur le lien ci-dessous\n\n'), linkedin)
    assert.ok(linkedin.endsWith(`${applyLine}\n📅 Envie d’en discuter ? Réservez un échange : https://calendly.com/exemple\n\n${tagLine}`))
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
  const objective = '🔎 Pourquoi cette publication : nous recherchons un consultant ou une consultante pour cette mission. Vous avez ce profil, ou vous connaissez la bonne personne ? Postulez ou partagez cette publication.'
  const head = (j: JobLite, c: CopyDraft = copy, cfg = DEFAULT_SOCIAL_CONFIG) =>
    buildContent(j, c, cfg, opts).captions.linkedin.split('\n\n🎯 Au programme')[0]

  it('offre de la plateforme : présente Wise Associates, le projet rédigé par l’IA et l’objectif, sans répéter l’accroche', () => {
    const context = 'Une DSI structure la gouvernance de ses données et sa feuille de route SI.'
    const linkedin = buildContent({ ...job, fromPlatform: true }, { ...copy, context }, DEFAULT_SOCIAL_CONFIG, opts).captions.linkedin
    assert.ok(linkedin.includes([
      '📍 Paris (75) · Mission · Présentiel', '', DEFAULT_PUBLISHER_INTRO, '', `🧭 Le projet : ${context}`, objective, '', '🎯 Au programme',
    ].join('\n')), linkedin)
    assert.ok(!linkedin.includes('Une direction des systèmes d’information structure'), 'accroche répétée')
  })

  it('sans texte de l’IA, l’accroche de la description sert de projet, reprise telle quelle', () => {
    assert.ok(head({ ...job, fromPlatform: true }).endsWith(`\n\n🧭 Une direction des systèmes d’information structure sa gouvernance des données.\n${objective}`))
  })

  it('offre d’une organisation cliente : l’organisation recrute, pas Wise Associates ; CDI annoncé', () => {
    const text = head({ ...job, company: 'Acme', contractType: 'cdi' })
    assert.ok(text.includes('\n\n📣 Acme recrute via MyBestConsultant, la plateforme de recrutement de Wise Associates.\n\n'), text)
    assert.ok(text.includes('🔎 Pourquoi cette publication : Acme recherche un candidat ou une candidate pour ce poste en CDI.'), text)
    assert.ok(!text.includes(DEFAULT_PUBLISHER_INTRO))
  })

  it('présentation vidée par l’admin : aucune ligne de présentation', () => {
    const cfg = sanitizeSocialConfig({ ...DEFAULT_SOCIAL_CONFIG, publisherIntro: '  ' })
    assert.equal(cfg.publisherIntro, '')
    assert.ok(head({ ...job, fromPlatform: true }, copy, cfg).includes('Présentiel\n\n🧭 Une direction'))
  })

  it('réglage enregistré avant la présentation : celle par défaut', () => {
    assert.equal(sanitizeSocialConfig({ hashtags: ['emploi'] }).publisherIntro, DEFAULT_PUBLISHER_INTRO)
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

  it('LinkedIn : hashtags de l’offre d’abord, puis ceux du réglage, sans doublon, 10 au plus', () => {
    const cfg = { ...DEFAULT_SOCIAL_CONFIG, hashtags: ['recrutement', 'alm', 'emploi', 'IT', 'consulting', 'finance', 'banque', 'risque'] }
    const linkedin = buildContent(alm, { ...copy, hashtags: ['ALM', 'RisqueDeLiquidite', 'CFP'] }, cfg, opts).captions.linkedin
    const tags = linkedin.slice(linkedin.lastIndexOf('\n') + 1).split(' ')
    assert.deepEqual(tags, ['#ALM', '#RisqueDeLiquidite', '#CFP', '#recrutement', '#emploi', '#IT', '#consulting', '#finance', '#banque', '#risque'])
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
